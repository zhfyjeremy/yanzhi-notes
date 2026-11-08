import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../extensions";
import { HeadingBadge } from "../extensions/heading-badge";
import { mdToHtml } from "../markdown/md-instance";

/**
 * 标题层级徽标:光标在标题里时,标题左侧留白显示 H1–H6 小签。
 * Decoration.widget 只在视图层,不进 doc,md 序列化不受影响。
 */

function makeEditor(md: string): Editor {
  return new Editor({ extensions: [...baseExtensions, HeadingBadge], content: mdToHtml(md) });
}

/** 文本所在位置(把光标放进某段文字里) */
function posOf(editor: Editor, text: string): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.isText && node.text?.includes(text)) pos = p;
    return true;
  });
  return pos;
}

describe("标题层级徽标", () => {
  it("光标在 H2 里 → 显示 H2", () => {
    const editor = makeEditor("## 二级标题\n\n正文");
    editor.commands.setTextSelection(posOf(editor, "二级标题"));
    const badge = editor.view.dom.querySelector(".yz-heading-badge");
    expect(badge?.textContent).toBe("H2");
    editor.destroy();
  });

  it("光标在正文里 → 不显示", () => {
    const editor = makeEditor("## 二级标题\n\n正文段落");
    editor.commands.setTextSelection(posOf(editor, "正文段落"));
    expect(editor.view.dom.querySelector(".yz-heading-badge")).toBeNull();
    editor.destroy();
  });

  it("徽标不进 doc(序列化不受影响)", () => {
    const editor = makeEditor("## 二级标题\n\n正文");
    editor.commands.setTextSelection(posOf(editor, "二级标题"));
    expect(editor.state.doc.textContent).not.toContain("H2");
    editor.destroy();
  });
});
