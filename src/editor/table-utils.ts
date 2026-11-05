import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  TableMap,
  addColumn,
  addRow,
  isInTable,
  removeColumn,
  removeRow,
  selectedRect,
} from "@tiptap/pm/tables";

/**
 * 表格上下文与列对齐 / 行列结构操作。
 * GFM 对齐是列级标记(`:---:`),序列化读表头单元格的 textAlign(serialize.ts renderTable),
 * 因此对齐命令整列设置(含表头)。
 *
 * 多列选区(鼠标划选单元格 → CellSelection)时,对齐作用于选中矩形覆盖的全部列。
 * 行列增删不依赖「当下选区仍在单元格」——radix 下拉失焦后选区常漂到 table 节点,
 * TextSelection 落在非 inline 上会导致内置 addColumn* 静默失败;改为打开菜单时快照
 * tablePos/行列下标,用 TableMap + addColumn/addRow/remove* 按坐标改。
 */

export type ColumnAlign = "left" | "center" | "right" | null;

export interface TableContext {
  table: PMNode;
  /** 表格节点在 doc 中的位置(指向节点本身,可直接喂 view.nodeDOM) */
  tablePos: number;
  /** 锚点列下标(选区最左列;单格光标时即当前列) */
  colIndex: number;
  /** 选中列下标(升序去重);单格光标时长度为 1 */
  colIndexes: number[];
  /** 锚点行下标(选区最上行) */
  rowIndex: number;
  /** 选中行下标(升序去重) */
  rowIndexes: number[];
  rows: number;
  cols: number;
  /**
   * 选中列的共同对齐(以各列表头为准)。
   * 多列对齐不一致时为 null,工具条不高亮任一按钮。
   */
  align: ColumnAlign;
}

/** 打开行列菜单时冻结的结构锚点(不随后续失焦选区漂移) */
export interface TableStructureAnchor {
  tablePos: number;
  rowIndex: number;
  colIndex: number;
  rows: number;
  cols: number;
}

export type TableStructureOp =
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "addColumnBefore"
  | "addColumnAfter"
  | "deleteColumn";

/** 光标/单元格选区所在表格的上下文;不在表格内返回 null */
export function getTableContext(state: EditorState): TableContext | null {
  if (!isInTable(state)) return null;

  let rect: ReturnType<typeof selectedRect>;
  try {
    rect = selectedRect(state);
  } catch {
    return null;
  }

  const table = rect.table;
  const tablePos = rect.tableStart - 1;
  const cols = table.firstChild?.childCount ?? 0;
  if (cols <= 0 || rect.left >= rect.right || rect.top >= rect.bottom) return null;

  const colIndexes: number[] = [];
  for (let c = rect.left; c < rect.right; c++) colIndexes.push(c);
  const rowIndexes: number[] = [];
  for (let r = rect.top; r < rect.bottom; r++) rowIndexes.push(r);

  let align: ColumnAlign = null;
  let uniform = true;
  for (let i = 0; i < colIndexes.length; i++) {
    const headerCell = table.firstChild?.child(colIndexes[i]);
    const next = (headerCell?.attrs.textAlign as ColumnAlign) ?? null;
    if (i === 0) align = next;
    else if (next !== align) {
      uniform = false;
      break;
    }
  }

  return {
    table,
    tablePos,
    colIndex: colIndexes[0],
    colIndexes,
    rowIndex: rowIndexes[0],
    rowIndexes,
    rows: table.childCount,
    cols,
    align: uniform ? align : null,
  };
}

function cellDepthOf($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole;
    if (role === "cell" || role === "header_cell") return d;
  }
  return -1;
}

/** 把文档位置收进单元格内。pos 落在单元格边界前时向内迈一步 */
function resolveInsideCell(state: EditorState, pos: number): ResolvedPos | null {
  const max = state.doc.content.size;
  const clamped = Math.max(0, Math.min(pos, max));
  const $pos = state.doc.resolve(clamped);
  if (cellDepthOf($pos) >= 0) return $pos;
  const after = $pos.nodeAfter;
  const role = after?.type.spec.tableRole;
  if ((role === "cell" || role === "header_cell") && clamped < max) {
    const inner = state.doc.resolve(clamped + 1);
    if (cellDepthOf(inner) >= 0) return inner;
  }
  return null;
}

/**
 * 右键落点所在单元格的表格上下文,不读当前选区。
 * 长表滚到下面时,菜单按点中的那一行/列操作,而不是光标原先所在的行。
 */
export function tableContextAtPos(state: EditorState, pos: number): TableContext | null {
  const $pos = resolveInsideCell(state, pos);
  if (!$pos) return null;
  const cellDepth = cellDepthOf($pos);
  if (cellDepth < 0) return null;

  let rowDepth = -1;
  let tableDepth = -1;
  for (let d = cellDepth - 1; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole;
    if (role === "row" && rowDepth < 0) rowDepth = d;
    if (role === "table") {
      tableDepth = d;
      break;
    }
  }
  if (rowDepth < 0 || tableDepth < 0) return null;

  const table = $pos.node(tableDepth);
  const rowNode = $pos.node(rowDepth);
  const cellNode = $pos.node(cellDepth);
  let rowIndex = -1;
  table.forEach((row, _offset, index) => {
    if (row === rowNode) rowIndex = index;
  });
  let colIndex = -1;
  rowNode.forEach((cell, _offset, index) => {
    if (cell === cellNode) colIndex = index;
  });
  const cols = table.firstChild?.childCount ?? 0;
  if (rowIndex < 0 || colIndex < 0 || cols <= 0) return null;

  const headerCell = table.firstChild?.child(colIndex);
  const align = (headerCell?.attrs.textAlign as ColumnAlign) ?? null;
  return {
    table,
    tablePos: $pos.before(tableDepth),
    colIndex,
    colIndexes: [colIndex],
    rowIndex,
    rowIndexes: [rowIndex],
    rows: table.childCount,
    cols,
    align,
  };
}

export function toStructureAnchor(ctx: TableContext): TableStructureAnchor {
  return {
    tablePos: ctx.tablePos,
    rowIndex: ctx.rowIndex,
    colIndex: ctx.colIndex,
    rows: ctx.rows,
    cols: ctx.cols,
  };
}

/**
 * 按冻结锚点增删行列。不读 editor.state.selection —— 工具条下拉失焦后选区不可靠。
 * 返回是否改写了文档。
 */
export function applyTableStructure(
  editor: Editor,
  anchor: TableStructureAnchor,
  op: TableStructureOp,
): boolean {
  const table = editor.state.doc.nodeAt(anchor.tablePos);
  if (!table || table.type.spec.tableRole !== "table") return false;

  const map = TableMap.get(table);
  if (anchor.colIndex < 0 || anchor.colIndex >= map.width) return false;
  if (anchor.rowIndex < 0 || anchor.rowIndex >= map.height) return false;

  const tableStart = anchor.tablePos + 1;
  const rect = {
    map,
    tableStart,
    table,
    left: 0,
    right: map.width,
    top: 0,
    bottom: map.height,
  };

  let tr = editor.state.tr;
  switch (op) {
    case "addColumnBefore":
      tr = addColumn(tr, rect, anchor.colIndex);
      break;
    case "addColumnAfter":
      tr = addColumn(tr, rect, anchor.colIndex + 1);
      break;
    case "deleteColumn":
      if (map.width <= 1) return false;
      removeColumn(tr, rect, anchor.colIndex);
      break;
    case "addRowBefore":
      tr = addRow(tr, rect, anchor.rowIndex);
      break;
    case "addRowAfter":
      tr = addRow(tr, rect, anchor.rowIndex + 1);
      break;
    case "deleteRow":
      if (map.height <= 1) return false;
      removeRow(tr, rect, anchor.rowIndex);
      break;
  }

  if (!tr.docChanged) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * 批量插入行/列(1–50)。where=before 插在锚点前,after 插在锚点后。
 * 同一事务完成;不依赖当下选区。
 */
export function insertTableAxis(
  editor: Editor,
  anchor: TableStructureAnchor,
  count: number,
  axis: "row" | "column",
  where: "before" | "after",
): boolean {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1 || n > 50) return false;

  const table0 = editor.state.doc.nodeAt(anchor.tablePos);
  if (!table0 || table0.type.spec.tableRole !== "table") return false;
  const map0 = TableMap.get(table0);
  if (axis === "row") {
    if (anchor.rowIndex < 0 || anchor.rowIndex >= map0.height) return false;
  } else if (anchor.colIndex < 0 || anchor.colIndex >= map0.width) {
    return false;
  }

  const base =
    axis === "row"
      ? where === "before"
        ? anchor.rowIndex
        : anchor.rowIndex + 1
      : where === "before"
        ? anchor.colIndex
        : anchor.colIndex + 1;

  let tr = editor.state.tr;
  for (let i = 0; i < n; i++) {
    const table = tr.doc.nodeAt(anchor.tablePos);
    if (!table || table.type.spec.tableRole !== "table") return false;
    const map = TableMap.get(table);
    const rect = {
      map,
      tableStart: anchor.tablePos + 1,
      table,
      left: 0,
      right: map.width,
      top: 0,
      bottom: map.height,
    };
    tr = axis === "row" ? addRow(tr, rect, base + i) : addColumn(tr, rect, base + i);
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** 整列设置对齐(含表头)。colIndexes 为要改的列;不读选区 */
export function setColumnAlignAt(
  editor: Editor,
  tablePos: number,
  colIndexes: number[],
  align: ColumnAlign,
): void {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table || table.type.spec.tableRole !== "table") return;
  const targets = new Set(colIndexes);
  const tr = editor.state.tr;
  // setNodeMarkup 的 pos 需满足 doc.nodeAt(pos) === 目标单元格:
  // 表格内容起点 tablePos+1 + 行偏移 + 行开标签 1 + 单元格在行内偏移
  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset, cellIndex) => {
      if (!targets.has(cellIndex)) return;
      tr.setNodeMarkup(tablePos + 2 + rowOffset + cellOffset, undefined, {
        ...cell.attrs,
        textAlign: align,
      });
    });
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** 整列设置对齐(含表头);覆盖当前选中的全部列。再次点击同对齐由 UI 层传 null 还原默认 */
export function setColumnAlign(editor: Editor, align: ColumnAlign): void {
  const ctx = getTableContext(editor.state);
  if (!ctx) return;
  setColumnAlignAt(editor, ctx.tablePos, ctx.colIndexes, align);
}

/** 按表格节点位置删除整表。菜单点击后选区可能已离开单元格 */
export function deleteTableAt(editor: Editor, tablePos: number): boolean {
  const table = editor.state.doc.nodeAt(tablePos);
  if (!table || table.type.spec.tableRole !== "table") return false;
  editor.view.dispatch(
    editor.state.tr.delete(tablePos, tablePos + table.nodeSize).scrollIntoView(),
  );
  return true;
}
