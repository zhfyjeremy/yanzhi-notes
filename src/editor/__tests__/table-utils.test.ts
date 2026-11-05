import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";
import { docToMarkdown } from "../markdown/serialize";
import {
  applyTableStructure,
  deleteTableAt,
  getTableContext,
  insertTableAxis,
  setColumnAlign,
  setColumnAlignAt,
  tableContextAtPos,
  toStructureAnchor,
} from "../table-utils";

/**
 * 表格工具条的后端行为(PRD §5.3.9):列对齐整列设置(含表头),
 * 序列化输出 GFM 列级标记(:--- / :---: / ---:);
 * 行列结构按冻结锚点改,不依赖当下选区。
 */

const TABLE_MD = `| 甲 | 乙 |
| :--- | :---: |
| a | b |
| c | d |

收尾段落。
`;

const WIDE_TABLE_MD = `| 甲 | 乙 | 丙 |
| --- | --- | --- |
| a | b | c |
| d | e | f |

收尾段落。
`;

function makeEditor(md = TABLE_MD): Editor {
  return new Editor({ extensions: baseExtensions, content: mdToHtml(md) });
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

/** 划选单元格矩形(含端点),模拟鼠标多列选中 */
function selectCellRange(editor: Editor, anchorCellPos: number, headCellPos: number) {
  const sel = CellSelection.create(editor.state.doc, anchorCellPos, headCellPos);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

describe("getTableContext", () => {
  it("表头单元格:识别列下标与对齐", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[0]); // 表头第 1 列
    const ctx = getTableContext(editor.state);
    expect(ctx?.colIndex).toBe(0);
    expect(ctx?.colIndexes).toEqual([0]);
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
    expect(ctx?.colIndexes).toEqual([1]);
    expect(ctx?.align).toBe("center");
    editor.destroy();
  });

  it("划选多列:colIndexes 覆盖选区列,对齐不一致时 align 为 null", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    // 表头 甲(left) → 乙(center)
    selectCellRange(editor, cells[0], cells[1]);
    const ctx = getTableContext(editor.state);
    expect(ctx?.colIndexes).toEqual([0, 1]);
    expect(ctx?.align).toBeNull();
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

  it("划选多列:一次居中全部选中列", () => {
    const editor = makeEditor(WIDE_TABLE_MD);
    const cells = cellPositions(editor);
    // 3 列表头: cells[0..2]; 划选第 1–2 列
    selectCellRange(editor, cells[0], cells[1]);
    setColumnAlign(editor, "center");

    expect(docToMarkdown(editor.state.doc)).toContain("| :---: | :---: | --- |");
    expect(getTableContext(editor.state)?.align).toBe("center");
    expect(getTableContext(editor.state)?.colIndexes).toEqual([0, 1]);
    editor.destroy();
  });

  it("划选多列:还原默认只清选中列", () => {
    const editor = makeEditor(WIDE_TABLE_MD);
    const cells = cellPositions(editor);
    selectCellRange(editor, cells[0], cells[2]);
    setColumnAlign(editor, "right");
    selectCellRange(editor, cells[0], cells[1]);
    setColumnAlign(editor, null);

    expect(docToMarkdown(editor.state.doc)).toContain("| --- | --- | ---: |");
    editor.destroy();
  });
});

/**
 * 表格工具条「行/列」下拉:radix 失焦后选区常漂走,内置 addColumn* 会失败。
 * 必须靠打开菜单时冻结的 tablePos/行列下标按坐标改结构。
 */
describe("applyTableStructure", () => {
  it("选区已离开表格时,按锚点仍能插行/插列/删列", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[2]); // 体行第 1 列 → row 1, col 0
    const anchor = toStructureAnchor(getTableContext(editor.state)!);

    // 模拟菜单打开后选区漂到表格外(工具条真实失败路径)
    const end = editor.state.doc.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(end - 1))),
    );
    expect(getTableContext(editor.state)).toBeNull();
    expect(editor.chain().focus().addRowAfter().run()).toBe(false);

    expect(applyTableStructure(editor, anchor, "addRowAfter")).toBe(true);
    expect(editor.state.doc.nodeAt(anchor.tablePos)?.childCount).toBe(anchor.rows + 1);

    expect(applyTableStructure(editor, anchor, "addColumnAfter")).toBe(true);
    expect(editor.state.doc.nodeAt(anchor.tablePos)?.firstChild?.childCount).toBe(anchor.cols + 1);

    expect(applyTableStructure(editor, anchor, "deleteColumn")).toBe(true);
    expect(editor.state.doc.nodeAt(anchor.tablePos)?.firstChild?.childCount).toBe(anchor.cols);
    editor.destroy();
  });

  it("只剩一列时拒删列;删到只剩一行后拒删行", () => {
    const editor = makeEditor(`| 甲 |
| --- |
| a |
`);
    const cells = cellPositions(editor);
    focusCell(editor, cells[0]);
    const anchor = toStructureAnchor(getTableContext(editor.state)!);
    expect(anchor.cols).toBe(1);
    expect(applyTableStructure(editor, anchor, "deleteColumn")).toBe(false);
    // 表头+体共 2 行,可删一次;再删应拒绝
    expect(applyTableStructure(editor, anchor, "deleteRow")).toBe(true);
    expect(applyTableStructure(editor, anchor, "deleteRow")).toBe(false);
    editor.destroy();
  });

  it("批量在下方插入多行(选区已离开仍生效)", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    focusCell(editor, cells[2]);
    const anchor = toStructureAnchor(getTableContext(editor.state)!);
    const end = editor.state.doc.content.size;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(end - 1))),
    );
    expect(insertTableAxis(editor, anchor, 3, "row", "after")).toBe(true);
    expect(editor.state.doc.nodeAt(anchor.tablePos)?.childCount).toBe(anchor.rows + 3);
    expect(insertTableAxis(editor, anchor, 2, "row", "before")).toBe(true);
    expect(editor.state.doc.nodeAt(anchor.tablePos)?.childCount).toBe(anchor.rows + 5);
    expect(insertTableAxis(editor, anchor, 0, "row", "after")).toBe(false);
    expect(insertTableAxis(editor, anchor, 99, "column", "after")).toBe(false);
    editor.destroy();
  });
});

describe("tableContextAtPos", () => {
  it("第二行右键落点向下插入,插在该行之后", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    // 表头是第 1 行,cells[2] 是第二行第一格(a)
    const ctx = tableContextAtPos(editor.state, cells[2] + 1);
    expect(ctx?.rowIndex).toBe(1);
    expect(ctx?.colIndex).toBe(0);
    expect(ctx?.align).toBe("left");

    const cellDom = editor.view.nodeDOM(cells[2]) as HTMLElement;
    const fromDom = tableContextAtPos(editor.state, editor.view.posAtDOM(cellDom, 0));
    expect(fromDom?.rowIndex).toBe(1);
    expect(fromDom?.colIndex).toBe(0);

    expect(applyTableStructure(editor, toStructureAnchor(ctx!), "addRowAfter")).toBe(true);
    const table = editor.state.doc.nodeAt(ctx!.tablePos);
    expect(table?.childCount).toBe(4);
    expect(table?.child(1).textContent).toBe("ab");
    expect(table?.child(2).textContent).toBe("");
    expect(table?.child(3).textContent).toBe("cd");
    editor.destroy();
  });

  it("第三行、第二列的落点互不串行", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    const row = tableContextAtPos(editor.state, cells[4] + 1);
    const col = tableContextAtPos(editor.state, cells[3] + 1);
    expect(row?.rowIndex).toBe(2);
    expect(row?.colIndex).toBe(0);
    expect(col?.rowIndex).toBe(1);
    expect(col?.colIndex).toBe(1);
    expect(col?.align).toBe("center");
    expect(tableContextAtPos(editor.state, editor.state.doc.content.size)).toBeNull();
    editor.destroy();
  });

  it("按落点列对齐,并按表格位置删表", () => {
    const editor = makeEditor();
    const cells = cellPositions(editor);
    const ctx = tableContextAtPos(editor.state, cells[3] + 1)!;
    setColumnAlignAt(editor, ctx.tablePos, [ctx.colIndex], "right");
    expect(docToMarkdown(editor.state.doc)).toContain("| :--- | ---: |");
    expect(deleteTableAt(editor, ctx.tablePos)).toBe(true);
    expect(docToMarkdown(editor.state.doc)).not.toContain("|");
    editor.destroy();
  });
});
