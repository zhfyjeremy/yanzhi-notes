import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { WikiLink } from "./extensions/wiki-link";
import { RawHtml } from "./extensions/raw-html";
import { CodeBlockCard } from "./extensions/code-block-card";
import { ImageCard } from "./extensions/image-card";
import { Callout } from "./extensions/callout";
import { Details } from "./extensions/details";
import { Attachment } from "./extensions/attachment";
import { MathInline, MathBlock } from "./extensions/math";
import { FontColor } from "./extensions/font-color";

/** GFM 表格对齐属性(:--- / :---: / ---:) */
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

const TableCellAligned = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...textAlignAttr };
  },
});

const TableHeaderAligned = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...textAlignAttr };
  },
});

/**
 * 统一 Schema:编辑器的唯一扩展集合(PRD §4.3)。
 * 图片为 inline 节点:GFM 中图片是行内语法,独立成段时视觉卡片化由 CSS 负责。
 */
export const baseExtensions = [
  // 内置 codeBlock 由 CodeBlockCard 取代(语言选择/复制/行号);Image 由 ImageCard 取代(宽度/对齐 UI);
  // Link 换成带 title 属性的扩展(标准 md 链接 title 不再静默丢弃,§4.6)
  StarterKit.configure({ codeBlock: false, link: false }),
  Link.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        title: { default: null as string | null },
      };
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
  Placeholder.configure({ placeholder: "开始写作…" }),
  WikiLink,
  RawHtml,
];
