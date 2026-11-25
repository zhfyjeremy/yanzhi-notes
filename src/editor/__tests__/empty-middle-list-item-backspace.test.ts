import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";
import { docToMarkdown } from "../markdown/serialize";

function makeEditor(content: string): Editor {
  return new Editor({ extensions: baseExtensions, content });
}

/** 定位文档中第一个空段落(返回其内部位置) */
function posOfFirstEmptyParagraph(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === "paragraph" && node.content.size === 0) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  if (found === -1) throw new Error("no empty paragraph in doc");
  return found;
}

/** 走真实 keydown 路径(commands.keyboardShortcut 不等于真实按键聚合结果) */
function pressBackspace(editor: Editor): boolean {
  const event = new KeyboardEvent("keydown", {
    key: "Backspace",
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("DeleteEmptyMiddleListItem", () => {
  it("deletes an empty ordered-list item in the middle and keeps one list", () => {
    const editor = makeEditor('<ol start="13"><li>生产锁定</li><li></li><li>拆包管理</li></ol>');
    editor.commands.setTextSelection(posOfFirstEmptyParagraph(editor));

    expect(pressBackspace(editor)).toBe(true);
    const doc = editor.state.doc;
    // 列表合并为一截,start 保持,序号自动续排;
    // 文末空段落是 StarterKit TrailingNode 的全局既有行为
    const list = doc.child(0)!;
    expect(list.type.name).toBe("orderedList");
    expect(list.attrs.start).toBe(13);
    expect(list.childCount).toBe(2);
    expect(list.child(0).textContent).toBe("生产锁定");
    expect(list.child(1).textContent).toBe("拆包管理");
    expect(doc.childCount).toBe(2);
    expect(doc.child(1)!.type.name).toBe("paragraph");
    // 光标落到上一条列表项末尾
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe("生产锁定");
    expect($from.parentOffset).toBe(4);
  });

  it("renumbers correctly when serialized back to markdown", () => {
    const md = [
      "13. 期初期末库存:筛选",
      "14. 库存统计:备注",
      "15. 生产锁定:合并",
      "16. 生产锁定:加日期",
      "",
      "17.",
      "18. 拆包管理:拆包",
      "19. 原料生产出库:筛选",
    ].join("\n");
    const editor = makeEditor(mdToHtml(md));
    editor.commands.setTextSelection(posOfFirstEmptyParagraph(editor));

    expect(pressBackspace(editor)).toBe(true);
    expect(docToMarkdown(editor.state.doc)).toBe(
      [
        "13. 期初期末库存:筛选",
        "14. 库存统计:备注",
        "15. 生产锁定:合并",
        "16. 生产锁定:加日期",
        "17. 拆包管理:拆包",
        "18. 原料生产出库:筛选",
      ].join("\n") + "\n",
    );
  });

  it("deletes an empty bullet-list item in the middle and keeps one list", () => {
    const editor = makeEditor("<ul><li>甲</li><li></li><li>乙</li></ul>");
    editor.commands.setTextSelection(posOfFirstEmptyParagraph(editor));

    expect(pressBackspace(editor)).toBe(true);
    const list = editor.state.doc.child(0)!;
    expect(list.type.name).toBe("bulletList");
    expect(list.childCount).toBe(2);
    expect(list.child(0).textContent).toBe("甲");
    expect(list.child(1).textContent).toBe("乙");
  });

  it("keeps the default lift behavior for the last empty list item", () => {
    const editor = makeEditor('<ol start="13"><li>生产锁定</li><li></li></ol>');
    editor.commands.setTextSelection(posOfFirstEmptyParagraph(editor));

    expect(pressBackspace(editor)).toBe(true);
    const doc = editor.state.doc;
    // 默认行为:空项 lift 成段落,而不是被删除;列表自身保留 1 条
    let emptyParagraphCount = 0;
    doc.descendants((node) => {
      if (node.type.name === "paragraph" && node.content.size === 0) emptyParagraphCount += 1;
      return true;
    });
    expect(emptyParagraphCount).toBeGreaterThan(0);
    const list = doc.child(0)!;
    expect(list.type.name).toBe("orderedList");
    expect(list.childCount).toBe(1);
    expect(list.child(0).textContent).toBe("生产锁定");
  });
});
