import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";
import { docToMarkdown } from "../markdown/serialize";
import { getTableContext, setColumnAlign } from "../table-utils";

/**
 * 表格工具条的后端行为(PRD §5.3.9):列对齐整列设置(含表头),
 * 序列化输出 GFM 列级标记(:--- / :---: / ---:)。
 * headless Editor + 光标落进单元格后驱动 getTableContext / setColumnAlign。
 */

const TABLE_MD = `| 甲 | 乙 |
| :--- | :---: |
| a | b |
| c | d |

收尾段落。
`;

function makeEditor(): Editor {
  return new Editor({ extensions: baseExtensions, content: mdToHtml(TABLE_MD) });
}

/** 收集文档顺序下的全部单元格位置(含表头) */
function cellPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.spec.tableRole === "cell" || node.type.spec.tableRole === "header_cell") {
      positions.push(pos);
    }
  });
  return positions;
}

/** 光标放进指定单元格的段落文本里 */
function focusCell(editor: Editor, cellPos: number) {
  const $pos = editor.state.doc.resolve(cellPos + 2);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
}

describe("getTableContext", () => {
  it("表头单元格:识别列下标与对齐", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[0]); // 表头第 1 列
    const ctx = getTableContext(editor.state);
    expect(ctx?.colIndex).toBe(0);
    expect(ctx?.rows).toBe(3);
    expect(ctx?.cols).toBe(2);
    expect(ctx?.align).toBe("left");
    editor.destroy();
  });

  it("表体单元格:读到所在列的表头对齐", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[3]); // 第 2 体行第 2 列
    const ctx = getTableContext(editor.state);
    expect(ctx?.colIndex).toBe(1);
    expect(ctx?.align).toBe("center");
    editor.destroy();
  });

  it("表格外返回 null", () => {
    const editor = makeEditor();
    // 光标放到表格后的收尾段落(编辑器初始光标会落进文档首个单元格)
    const end = editor.state.doc.content.size;
    const $pos = editor.state.doc.resolve(end - 1);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
    expect(getTableContext(editor.state)).toBeNull();
    editor.destroy();
  });
});

describe("setColumnAlign", () => {
  it("整列设置:表头与表体同时生效,序列化输出列级标记", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[2]); // 体行第 1 列
    setColumnAlign(editor, "right");

    const header = editor.state.doc.nodeAt(cells[0]);
    const body = editor.state.doc.nodeAt(cells[2]);
    expect(header?.attrs.textAlign).toBe("right");
    expect(body?.attrs.textAlign).toBe("right");
    expect(docToMarkdown(editor.state.doc)).toContain("| ---: | :---: |");
    editor.destroy();
  });

  it("传 null 还原默认", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[1]); // 表头第 2 列(原 :---:)
    setColumnAlign(editor, null);

    expect(docToMarkdown(editor.state.doc)).toContain("| :--- | --- |");
    editor.destroy();
  });

  it("对齐后再往返:输出稳定", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[0]);
    setColumnAlign(editor, "center");
    const once = docToMarkdown(editor.state.doc);
    expect(docToMarkdown(editor.state.doc)).toBe(once);
    editor.destroy();
  });
});
