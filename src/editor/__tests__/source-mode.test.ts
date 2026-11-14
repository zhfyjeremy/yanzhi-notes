import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { Editor } from "@tiptap/react";
import { EditorView } from "@codemirror/view";
import { YanzhiEditor } from "../YanzhiEditor";

/** 全文档源码模式:切换保行、编辑自动保存与返回排版视图。 */
describe("Markdown 源码模式", () => {
  const roots: Root[] = [];
  let changes: string[] = [];
  let readyEditor: Editor | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => undefined;
    changes = [];
    readyEditor = null;
  });

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()!;
      act(() => root.unmount());
    }
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function renderEditor() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        createElement(YanzhiEditor, {
          markdown: "# 标题\n\n正文",
          onMarkdownChange: (md: string) => changes.push(md),
          onReady: (editor: Editor) => {
            readyEditor = editor;
          },
        }),
      ),
    );
    return container;
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  const enterSourceByShortcut = async () => {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Slash",
          key: "/",
          metaKey: true,
          bubbles: true,
        }),
      );
    });
  };

  const waitForSourceEditor = async (container: HTMLElement) => {
    for (let i = 0; i < 20 && !container.querySelector(".cm-content"); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  it("排版光标在正文时切入源码,落在正文行", async () => {
    const container = renderEditor();
    expect(readyEditor).not.toBeNull();
    const editor = readyEditor!;

    let bodyPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "正文") {
        bodyPos = pos + 1;
        return false;
      }
      return true;
    });
    expect(bodyPos).not.toBeNull();
    act(() => {
      editor.commands.setTextSelection(bodyPos!);
    });

    await enterSourceByShortcut();
    await waitForSourceEditor(container);

    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = EditorView.findFromDOM(content!);
    expect(view).not.toBeNull();
    const line = view!.state.doc.lineAt(view!.state.selection.main.head);
    expect(line.text).toContain("正文");
  });

  it("源码光标在标题行时切回排版,落在标题块", async () => {
    const container = renderEditor();
    await enterSourceByShortcut();
    await waitForSourceEditor(container);

    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = EditorView.findFromDOM(content!);
    expect(view).not.toBeNull();
    // 标题行首
    view!.dispatch({ selection: { anchor: 0 } });

    const back = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("返回排版视图"),
    );
    expect(back).not.toBeNull();
    await act(async () => {
      back!.click();
      await nextFrame();
      await nextFrame();
    });

    expect(container.querySelector(".cm-content")).toBeNull();
    expect(readyEditor).not.toBeNull();
    const $pos = readyEditor!.state.selection.$from;
    expect($pos.parent.type.name).toBe("heading");
    expect($pos.parent.textContent).toBe("标题");
  });

  it("快捷键可切换源码模式,编辑后自动保存并返回排版视图", async () => {
    const container = renderEditor();

    await enterSourceByShortcut();
    await waitForSourceEditor(container);
    const content = container.querySelector<HTMLElement>(".cm-content");
    expect(content?.getAttribute("aria-label")).toBe("Markdown 源码");
    const view = EditorView.findFromDOM(content!);
    expect(view?.state.doc.toString()).toBe("# 标题\n\n正文\n");
    const sourceView = view!;
    vi.useFakeTimers();
    sourceView.dispatch({
      changes: { from: 0, to: sourceView.state.doc.length, insert: "# 标题\n\n源码正文\n" },
    });
    await act(async () => {
      vi.advanceTimersByTime(320);
    });
    expect(changes[changes.length - 1]).toBe("# 标题\n\n源码正文\n");
    vi.useRealTimers();

    const back = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.includes("返回排版视图"),
    );
    expect(back).not.toBeNull();
    await act(async () => {
      back!.click();
      await nextFrame();
      await nextFrame();
    });

    expect(container.querySelector("textarea[aria-label='Markdown 源码']")).toBeNull();
    expect(container.querySelector(".yz-editor-doc")?.textContent).toContain("源码正文");
  });
});
