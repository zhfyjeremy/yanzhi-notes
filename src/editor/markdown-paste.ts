import { Slice } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { markdownToDoc } from "./markdown/parse";

/**
 * Markdown 源码粘贴 → 直接进入排版视图。
 * 纯文本,以及只是作为纯文本载体的 HTML(VS Code/代码编辑器/失败粘贴后的 PM 副本),
 * 都走同一条 md-it → PM 管线;语义富文本仍走 transformPastedHTML 的粘贴清洗。
 */

/** 只拦截“看起来是 Markdown 源码”的纯文本;普通文本仍走 PM 默认粘贴。 */
const MARKDOWN_SYNTAX_RE = new RegExp(
  [
    "^\\s*(?:```|~~~)",
    String.raw`^\s{0,3}(?:#{1,6}\s+\S|>(?:\s|\$)|(?:[-*+]\s+\S)|(?:\d+[.)]\s+\S)|-{3,}|\*{3,})`,
    String.raw`^\s*\|.*\|\s*$`,
    String.raw`(?:^|\n)\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]`,
    String.raw`!?\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]|==[^=]+==|\*\*[^*]+\*\*|` + "`[^`]+`",
    String.raw`^\s*<[a-z][^>]*>`,
    String.raw`^\s*:::.+$`,
  ].join("|"),
  "im",
);

function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_SYNTAX_RE.test(text) || /^\s*\S.*\n\s*(?:={3,}|-{3,})\s*$/.test(text);
}

/** Windows CF_HTML 可能连 Version/StartFragment 头一起到达,先剥掉头再判断结构。 */
function clipboardHtmlFragment(html: string): string {
  const match = html.match(/<html[\s>]/i);
  return match?.index ? html.slice(match.index) : html;
}

/**
 * 判断 HTML 是否只是 Markdown 源码载体。
 * VS Code/代码编辑器常用 span+div+monospace;失败粘贴后的砚知副本是 p+br+font。
 * 这些都没有 h1/ul/table/blockquote 等真实语义结构,不能按富文本清洗处理。
 */
function isMarkdownSourceHtml(html: string): boolean {
  const body = new DOMParser().parseFromString(clipboardHtmlFragment(html), "text/html").body;
  return !body.querySelector("h1,h2,h3,h4,h5,h6,ul,ol,table,blockquote");
}
export function handleMarkdownPaste(view: EditorView, event: ClipboardEvent): boolean {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;

  const types = Array.from(clipboard.types ?? []).map((type) => type.toLowerCase());
  const markdown = clipboard.getData("text/plain");
  if (!markdown.trim() || !looksLikeMarkdown(markdown)) return false;

  // 语义富文本走 HTML 清洗;VS Code/PM 这类纯文本载体 HTML 按 Markdown 解析。
  const html = types.includes("text/html") ? clipboard.getData("text/html") : "";
  if (html.trim() && !isMarkdownSourceHtml(html)) return false;

  // 代码块内粘贴源码必须原样保留,不能把 #、**、表格线再渲染成排版节点。
  const parent = view.state.selection.$from.parent;
  if (parent.type.name === "codeBlock") return false;

  try {
    const parsed = markdownToDoc(markdown, view.state.schema);
    if (!parsed.childCount) return false;
    event.preventDefault();
    view.dispatch(view.state.tr.replaceSelection(new Slice(parsed.content, 0, 0)).scrollIntoView());
    return true;
  } catch (error) {
    console.error("[editor] Markdown 粘贴解析失败,回退默认粘贴:", error);
    return false;
  }
}