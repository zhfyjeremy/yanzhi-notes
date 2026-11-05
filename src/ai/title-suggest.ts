/**
 * AI 起标题(AI-2 文档操作):prompt、上下文裁剪与本地清洗。
 *
 * 点标题栏入口即请求(进行中披露 host/字数);标题建议不是正文回写结果,
 * 模型输出必须先清洗成可用文件名,再由用户点候选后走统一 rename_entry
 * 链路(标题=文件名,PRD 9.2)。
 */

export const TITLE_AI_CONTEXT_LIMIT = 12_000;
export const TITLE_AI_MAX_OUTPUT = 3;

export const TITLE_AI_SYSTEM = `你是中文文档标题助手。根据文档内容提出简短、具体、可作文件名的标题。
规则:
- 输出恰好 3 行,每行一个候选标题,不要编号、列表符号、Markdown 语法或解释。
- 每个标题 6-24 个字,优先概括主题而不是泛泛描述。
- 不使用 Windows/macOS 文件名非法字符:\\ / : * ? " < > |
- 不带 .md 扩展名,不使用句号结尾。`;

export function buildTitleContext(markdown: string): { text: string; chars: number; clipped: boolean } {
  const chars = Array.from(markdown.trim());
  return {
    text: chars.slice(0, TITLE_AI_CONTEXT_LIMIT).join(""),
    chars: chars.length,
    clipped: chars.length > TITLE_AI_CONTEXT_LIMIT,
  };
}

export function titleSuggestUserPrompt(markdown: string): string {
  return `请为以下文档提出 3 个标题候选:\n\n${markdown}`;
}

/** 稳定本地指纹:用于请求返回后判断文档路径/内容是否已变化。 */
export function markdownFingerprint(markdown: string): string {
  let hash = 0x811c9dc5;
  let chars = 0;
  for (const ch of markdown) {
    chars += 1;
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${chars}:${hash.toString(16).padStart(8, "0")}`;
}

function unwrapMatching(raw: string, open: string, close: string): string {
  if (raw.startsWith(open) && raw.endsWith(close) && raw.length >= open.length + close.length) {
    return raw.slice(open.length, -close.length).trim();
  }
  return raw;
}

function stripTitleFormatting(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^#{1,6}\s+/u, "");
  out = out.replace(/^[-*+]\s+/u, "");
  out = out.replace(/^\d+(?:[.、)])\s*/u, "");
  out = out.replace(/^```[^\n]*$/iu, "").replace(/```$/u, "");
  for (const [open, close] of [
    ["**", "**"],
    ["*", "*"],
    ["__", "__"],
    ["_", "_"],
    ["`", "`"],
    ["“", "”"],
    ['"', '"'],
  ] as const) {
    out = unwrapMatching(out, open, close);
  }
  return out.trim();
}

/** UTF-8 字节 + Unicode 字符双限制,避免标题好看但文件名超出系统限制。 */
function truncateForFilename(raw: string): string {
  const chars = Array.from(raw);
  const kept: string[] = [];
  let bytes = 0;
  for (const ch of chars) {
    const size = new TextEncoder().encode(ch).length;
    if (kept.length >= 48 || bytes + size > 180) break;
    kept.push(ch);
    bytes += size;
  }
  return kept.join("").trim().replace(/\.+$/u, "");
}

export function sanitizeAiTitle(raw: string): string | null {
  let out = stripTitleFormatting(raw);
  out = out.replace(/\.md$/iu, "");
  out = out.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, "");
  out = out.replace(/\s+/gu, " ").trim().replace(/\.+$/u, "");
  out = truncateForFilename(out);
  if (!out || /^[(（](?:无|none)[)）]$/iu.test(out)) return null;
  if (!/\p{L}|\p{N}/u.test(out)) return null;
  return out;
}

export function parseAiTitleSuggestions(raw: string): string[] {
  const titles: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const title = sanitizeAiTitle(line);
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length === TITLE_AI_MAX_OUTPUT) break;
  }
  return titles;
}
