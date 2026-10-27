import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import { WikiLink } from "./extensions/wiki-link";
import { RawHtml } from "./extensions/raw-html";

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
 * 统一 Schema:两种编辑模式共用的扩展集合(PRD §4.5)。
 * 块交互插件(BlockHandle / BlockDrag / BlockMenu)不在此列,
 * 由 block 模式通过 editor.registerPlugin 动态挂载,flow 模式完全卸载。
 * 图片为 inline 节点:GFM 中图片是行内语法,独立成段时视觉卡片化由 CSS 负责。
 */
export const baseExtensions = [
  StarterKit,
  Highlight,
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ inline: true }),
  Table,
  TableRow,
  TableHeaderAligned,
  TableCellAligned,
  Placeholder.configure({ placeholder: "开始写作…" }),
  WikiLink,
  RawHtml,
];
