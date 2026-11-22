import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { baseExtensions } from "../extensions";
import { clearEditorHistory } from "../clear-history";

function makeEditor(content: string): Editor {
  return new Editor({ extensions: baseExtensions, content });
}

describe("文档切换后的撤销边界", () => {
  it("setContent 换文档并清空 history 后,撤销不能回到上一篇文档", () => {
    const editor = makeEditor("<p>文档 A</p>");
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    expect(editor.can().undo()).toBe(true);

    editor.commands.setContent("<p>文档 B</p>", { emitUpdate: false });
    clearEditorHistory(editor);

    expect(editor.can().undo()).toBe(false);
    expect(editor.state.doc.textContent).toBe("文档 B");

    // 新文档内的新操作仍可撤销,且只撤到文档 B 的初始状态。
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    expect(editor.can().undo()).toBe(true);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("文档 B");
    editor.destroy();
  });

  it("未清 history 时能暴露跨文档撤销风险(保护清空逻辑的必要性)", () => {
    const editor = makeEditor("<p>文档 A</p>");
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    editor.commands.setContent("<p>文档 B</p>", { emitUpdate: false });
    expect(editor.can().undo()).toBe(true);
    editor.commands.undo();
    expect(editor.state.doc.textContent).not.toBe("文档 B");
    editor.destroy();
  });
});
