import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * 标题层级徽标:光标落在某个标题里时,在该标题左侧显示 H1–H6 小标(语雀/Typora 观感)。
 * Decoration.widget 只存在于视图层,不进 PM doc,md 序列化与往返不受影响。
 *
 * 只给「光标所在的那个标题」加徽标(不是整篇常显):长文里满屏标签反而吵。
 */

const badgePlugin = new Plugin({
  key: new PluginKey("yzHeadingBadge"),
  props: {
    decorations(state) {
      const { $head } = state.selection;
      let level = 0;
      let pos = -1;
      for (let d = $head.depth; d > 0; d--) {
        const node = $head.node(d);
        if (node.type.name === "heading") {
          level = Number(node.attrs.level ?? 1) || 1;
          pos = $head.before(d) + 1; // 标题内容起点
          break;
        }
      }
      if (!level || pos < 0) return DecorationSet.empty;
      return DecorationSet.create(state.doc, [
        Decoration.widget(pos, () => {
          const el = document.createElement("span");
          el.className = "yz-heading-badge";
          el.setAttribute("contenteditable", "false");
          el.textContent = `H${level}`;
          return el;
        }),
      ]);
    },
  },
});

export const HeadingBadge = Extension.create({
  name: "headingBadge",

  addProseMirrorPlugins() {
    return [badgePlugin];
  },
});
