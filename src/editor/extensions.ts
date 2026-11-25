import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import Italic, { starInputRegex, starPasteRegex } from "@tiptap/extension-italic";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import { Extension, markInputRule, markPasteRule } from "@tiptap/core";
import { WikiLink } from "./extensions/wiki-link";
import { RawHtml } from "./extensions/raw-html";
import { CodeBlockCard } from "./extensions/code-block-card";
import { ImageCard } from "./extensions/image-card";
import { Callout } from "./extensions/callout";
import { Details } from "./extensions/details";
import { Attachment } from "./extensions/attachment";
import { MathInline, MathBlock } from "./extensions/math";
import { FontColor } from "./extensions/font-color";
import { HeadingShortcuts } from "./extensions/heading-shortcuts";
import { yzAutolinkPlugin, yzPasteLinkPlugin } from "./extensions/autolink";
import { TableImeCaret } from "./extensions/table-ime-caret";
import { EmptyDocPlaceholder } from "./extensions/empty-doc-placeholder";
import { TextSelection } from "@tiptap/pm/state";

/**
 * 斜体只用 *…*(与序列化一致)。默认 _…_ 粘贴/输入规则会把 `_SPECIAL_LABEL`
 * 吃成斜体 SPECIAL + LABEL,标识符下划线静默消失。
 */
const ItalicAsteriskOnly = Italic.extend({
  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});

/**
 * GFM 表格对齐属性(:--- / :---: / ---:)。
 *
 * 砚知只保留这一个对齐属性,并把它作为列级对齐的唯一真相:
 * Tiptap v3 内置的 `align` 属性与本属性都会渲染 `style="text-align: …"`,
 * 两份并存时 `align` 会留下过期值 —— 「取消对齐」只清 textAlign,
 * 残留的 align 仍渲染出 text-align,导致还原不生效。这里直接去掉内置 align。
 */
const textAlignAttr = {
  textAlign: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.style.textAlign || null,
    renderHTML: (attributes: { textAlign?: string | null }) =>
      attributes.textAlign
        ? { style: `text-align: ${attributes.textAlign}` }
        : {},
  },
};

/** 去掉 Tiptap 内置 align 属性,只留 textAlign(见 textAlignAttr 注释) */
function withoutBuiltinAlign(
  parent: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!parent) return {};
  const { align: _align, ...rest } = parent;
  return rest;
}

const TableCellAligned = TableCell.extend({
  addAttributes() {
    return { ...withoutBuiltinAlign(this.parent?.()), ...textAlignAttr };
  },
});

/**
 * 文档首个块清空后,再按 Backspace 应删除这个空块。
 * ProseMirror 默认在文档起点没有“前一个块”可合并,所以光标会停在空行上;
 * 这里在文档仍有后续内容时删掉空块,并把光标放到原下一块开头。
 */
const DeleteEmptyFirstBlock = Extension.create({
  name: "yzDeleteEmptyFirstBlock",

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, view } = this.editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        const first = state.doc.firstChild;
        if (!first || !first.isTextblock || first.content.size > 0) return false;
        if ($from.parent !== first || $from.before(1) !== 0) return false;
        if (state.doc.childCount < 2) return false;

        const end = $from.after(1);
        const tr = state.tr.delete(0, end);
        const nextSelection = TextSelection.near(tr.doc.resolve(0), 1);
        view.dispatch(tr.setSelection(nextSelection).scrollIntoView());
        return true;
      },
    };
  },
});

/**
 * 删除处于列表中间的空列表项。
 *
 * ProseMirror 默认行为是把空列表项 lift 成段落:列表被切成两截,
 * 有序列表下半截的编号会重置为 1(删掉空行「17.」后,后面几条从
 * 1. 重新编号)。列表首/尾的空项保留默认 lift 行为(退出列表的常
 * 规操作);仅中间空项改为整项删除,前后仍是同一个列表,序号自动
 * 续排。无序列表同理,避免中间被插进一个空段落。
 */
const DeleteEmptyMiddleListItem = Extension.create({
  name: "yzDeleteEmptyMiddleListItem",
  // 抢在 StarterKit/ListItem 的默认 Backspace(拆分列表)之前处理
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, view } = this.editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if (!$from.parent.isTextblock || $from.parent.content.size > 0) return false;
        if ($from.depth < 3) return false;
        const listItem = $from.node($from.depth - 1);
        if (listItem.type.name !== "listItem") return false;
        const list = $from.node($from.depth - 2);
        if (list.type.name !== "bulletList" && list.type.name !== "orderedList") {
          return false;
        }
        const index = $from.index($from.depth - 2);
        if (index === 0 || index === list.childCount - 1) return false;

        const from = $from.before($from.depth - 1);
        const to = $from.after($from.depth - 1);
        const tr = state.tr.delete(from, to);
        // 光标落到上一条列表项末尾(而非下一条开头)
        const nextSelection = TextSelection.near(tr.doc.resolve(from - 1), -1);
        view.dispatch(tr.setSelection(nextSelection).scrollIntoView());
        return true;
      },
    };
  },
});

const TableHeaderAligned = TableHeader.extend({
  addAttributes() {
    return { ...withoutBuiltinAlign(this.parent?.()), ...textAlignAttr };
  },
});

/**
 * 统一 Schema:编辑器的唯一扩展集合(PRD §4.3)。
 * 图片为 inline 节点:GFM 中图片是行内语法,独立成段时视觉卡片化由 CSS 负责。
 */
export const baseExtensions = [
  // 内置 codeBlock 由 CodeBlockCard 取代(语言选择/复制/行号);Image 由 ImageCard 取代(宽度/对齐 UI);
  // Link 换成带 title 属性的扩展(标准 md 链接 title 不再静默丢弃,§4.6);
  // italic 换 ItalicAsteriskOnly,禁用 _…_ 粘贴/输入规则
  StarterKit.configure({
    codeBlock: false,
    link: false,
    italic: false,
    undoRedo: { depth: 100, newGroupDelay: 500 },
  }),
  ItalicAsteriskOnly,
  HeadingShortcuts,
  DeleteEmptyFirstBlock,
  DeleteEmptyMiddleListItem,
  TableImeCaret,
  Link.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        title: { default: null as string | null },
        // 自动链接内部标记(不入 DOM/不落 md):删除回退、实时生长时区分
        // 「自动链接痕迹」与用户手动创建的链接
        auto: { default: false as boolean, rendered: false },
      };
    },
    // 内置 autolink/linkOnPaste 用 linkifyjs,URL 后紧跟的「, (」会被整段吞进链接,
    // 与 md-open 路径(linkify-it)不一致且错误;换 yz 插件(见 extensions/autolink.ts)
    addOptions() {
      return {
        ...this.parent!(),
        autolink: false,
        linkOnPaste: false,
      };
    },
    addProseMirrorPlugins() {
      const markType = this.type;
      const shouldAutoLink = this.options.shouldAutoLink ?? (() => true);
      return [
        ...(this.parent?.() ?? []),
        yzAutolinkPlugin(markType, shouldAutoLink),
        yzPasteLinkPlugin(this.editor, markType, shouldAutoLink),
      ];
    },
  }),
  CodeBlockCard,
  Callout,
  Details,
  Attachment,
  MathInline,
  MathBlock,
  Highlight,
  FontColor,
  TaskList,
  TaskItem.configure({ nested: true }),
  ImageCard.configure({ inline: true }),
  // 列宽拖拽:colwidth 仅会话内有效,GFM 管道表无列宽语法,保存重开后回均分(与图片 width 同口径)
  Table.configure({
    resizable: true,
    handleWidth: 6,
    cellMinWidth: 48,
    lastColumnResizable: true,
  }),
  TableRow,
  TableHeaderAligned,
  TableCellAligned,
  EmptyDocPlaceholder.configure({ placeholder: "开始写作…" }),
  WikiLink,
  RawHtml,
];
