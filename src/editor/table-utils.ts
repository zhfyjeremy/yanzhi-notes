import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

/**
 * 表格上下文与列对齐操作。
 * GFM 对齐是列级标记(`:---:`),序列化读表头单元格的 textAlign(serialize.ts renderTable),
 * 因此对齐命令整列设置(含表头);表格/单元格识别走 schema 的 tableRole,不引入 prosemirror-tables 直接依赖。
 */

export type ColumnAlign = "left" | "center" | "right" | null;

export interface TableContext {
  table: PMNode;
  /** 表格节点在 doc 中的位置(指向节点本身,可直接喂 view.nodeDOM) */
  tablePos: number;
  /** 当前光标所在列下标(0 起;PRD 禁单元格合并,行内下标即列号) */
  colIndex: number;
  rows: number;
  cols: number;
  /** 当前列对齐,以表头单元格为准(与序列化一致) */
  align: ColumnAlign;
}

/** 沿 $from 向上找 tableRole 匹配的祖先深度,找不到返回 -1 */
function findRoleDepth(state: EditorState, roles: string[]): number {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if (roles.includes($from.node(d).type.spec.tableRole ?? "")) return d;
  }
  return -1;
}

/** 光标所在表格的上下文;不在表格内(或选中态不在单元格里)返回 null */
export function getTableContext(state: EditorState): TableContext | null {
  const { $from } = state.selection;
  const tableDepth = findRoleDepth(state, ["table"]);
  const cellDepth = findRoleDepth(state, ["cell", "header_cell"]);
  if (tableDepth < 0 || cellDepth < 0) return null;

  const table = $from.node(tableDepth);
  const cell = $from.node(cellDepth);
  // 单元格的父级(所在行)在 depth-1;列下标按节点引用比对
  const row = $from.node(cellDepth - 1);
  let colIndex = -1;
  row.forEach((child, _offset, index) => {
    if (child === cell) colIndex = index;
  });
  if (colIndex < 0) return null;

  const headerCell = table.firstChild?.child(colIndex);
  return {
    table,
    tablePos: $from.before(tableDepth),
    colIndex,
    rows: table.childCount,
    cols: row.childCount,
    align: (headerCell?.attrs.textAlign as ColumnAlign) ?? null,
  };
}

/** 整列设置对齐(含表头单元格);再次点击同对齐由 UI 层传 null 还原默认 */
export function setColumnAlign(editor: Editor, align: ColumnAlign): void {
  const ctx = getTableContext(editor.state);
  if (!ctx) return;
  const { table, tablePos, colIndex } = ctx;
  const tr = editor.state.tr;
  // setNodeMarkup 的 pos 需满足 doc.nodeAt(pos) === 目标单元格:
  // 表格内容起点 tablePos+1 + 行偏移 + 行开标签 1 + 单元格在行内偏移
  table.forEach((row, rowOffset) => {
    row.forEach((cell, cellOffset, cellIndex) => {
      if (cellIndex !== colIndex) return;
      tr.setNodeMarkup(tablePos + 2 + rowOffset + cellOffset, undefined, {
        ...cell.attrs,
        textAlign: align,
      });
    });
  });
  if (tr.docChanged) editor.view.dispatch(tr);
}
