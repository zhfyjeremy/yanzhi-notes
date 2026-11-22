import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import type { Editor } from "@tiptap/react";
import { YanzhiEditor } from "../YanzhiEditor";

/** 首次挂载也要恢复 meta 位置:覆盖应用重启后直接打开上次文档的场景。 */
describe("YanzhiEditor 初始滚动恢复", () => {
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

  it("首篇挂载时恢复保存的选区与滚动位置", async () => {
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

    expect(readyEditor).not.toBeNull();
    await act(async () => {
      for (let i = 0; i < 6; i++) {
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
