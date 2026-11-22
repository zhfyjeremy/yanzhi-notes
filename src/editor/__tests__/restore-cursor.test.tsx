import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { Editor } from "@tiptap/react";
import { YanzhiEditor } from "../YanzhiEditor";

/** 首次挂载恢复 meta 位置;换文期展示 loading,避免大文档解析时界面像卡死。 */
describe("YanzhiEditor 文档装载", () => {
  const roots: Root[] = [];
  let readyEditor: Editor | null = null;
  let contentReady: string[] = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => undefined;
    Range.prototype.getClientRects = () => [new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList;
    vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    readyEditor = null;
    contentReady = [];
  });

  afterEach(() => {
    while (roots.length) {
      act(() => roots.pop()!.unmount());
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function renderInitial() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        createElement(YanzhiEditor, {
          markdown: "# 标题\n\n正文",
          contentPath: "notes/a.md",
          getRestoreCursor: () => ({ pos: 6, scrollTop: 321 }),
          onReady: (editor: Editor) => {
            readyEditor = editor;
          },
          onContentReady: (path: string) => contentReady.push(path),
        }),
      ),
    );
    return { container, root };
  }

  it("切换大文档时先显示 loading,解析完成后关闭", async () => {
    const { container, root } = renderInitial();
    act(() =>
      root.render(
        createElement(YanzhiEditor, {
          markdown: `# 第二篇\n\n${"内容较多".repeat(6000)}`,
          contentPath: "notes/b.md",
          contentEpoch: 1,
          onReady: (editor: Editor) => {
            readyEditor = editor;
          },
          onContentReady: (path: string) => contentReady.push(path),
        }),
      ),
    );
    expect(container.querySelector('[role="status"][aria-label="正在打开文档"]')).not.toBeNull();

    await act(async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });
    expect(container.querySelector('[role="status"][aria-label="正在打开文档"]')).toBeNull();
    expect(readyEditor?.state.doc.textContent).toContain("第二篇");
    expect(contentReady).toContain("notes/b.md");
  });

  it("空文档不显示 loading,也不等待滚动恢复", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() =>
      root.render(
        createElement(YanzhiEditor, {
          markdown: "",
          contentPath: "notes/empty.md",
          getRestoreCursor: () => ({ pos: 6, scrollTop: 321 }),
          onContentReady: (path: string) => contentReady.push(path),
        }),
      ),
    );
    expect(container.querySelector('[role="status"][aria-label="正在打开文档"]')).toBeNull();
    expect(contentReady).toEqual(["notes/empty.md"]);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(container.querySelector('[role="status"][aria-label="正在打开文档"]')).toBeNull();
  });

  it("首篇挂载时恢复保存的选区与滚动位置", async () => {
    const { container } = renderInitial();

    expect(readyEditor).not.toBeNull();
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });

    const scroll = container.querySelector<HTMLElement>('[data-editor-scroll="true"]');
    expect(scroll?.scrollTop).toBe(321);
    expect(readyEditor?.state.selection.from).toBeGreaterThan(1);
    expect(contentReady).toEqual(["notes/a.md"]);

    act(() => {
      scroll!.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
      scroll!.scrollTop = 77;
    });
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    });
    expect(scroll?.scrollTop).toBe(77);
  });
});
