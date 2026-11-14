import { Extension, isNodeEmpty } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * 空文档占位符(「开始写作…」)。
 *
 * 不用 @tiptap/extension-placeholder:它默认 showOnlyCurrent,光标所在空段落
 * 都会挂 is-empty / data-placeholder。空行按 Tab 插入缩进时要拆掉这套装饰,
 * DOM class/属性抖动在 WKWebView 里明显发顿;有字的行没有这步所以不卡。
 * 产品只在整篇空文档显示占位,这里按同口径只装饰 isNodeEmpty(doc)。
 */

const pluginKey = new PluginKey("yzEmptyDocPlaceholder");

export const EmptyDocPlaceholder = Extension.create({
  name: "emptyDocPlaceholder",

  addOptions() {
    return { placeholder: "开始写作…" };
  },

  addProseMirrorPlugins() {
    const placeholder = this.options.placeholder as string;
    return [
      new Plugin({
        key: pluginKey,
        props: {
          decorations(state) {
            if (!isNodeEmpty(state.doc)) return DecorationSet.empty;
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isTextblock || !isNodeEmpty(node)) return true;
              decos.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: "is-editor-empty",
                  "data-placeholder": placeholder,
                }),
              );
              return false;
            });
            return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
