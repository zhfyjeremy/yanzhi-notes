import { Extension, type Editor } from "@tiptap/core";
import type { Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { sinkListItem, liftListItem } from "@tiptap/pm/schema-list";
import { goToNextCell } from "@tiptap/pm/tables";

const DEFAULT_INDENT_SIZE = 4;
const MAX_INDENT_SIZE = 8;
const INDENT_CHARS = "\u00a0 \t";
const STRUCTURAL_NODE_NAMES = new Set([
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);

const clampIndentSize = (size: number): number =>
  Number.isFinite(size) ? Math.min(MAX_INDENT_SIZE, Math.max(1, Math.round(size))) : DEFAULT_INDENT_SIZE;

function closestStructuralNodeName($from: ResolvedPos): string | null {
  for (let depth = $from.depth; depth >= 0; depth--) {
    const name = $from.node(depth).type.name;
    if (STRUCTURAL_NODE_NAMES.has(name)) return name;
  }
  return null;
}

function lineStartOffset(textBefore: string): number {
  return textBefore.lastIndexOf("\n") + 1;
}

function indentUnit(parent: PmNode, size: number): string {
  return parent.type.name === "codeBlock" ? " ".repeat(size) : "\u00a0".repeat(size);
}

function leadingIndentLen(text: string, size: number): number {
  const match = new RegExp(`^[${INDENT_CHARS}]{1,${size}}`).exec(text);
  return match?.[0].length ?? 0;
}

/** 设置变化时同步到已创建编辑器,无需销毁/重建 ProseMirror 实例。 */
export function setTabIndentSize(editor: Editor, size: number): void {
  const storage = editor.storage as unknown as Record<string, { indentSize: number } | undefined>;
  storage.tabIndent = { indentSize: clampIndentSize(size) };
}

/**
 * 选区内每个文本块的缩进落点:段落整块缩进;代码块按行缩进。
 * 从后往前应用,避免前面的插入把后面的坐标推偏。
 */
function collectIndentTargets(
  doc: PmNode,
  from: number,
  to: number,
): { pos: number; parent: PmNode }[] {
  const targets: { pos: number; parent: PmNode }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.type.name === "codeBlock") {
      const text = node.textContent;
      const start = pos + 1;
      let offset = 0;
      for (const line of text.split("\n")) {
        const lineFrom = start + offset;
        const lineTo = lineFrom + line.length;
        if (lineTo >= from && lineFrom <= to) targets.push({ pos: lineFrom, parent: node });
        offset += line.length + 1;
      }
      return false;
    }
    targets.push({ pos: pos + 1, parent: node });
    return false;
  });
  return targets;
}

function indentSelection(tr: Transaction, size: number): boolean {
  const { from, to, empty, $from } = tr.selection;
  const parent = $from.parent;
  if (!parent.isTextblock) return false;

  if (empty) {
    tr.insertText(indentUnit(parent, size), from, to);
    return true;
  }

  const targets = collectIndentTargets(tr.doc, from, to);
  if (!targets.length) return false;
  let inserted = 0;
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i]!;
    const unit = indentUnit(target.parent, size);
    tr.insertText(unit, target.pos);
    inserted += unit.length;
  }
  // 保持选中被缩进的范围(含新插入的缩进字符)
  const nextFrom = from;
  const nextTo = to + inserted;
  tr.setSelection(TextSelection.create(tr.doc, nextFrom, nextTo));
  return true;
}

function outdentSelection(tr: Transaction, size: number): boolean {
  const { from, to, empty, $from } = tr.selection;
  if (empty) {
    const parent = $from.parent;
    if (!parent.isTextblock) return false;
    const before = parent.textBetween(0, $from.parentOffset, "\ufffc");
    const trailing = new RegExp(`[${INDENT_CHARS}]{1,${size}}$`).exec(before);
    if (trailing) {
      tr.delete(from - trailing[0].length, from);
      return true;
    }
    const lineStart = lineStartOffset(before);
    const line = parent.textBetween(lineStart, parent.content.size, "\ufffc");
    const leading = leadingIndentLen(line, size);
    if (!leading) return false;
    const deleteFrom = $from.start() + lineStart;
    tr.delete(deleteFrom, deleteFrom + leading);
    return true;
  }

  const targets = collectIndentTargets(tr.doc, from, to);
  if (!targets.length) return false;
  let removed = 0;
  let changed = false;
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i]!;
    const $pos = tr.doc.resolve(target.pos);
    const block = $pos.parent;
    if (block.type.name === "codeBlock") {
      const rel = target.pos - $pos.start();
      const text = block.textContent;
      const lineStart = text.lastIndexOf("\n", rel - 1) + 1;
      const lineEnd = text.indexOf("\n", rel);
      const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
      const leading = leadingIndentLen(line, size);
      if (!leading) continue;
      const abs = $pos.start() + lineStart;
      tr.delete(abs, abs + leading);
      removed += leading;
      changed = true;
      continue;
    }
    const text = block.textBetween(0, Math.min(size, block.content.size), "\ufffc");
    const leading = leadingIndentLen(text, size);
    if (!leading) continue;
    tr.delete(target.pos, target.pos + leading);
    removed += leading;
    changed = true;
  }
  if (!changed) return false;
  const nextFrom = from;
  const nextTo = Math.max(from, to - removed);
  tr.setSelection(TextSelection.create(tr.doc, nextFrom, nextTo));
  return true;
}

/**
 * Tab 统一在编辑器内消化:列表/表格保持既有语义;普通文本块与代码块按设置插入缩进,
 * 避免浏览器把 Tab 当作焦点导航键送出编辑器。
 *
 * 优先级拉高并直接走 ProseMirror command:挡住 Table/ListItem 在失败时仍
 * `view.dispatch(空事务)` 的路径——一次 Tab 否则会连续空跑 3~4 次事务,React
 * 订阅者跟着重渲染,手感发顿。
 *
 * 空行/有字行统一插入 NBSP(不用 CSS padding indent):padding 方案在 WKWebView
 * 上空行光标会「卡」在某一列,且 keepOnSplit 会把缩进带到 Enter 新行。
 * 卡顿已由空文档占位符收窄 + 编辑区不再 flex 撑高缓解。
 *
 * 富文本用 NBSP 而不是普通空格:普通空格在 contenteditable 中会被 HTML 空白合并
 * 规则吞掉;多个 ASCII 空格写到 Markdown 行首还会被解析成 indented code block。
 * Shift+Tab 优先移除光标前刚插入的一段缩进;光标不在缩进末尾时,再移除行首缩进。
 * 非空选区按行/块缩进,不再用缩进串替换整段选区。
 */
export const TabIndent = Extension.create({
  name: "tabIndent",
  // 高于 Table(100)/ListItem(100)/TaskItem(51),先吃掉 Tab,避免它们空 dispatch
  priority: 1000,

  addOptions() {
    return { indentSize: DEFAULT_INDENT_SIZE };
  },

  addStorage() {
    return { indentSize: this.options.indentSize };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const indentSize = (): number => {
      const storage = editor.storage as unknown as Record<string, { indentSize: number } | undefined>;
      return clampIndentSize(storage.tabIndent?.indentSize ?? DEFAULT_INDENT_SIZE);
    };

    const runList = (dir: "sink" | "lift"): boolean => {
      const name = closestStructuralNodeName(editor.state.selection.$from);
      if (name !== "listItem" && name !== "taskItem") return false;
      const type = editor.schema.nodes[name];
      if (!type) return true;
      const command = dir === "sink" ? sinkListItem(type) : liftListItem(type);
      command(editor.state, (tr) => editor.view.dispatch(tr.scrollIntoView()));
      return true;
    };

    const runTable = (dir: 1 | -1): boolean => {
      const name = closestStructuralNodeName(editor.state.selection.$from);
      if (name !== "tableCell" && name !== "tableHeader") return false;
      const moved = goToNextCell(dir)(editor.state, (tr) =>
        editor.view.dispatch(tr.scrollIntoView()),
      );
      if (!moved && dir === 1) {
        editor.chain().addRowAfter().goToNextCell().run();
      }
      return true;
    };

    const dispatchIndent = (tr: Transaction, empty: boolean): void => {
      editor.view.dispatch(empty ? tr : tr.scrollIntoView());
    };

    const indent = (): boolean => {
      if (runList("sink") || runTable(1)) return true;
      const { state } = editor;
      const tr = state.tr;
      if (!indentSelection(tr, indentSize())) return true;
      dispatchIndent(tr, state.selection.empty);
      return true;
    };

    const outdent = (): boolean => {
      if (runList("lift") || runTable(-1)) return true;
      const { state } = editor;
      const tr = state.tr;
      if (!outdentSelection(tr, indentSize())) return true;
      dispatchIndent(tr, state.selection.empty);
      return true;
    };

    return [
      new Plugin({
        key: new PluginKey("yzTabIndentCapture"),
        props: {
          // 编辑器 props 优先于其它 keymap;先 preventDefault 避免空行焦点导航
          handleKeyDown: (_view, event) => {
            if (event.key !== "Tab" || event.isComposing) return false;
            if (event.ctrlKey || event.metaKey || event.altKey) return false;
            event.preventDefault();
            return event.shiftKey ? outdent() : indent();
          },
        },
      }),
    ];
  },
});
