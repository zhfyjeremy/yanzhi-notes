import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/**
 * 在当前选区插入独立段落图片并选中(浮出图片工具条)。
 * 供编辑器实例与纯 paste handler 共用，避免各自复制 NodeSelection 定位逻辑。
 */
export function insertImageAtSelection(
  view: EditorView,
  attrs: { src: string; alt?: string | null },
): void {
  const { state } = view;
  const tr = state.tr;
  const img = state.schema.nodes.image.create({ alt: null, ...attrs });
  const para = state.schema.nodes.paragraph.create(null, img);
  tr.replaceSelectionWith(para, false);
  // 块级插入后 selection 与插入内容的间隔不定(可能隔着后续块的开标签),
  // 以节点引用比对插入点附近探测图片真实位置
  const around = tr.selection.from;
  for (let p = around; p >= 0 && p >= around - para.nodeSize - 2; p--) {
    if (tr.doc.nodeAt(p) === img) {
      tr.setSelection(NodeSelection.create(tr.doc, p));
      break;
    }
  }
  view.dispatch(tr);
}
