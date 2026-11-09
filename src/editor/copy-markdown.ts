import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { docToMarkdown } from "./markdown/serialize";

/**
 * 复制为 Markdown:与磁盘保存共用 docToMarkdown 唯一出口。
 * 页面级选区在 PM Slice 中可能是行内 fragment;补一层 paragraph 才能走文档序列化。
 */
export function markdownForRange(
  doc: PMNode,
  schema: Schema,
  from: number,
  to: number,
): string {
  if (from === to) return docToMarkdown(doc);
  const slice = doc.slice(from, to);
  if (!slice.content.size) return "";
  let content = slice.content;
  if (slice.content.firstChild?.isInline) {
    const paragraph = schema.nodes.paragraph.create(null, content);
    content = Fragment.from(paragraph);
  }
  return docToMarkdown(schema.nodes.doc.create(null, content));
}
