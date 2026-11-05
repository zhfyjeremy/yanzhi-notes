import type { Node as PMNode } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { markdownToDoc } from "./markdown/parse";

/**
 * 粘贴纯文本双链([[目标]] / [[目标|别名]])时补走 md → HTML → PM 单一路径。
 * ProseMirror 粘贴不会触发 input rule;不拦截会把合法方言当成普通文本,
 * 直到文档重新打开才会被 markdown 解析成 wikiLink。
 */
const WIKI_LINK_TEXT_RE = /^\[\[([^|\]\n]+)(?:\|([^\]\n]*))?\]\]$/u;

function wikiLinkNodeFromText(text: string, schema: Schema): PMNode | null {
  const normalized = text.trim();
  const match = normalized.match(WIKI_LINK_TEXT_RE);
  if (!match || !match[1].trim() || !(match[2] ?? match[1]).trim()) return null;

  const parsed = markdownToDoc(normalized, schema);
  let node: PMNode | null = null;
  parsed.descendants((child) => {
    if (
      !node &&
      child.type.name === "text" &&
      child.marks.some((mark) => mark.type.name === "wikiLink")
    ) {
      node = child;
      return false;
    }
    return !node;
  });
  return node;
}

/** 只接管「整段恰好是一个双链」的纯文本;普通文本/混合片段保持 PM 原生粘贴语义。 */
export function handleWikiLinkPaste(view: EditorView, event: ClipboardEvent): boolean {
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return false;
  const node = wikiLinkNodeFromText(text, view.state.schema);
  if (!node) return false;

  event.preventDefault();
  view.dispatch(view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
  return true;
}
