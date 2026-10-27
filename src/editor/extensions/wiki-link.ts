import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * 双链 mark,方言 [[目标|显示名]](PRD §10)。
 * 仅作为 mark 存在于统一 Schema;跳转/检索由应用层负责。
 */
export const WikiLink = Mark.create({
  name: "wikiLink",
  inclusive: false,
  keepOnSplit: false,

  addAttributes() {
    return {
      target: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-target") ?? "",
        renderHTML: (attributes) => ({ "data-target": attributes.target }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-type="wiki-link"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "a",
      mergeAttributes({ "data-type": "wiki-link" }, HTMLAttributes),
      0,
    ];
  },
});
