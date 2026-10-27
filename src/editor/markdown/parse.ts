import { DOMParser } from "@tiptap/pm/model";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import { mdToHtml } from "./md-instance";

/**
 * Markdown → PM doc(md → HTML → DOMParser,单一 schema)。
 * 无法识别的 HTML 片段由 schema 的未知内容策略保留为文本(§4.6,禁止静默丢弃)。
 */
export function markdownToDoc(markdown: string, schema: Schema): PMNode {
  const html = mdToHtml(markdown);
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html;
  return DOMParser.fromSchema(schema).parse(wrapper);
}
