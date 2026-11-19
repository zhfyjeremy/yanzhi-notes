import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";

/**
 * WKWebView 的 IME 保险:表格列居中/右对齐时,composition 结束后原生选区可能回落到
 * 本段输入文本之前。这里记录 composition 起点,结束后若确认提交文本完整落在预期范围、
 * 且选区确实提前,再把光标恢复到提交文本之后;不满足条件则完全不动,避免干扰正常选区。
 */
const pluginKey = new PluginKey("yzTableImeCaret");

function inTableCell(state: EditorState, pos: number): boolean {
  try {
    const $pos = state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth--) {
      const role = $pos.node(depth).type.spec.tableRole;
      if (role === "cell" || role === "header_cell") return true;
    }
  } catch {
    return false;
  }
  return false;
}

export const TableImeCaret = Extension.create({
  name: "tableImeCaret",

  addProseMirrorPlugins() {
    let compositionFrom: number | null = null;

    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleDOMEvents: {
            compositionstart: (view, event) => {
              const from = view.state.selection.from;
              compositionFrom = event instanceof CompositionEvent && inTableCell(view.state, from)
                ? from
                : null;
              return false;
            },
            compositionend: (view, event) => {
              const from = compositionFrom;
              compositionFrom = null;
              if (!(event instanceof CompositionEvent) || from == null || !event.data) return false;

              const text = event.data;
              const expectedTo = from + text.length;
              // 等 ProseMirror 消化完 compositionend 的 DOM 变化后再校正。
              window.setTimeout(() => {
                if (view.isDestroyed) return;
                const { state, dispatch } = view;
                if (!state.selection.empty || state.selection.from >= expectedTo) return;
                if (state.doc.textBetween(from, expectedTo, "\n") !== text) return;
                try {
                  dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(expectedTo), -1)));
                } catch {
                  // 位置不可解析时不强行搬选区
                }
              }, 0);
              return false;
            },
          },
        },
      }),
    ];
  },
});
