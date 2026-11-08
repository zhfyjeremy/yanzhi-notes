import { Extension } from "@tiptap/core";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/**
 * 块级上下移动(Typora/Word 习惯:⌘/Ctrl+⌥+↑/↓)。
 * 单位 = 光标所在的最外层块(段落/标题/列表),与相邻兄弟块交换位置;
 * 只改块顺序不改块内容,序列化仍是标准 md(往返 fixtures 不受影响)。
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    moveBlock: {
      /** 当前块与上一个兄弟块交换 */
      moveBlockUp: () => ReturnType;
      /** 当前块与下一个兄弟块交换 */
      moveBlockDown: () => ReturnType;
    };
  }
}

/** 顶层块起始位置(PM doc 的子节点按顺序拼接) */
function topLevelPos(doc: EditorState["doc"], index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/**
 * 把光标所在的最外层块与上/下一个兄弟块交换。
 * 只改传入的 tr(Tiptap 命令约定:命令负责改 tr,框架负责派发),
 * 成功后把选区映射回新位置(光标仍落在同一段文字里)。
 */
export function moveTopLevelBlock(state: EditorState, tr: Transaction, dir: -1 | 1): boolean {
  const doc = state.doc;
  const index = state.selection.$from.index(0);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= doc.childCount) return false;

  const node = doc.child(index);
  const other = doc.child(target);
  const posA = topLevelPos(doc, index);
  // 交换区间 = 相邻两块连起来的范围:向上时 other 在前,向下时 other 在后
  const from = dir === -1 ? posA - other.nodeSize : posA;
  const to = dir === -1 ? posA + node.nodeSize : posA + node.nodeSize + other.nodeSize;
  const content = dir === -1 ? [node, other] : [other, node];

  tr.replaceWith(from, to, content);
  tr.setMeta("addToHistory", true);
  const mapped = tr.mapping.map(state.selection.from);
  const clamped = Math.max(0, Math.min(mapped, tr.doc.content.size));
  tr.setSelection(TextSelection.near(tr.doc.resolve(clamped)));
  return true;
}

export const MoveBlock = Extension.create({
  name: "moveBlock",

  addCommands() {
    return {
      moveBlockUp: () => ({ state, tr }) => moveTopLevelBlock(state, tr, -1),
      moveBlockDown: () => ({ state, tr }) => moveTopLevelBlock(state, tr, 1),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-ArrowUp": () => this.editor.commands.moveBlockUp(),
      "Mod-Alt-ArrowDown": () => this.editor.commands.moveBlockDown(),
    };
  },
});
