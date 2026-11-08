import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../extensions";
import { MoveBlock } from "../extensions/move-block";
import { mdToHtml } from "../markdown/md-instance";

/**
 * 块级上下移动(⌘⌥↑/↓):以光标所在的最外层块为单位与相邻兄弟块交换。
 * 只改块顺序不改内容,序列化仍是标准 md。
 */

function makeEditor(md: string): Editor {
  return new Editor({ extensions: [...baseExtensions, MoveBlock], content: mdToHtml(md) });
}

/** 顶层块的文本序列 */
function blocks(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((node) => out.push(node.textContent));
  return out;
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

describe("块级上下移动", () => {
  it("向上:与上一个兄弟块交换", () => {
    const editor = makeEditor("甲\n\n乙\n\n丙");
    editor.commands.setTextSelection(posOf(editor, "乙"));
    expect(editor.commands.moveBlockUp()).toBe(true);
    expect(blocks(editor)).toEqual(["乙", "甲", "丙"]);
    editor.destroy();
  });

  it("向下:与下一个兄弟块交换", () => {
    const editor = makeEditor("甲\n\n乙\n\n丙");
    editor.commands.setTextSelection(posOf(editor, "甲"));
    expect(editor.commands.moveBlockDown()).toBe(true);
    expect(blocks(editor)).toEqual(["乙", "甲", "丙"]);
    editor.destroy();
  });

  it("首块不能再往上、末块不能再往下", () => {
    const editor = makeEditor("甲\n\n乙");
    editor.commands.setTextSelection(posOf(editor, "甲"));
    expect(editor.commands.moveBlockUp()).toBe(false);
    editor.commands.setTextSelection(posOf(editor, "乙"));
    expect(editor.commands.moveBlockDown()).toBe(false);
    expect(blocks(editor)).toEqual(["甲", "乙"]);
    editor.destroy();
  });

  it("选区在列表里时移动整个列表块", () => {
    const editor = makeEditor("甲\n\n- 一\n- 二\n\n丙");
    const before = blocks(editor);
    editor.commands.setTextSelection(posOf(editor, "一"));
    expect(editor.commands.moveBlockDown()).toBe(true);
    // 列表整体下移一格
    // 末位多出的空段 = Tiptap TrailingNode 行为(文档以列表结尾时补一个空段,
    // 用户才能在列表后继续打字);md 序列化会把末尾空段规范化掉,不影响落盘
    const after = blocks(editor);
    expect(after.slice(0, 3)).toEqual(["甲", "丙", "一二"]);
    expect(after.length).toBe(before.length + 1);
    editor.destroy();
  });

  it("移动后可撤销", () => {
    const editor = makeEditor("甲\n\n乙");
    editor.commands.setTextSelection(posOf(editor, "乙"));
    editor.commands.moveBlockUp();
    expect(blocks(editor)).toEqual(["乙", "甲"]);
    editor.commands.undo();
    expect(blocks(editor)).toEqual(["甲", "乙"]);
    editor.destroy();
  });
});
