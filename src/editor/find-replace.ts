import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * 文档内查找/替换(PRD §5.3.13,Typora 参考批次):
 * ⌘F 浮条即时高亮全部匹配,Enter/Shift+Enter 步进(当前项实底 + 滚动跟随),
 * 替换当前/全部。匹配不区分大小写,只在文本节点内(跨节点不拼,Typora 同口径)。
 * 查找词走 plugin meta(不进 undo 历史);替换走正常 tr(可撤销)。
 */

export interface FindMatch {
  from: number;
  to: number;
}

/** 巨文档防卡顿上限;超出即停止追加(UI 显示同样按上限计) */
const MAX_MATCHES = 2000;

/** 全文匹配(不区分大小写);纯函数,单测锁定 */
export function findMatches(doc: PMNode, query: string): FindMatch[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (out.length >= MAX_MATCHES) return false;
    if (!node.isText || !node.text) return true;
    const text = node.text.toLowerCase();
    let idx = text.indexOf(q);
    while (idx !== -1 && out.length < MAX_MATCHES) {
      out.push({ from: pos + idx, to: pos + idx + q.length });
      idx = text.indexOf(q, idx + q.length);
    }
    return true;
  });
  return out;
}

interface FindState {
  query: string;
  active: number;
  matches: FindMatch[];
  decorations: DecorationSet;
}

export const findReplaceKey = new PluginKey<FindState>("findReplace");

function buildState(doc: PMNode, query: string, active: number): FindState {
  const matches = findMatches(doc, query);
  const clamped = matches.length ? Math.min(active, matches.length - 1) : 0;
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === clamped ? "yz-find-match yz-find-match-current" : "yz-find-match",
      }),
    ),
  );
  return { query, active: clamped, matches, decorations };
}

function applyFind(tr: Transaction, prev: FindState): FindState {
  const meta = tr.getMeta(findReplaceKey) as
    | { type: "search"; query: string; active?: number }
    | { type: "close" }
    | undefined;
  if (meta?.type === "close") {
    return { query: "", active: 0, matches: [], decorations: DecorationSet.empty };
  }
  if (meta?.type === "search") {
    return buildState(
      tr.doc,
      meta.query,
      meta.active ?? (prev.query === meta.query ? prev.active : 0),
    );
  }
  // 文档变化(编辑/替换):query 保留重算,active 尽量停在附近
  if (tr.docChanged && prev.query) {
    return buildState(tr.doc, prev.query, prev.active);
  }
  return prev;
}

export const FindReplaceExtension = Extension.create({
  name: "findReplace",

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findReplaceKey,
        state: {
          init: () => ({ query: "", active: 0, matches: [], decorations: DecorationSet.empty }),
          apply: applyFind,
        },
        props: {
          decorations(state: EditorState) {
            return findReplaceKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/* ---------------- 命令式 API(FindReplaceBar 消费) ---------------- */

export function findStateOf(editor: Editor): FindState {
  return (
    findReplaceKey.getState(editor.state) ?? {
      query: "",
      active: 0,
      matches: [],
      decorations: DecorationSet.empty,
    }
  );
}

/** 设置查找词(并可选指定当前项);当前项滚入可视区 */
export function setSearch(editor: Editor, query: string, active = 0): void {
  const { state } = editor;
  const tr = state.tr.setMeta(findReplaceKey, { type: "search", query, active });
  const matches = findMatches(state.doc, query);
  const clamped = matches.length ? Math.min(active, matches.length - 1) : 0;
  const m = matches[clamped];
  if (m) {
    tr.setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView();
  }
  editor.view.dispatch(tr);
}

/** 步进:dir 1 下一个 / -1 上一个;步进后当前项选中 + 滚动跟随 */
export function stepFind(editor: Editor, dir: 1 | -1): void {
  const s = findStateOf(editor);
  if (!s.matches.length) return;
  const next = (s.active + dir + s.matches.length) % s.matches.length;
  setSearch(editor, s.query, next);
}

/** 替换当前项后自动跳到下一个待选项 */
export function replaceCurrent(editor: Editor, replacement: string): void {
  const s = findStateOf(editor);
  const m = s.matches[s.active];
  if (!m) return;
  editor
    .chain()
    .insertContentAt({ from: m.from, to: m.to }, replacement)
    .run();
  stepFind(editor, 1);
}

/** 全部替换:同一 tr 内倒序替换(坐标不漂移),一次 undo 可回滚 */
export function replaceAll(editor: Editor, replacement: string): number {
  const s = findStateOf(editor);
  if (!s.matches.length) return 0;
  const tr = editor.state.tr;
  for (let i = s.matches.length - 1; i >= 0; i--) {
    const m = s.matches[i];
    tr.insertText(replacement, m.from, m.to);
  }
  editor.view.dispatch(tr);
  return s.matches.length;
}

/** 关闭查找:清高亮 */
export function closeFind(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta(findReplaceKey, { type: "close" }));
}
