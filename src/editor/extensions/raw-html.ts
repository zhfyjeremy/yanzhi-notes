import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { RawHtmlView } from "./raw-html-view";

/**
 * 原样保留的块级 HTML(§4.6:未知语法禁止静默丢弃)。
 * markdown-it 的 html_block 原文经 data-raw-html(encodeURIComponent)进入 PM,
 * 序列化时原样写回磁盘,保证「打开 → 保存 → 重开」文本不变。
 * V2 的 details/callout 等显式扩展落地后,对应片段会被其节点接管。
 */
export const RawHtml = Node.create({
  name: "rawHtml",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      content: {
        default: "",
        parseHTML: (element) =>
          decodeURIComponent(element.getAttribute("data-raw-html") ?? ""),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-raw-html]" }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RawHtmlView);
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        { "data-raw-html": encodeURIComponent(String(node.attrs.content ?? "")) },
        HTMLAttributes,
      ),
      ["code", {}, String(node.attrs.content ?? "")],
    ];
  },
});
