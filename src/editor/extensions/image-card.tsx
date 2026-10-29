import Image from "@tiptap/extension-image";
import type { Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";

/**
 * 图片卡片(PRD §5.3.7)M2 阶段:仅 UI。
 * width/align 是视图层属性,不进 md 序列化(imageToMd 只输出 alt/src);
 * 持久化方案随 M3 assets 落盘定(方言表无宽度语法,不擅自扩方言)。
 * 独占段落的图片居中由段落级 decoration 实现(inline img 自身无法居中)。
 */

/** 独占段落且 align=center 的图片所在段落 → 居中 class */
const centerParagraphsPlugin = new Plugin({
  key: new PluginKey("yzImageAlign"),
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "paragraph" || node.childCount !== 1) return;
        const img = node.firstChild;
        if (img?.type.name !== "image" || img.attrs.align !== "center") return;
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "yz-img-center",
          }),
        );
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

function ImageCardView({ node, selected }: NodeViewProps) {
  const { src, alt, width } = node.attrs;
  return (
    <NodeViewWrapper
      as="span"
      className="yz-img-card"
      data-selected={selected || undefined}
    >
      <img
        src={src}
        alt={alt ?? ""}
        style={width ? { width } : undefined}
        draggable={false}
      />
    </NodeViewWrapper>
  );
}

/** 插入独立段落的图片并选中(浮出工具条,便于立即改地址/宽度) */
export function insertImage(editor: Editor, attrs: { src: string; alt?: string | null }): void {
  const { state } = editor;
  const tr = state.tr;
  const img = state.schema.nodes.image.create({ alt: null, ...attrs });
  const para = state.schema.nodes.paragraph.create(null, img);
  tr.replaceSelectionWith(para, false);
  // 块级插入后 selection 与插入内容的间隔不定(可能隔着后续块的开标签),
  // 以节点引用比对在插入点附近探测图片真实位置
  const around = tr.selection.from;
  for (let p = around; p >= 0 && p >= around - para.nodeSize - 2; p--) {
    if (tr.doc.nodeAt(p) === img) {
      tr.setSelection(NodeSelection.create(tr.doc, p));
      break;
    }
  }
  editor.view.dispatch(tr);
}

export const ImageCard = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** 显示宽度百分比("50%" 等);null = 原始尺寸(不超过正文宽) */
      width: {
        default: null,
        renderHTML: () => ({}), // 由 NodeView 的 style 负责
      },
      /** left | center | null;left 与 null 视觉相同,仅为控件激活态记录 */
      align: {
        default: null,
        renderHTML: () => ({}),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageCardView);
  },

  addProseMirrorPlugins() {
    return [centerParagraphsPlugin];
  },
});
