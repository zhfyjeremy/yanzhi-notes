import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { baseExtensions } from "../extensions";

describe("EmptyDocPlaceholder", () => {
  it("单个空段落显示整篇占位符", () => {
    const editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    expect(editor.view.dom.querySelectorAll("p.is-editor-empty")).toHaveLength(1);
    editor.destroy();
  });

  it("插入空表格后不把整篇占位符带进单元格", () => {
    const editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

    expect(editor.state.doc.firstChild?.type.name).toBe("table");
    expect(
      editor.view.dom.querySelectorAll("td p.is-editor-empty, th p.is-editor-empty"),
    ).toHaveLength(0);
    editor.destroy();
  });
});
