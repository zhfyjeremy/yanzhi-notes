import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * 双链 mark,方言 [[目标|显示名]](PRD §10)。
 * 跳转/检索由应用层负责(YanzhiEditor handleClick + wiki-link-command)。
 * inputrule:手打完整 [[目标]] / [[目标|别名]] 即时成链(不经 md 重载)。
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

  addInputRules() {
    return [
      {
        // [[目标]] / [[目标|别名]];目标不允许 ]] | 换行(别名宽松些,允许 |)
        find: /\[\[([^[\]|\n]+)(?:\|([^\]\n]*))?\]\]$/,
        handler: ({ state, range, match }) => {
          const target = match[1].trim();
          const label = match[2] ?? target;
          if (!target || !label) return; // 无效目标:不动文本
          const mark = state.schema.marks.wikiLink.create({ target });
          const text = state.schema.text(label, [mark]);
          state.tr.replaceWith(range.from, range.to, text);
        },
        undoable: true,
      },
    ];
  },
});
