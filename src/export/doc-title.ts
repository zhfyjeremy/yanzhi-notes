/**
 * 导出时补「文档标题」的公共口径(PRD 5.2 / 9.2:标题 = 文件名去 .md)。
 *
 * 规则:正文里已经写了同名 H1 就不重复加;否则在导出产物顶部补一个标题。
 * 目的:导出的文件脱离砚知后仍是自解释的 —— 收件人/打印件能看到这是什么文档,
 * 而不只是从一堆正文开始读。
 *
 * 四种导出(Markdown / 离线 HTML / PDF / DOCX)共用这一套判断,避免各写各的
 * 出现「MD 有标题、Word 没有」这种不一致。
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { mdToHtml } from "@/editor/markdown/md-instance";

/** 去掉行内 Markdown 修饰,用于比较「是不是同名标题」 */
export function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) =>
      (label ?? target).trim(),
    )
    .replace(/==/g, "")
    .replace(/[*_`~]/g, "")
    .trim();
}

/** 标题规范化:去首尾空白、去 `.md` 后缀 */
export function normalizeDocTitle(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\.md$/i, "").trim();
}

/**
 * Markdown 里是否已有同名 H1。
 * 走真实解析(mdToHtml)而不是正则抠行 —— Markdown 的 ATX 规则会吃掉行尾的 `#`
 * (`# 笔记 #` 实际解析成「笔记」),正则判断会和真实渲染对不上。
 */
export function mdHasTitleHeading(md: string, title: string): boolean {
  const target = normalizeDocTitle(title);
  if (!target) return false;
  const html = mdToHtml(md ?? "");
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("h1")).some(
    (h1) => plainInline(h1.textContent ?? "") === target,
  );
}

/** PM doc 里是否已有同名 H1 */
export function docHasTitleHeading(doc: PMNode, title: string): boolean {
  const target = normalizeDocTitle(title);
  if (!target) return false;
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name !== "heading") return true;
    if (Number(node.attrs.level ?? 1) !== 1) return true;
    if (plainInline(node.textContent) === target) found = true;
    return false;
  });
  return found;
}

/**
 * 标题里的 `#` 全部转义。
 * Markdown 里 `#` 有两处会被吃掉:行首的 ATX 标记,以及行尾的 ATX 闭合序列
 * (`# 笔记 #` 会被解析成「笔记」)。标题是我们自己拼进去的一行,统一转义最省心。
 */
function escapeMdTitle(title: string): string {
  return title.replace(/#/g, "\\#");
}

/**
 * 补标题后的 Markdown。
 * 标题在正文最前面,空文档只留标题。
 */
export function withMdTitle(md: string, title: string): string {
  const target = normalizeDocTitle(title);
  if (!target) return md;
  if (mdHasTitleHeading(md, target)) return md;
  const heading = `# ${escapeMdTitle(target)}`;
  const body = (md ?? "").replace(/^\n+/, "");
  return body.trim() ? `${heading}\n\n${body}` : `${heading}\n`;
}
