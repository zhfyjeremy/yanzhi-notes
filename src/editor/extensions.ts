import StarterKit from "@tiptap/starter-kit";
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
  // 内置 codeBlock 由 CodeBlockCard 取代(语言选择/复制/行号);Image 由 ImageCard 取代(宽度/对齐 UI)
  StarterKit.configure({ codeBlock: false }),
  CodeBlockCard,
  Highlight,
  FontColor,
  TaskList,
  TaskItem.configure({ nested: true }),
  ImageCard.configure({ inline: true }),
  Table,
  TableRow,
  TableHeaderAligned,
  TableCellAligned,
  Placeholder.configure({ placeholder: "开始写作…" }),
  WikiLink,
  RawHtml,
];
