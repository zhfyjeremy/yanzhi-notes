import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { YanzhiEditor } from "../YanzhiEditor";

/** 标题改名是同文档 path 变化,不能用旧 markdown prop 把未去抖正文重载掉。 */
describe("编辑器同文档改名", () => {
  let root: Root | null = null;
  let readyEditor: Editor | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => undefined;
    Range.prototype.getClientRects = () => [new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList;
    readyEditor = null;
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  it("contentPath 变化但 contentEpoch 不变时保留刚输入正文", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const props = {
      markdown: "# 标题\n\n正文",
      contentPath: "未命名文档.md",
      contentEpoch: 1,
      onReady: (editor: Editor) => {
        readyEditor = editor;
      },
    };

    await act(async () => {
      root!.render(createElement(YanzhiEditor, props));
      await Promise.resolve();
    });
    expect(readyEditor).not.toBeNull();
    const editor = readyEditor!;

    act(() => {
      editor.commands.focus("end");
      editor.commands.insertContent("，刚输入的内容");
    });

    // 用户立刻在标题按 Enter:App 收去抖稿并改名,contentPath 变但正文代次不变。
    await act(async () => {
      root!.render(
        createElement(YanzhiEditor, {
          ...props,
          contentPath: "新名字.md",
        }),
      );
      await Promise.resolve();
    });
    expect(editor.state.doc.textContent).toContain("刚输入的内容");

    // 对照:真正切换到另一篇同字面量文档时,epoch 变化必须重载。
    await act(async () => {
      root!.render(
        createElement(YanzhiEditor, {
          ...props,
          contentPath: "另一篇.md",
          contentEpoch: 2,
        }),
      );
      await Promise.resolve();
    });
    expect(editor.state.doc.textContent).not.toContain("刚输入的内容");
  });
});