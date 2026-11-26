/**
 * 离线 HTML 导出(PRD 5.6):单文档 → 自包含 HTML,样式全内联,
 * 打开即可阅读(微信/邮件/浏览器直接看);图片转 base64 data URL 内嵌
 * (导出产物是派生物,base64 只出现在这里,不进 md 正文,9.3 红线不破)。
 * 导出渲染与编辑器保持同一套特殊卡片语义:Shiki 代码、Mermaid、KaTeX、
 * Callout/Details/Attachment、Raw HTML 安全预览;不导出编辑态控件。
 */

import { mdToHtml } from "@/editor/markdown/md-instance";
import { inlineStyles } from "@/editor/clipboard";
import { highlightCodeElements } from "@/editor/extensions/code-highlight";
import { katexHtml, decodeLatex } from "@/editor/extensions/math";
import { renderMermaid } from "@/editor/extensions/mermaid";
import { sanitizeRawHtmlPreview } from "@/editor/extensions/raw-html-preview";
import { assetRelPosix, isExternalSrc } from "./asset-src";
import { normalizeDocTitle, plainInline } from "@/export/doc-title";
import type { CodeThemeId } from "../settings";

export interface ExportHtmlOptions {
  md: string;
  title: string;
  docRel: string;
  /** 库内相对路径 → base64(取不到返回 null,该图保留原相对引用) */
  readAssetBase64: (rel: string) => Promise<{ data: string; mime: string } | null>;
  /** 内置离线代码主题;默认跟随砚知浅色导出 */
  codeTheme?: CodeThemeId;
  /** 文档标题横幅对齐;默认居左 */
  titleAlign?: "left" | "center";
  /** 是否在顶部补文档名标题;默认 true。正文已有同名 H1 时本就不重复加 */
  includeDocTitle?: boolean;
  /** 是否保留 HTML 左侧大纲;PDF 导出同开关控制阅读器大纲书签。默认 true */
  includeOutline?: boolean;
  /** 导出 PDF 时注入大纲书签标记(HTML 导出不注入,保持成品干净) */
  pdfBookmarks?: boolean;
}

const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const CODE_VARIABLE_NAMES = [
  "bg",
  "border",
  "fg",
  "kw",
  "fn",
  "str",
  "emb",
  "cm",
  "num",
  "var",
  "op",
  "link",
  "ins",
  "del",
  "chg",
  "tag",
  "attr",
] as const;

type CodeVariableName = (typeof CODE_VARIABLE_NAMES)[number];

/** 导出兜底值 = HTML 导出原有浅色代码色;主题存在时由 index.css 计算值覆盖。 */
const DEFAULT_CODE_VARIABLES: Record<CodeVariableName, string> = {
  bg: "#f0ede6",
  border: "#d9d2c5",
  fg: "#231f1c",
  kw: "hsl(348 76% 46%)",
  fn: "hsl(258 55% 52%)",
  str: "hsl(130 32% 32%)",
  emb: "hsl(190 75% 30%)",
  cm: "hsl(25 8% 42%)",
  num: "hsl(212 82% 42%)",
  var: "hsl(212 40% 42%)",
  op: "hsl(350 22% 46%)",
  link: "hsl(204 89% 40%)",
  ins: "hsl(135 42% 34%)",
  del: "hsl(0 68% 46%)",
  chg: "hsl(204 78% 42%)",
  tag: "hsl(24 72% 42%)",
  attr: "hsl(150 45% 32%)",
};

/**
 * 从当前应用的 design tokens 读取主题。编辑器页面已加载 index.css,
 * 这里用隐藏探针拿 [data-code-theme] 的计算值,导出不复制第二套主题色。
 */
function readCodeThemeVariables(theme: CodeThemeId): Record<CodeVariableName, string> {
  const values = { ...DEFAULT_CODE_VARIABLES };
  if (theme === "yanzhi" || typeof document === "undefined") return values;

  const probe = document.createElement("div");
  probe.dataset.codeTheme = theme;
  probe.style.display = "none";
  document.body.append(probe);
  try {
    const computed = getComputedStyle(probe);
    for (const name of CODE_VARIABLE_NAMES) {
      const value = computed.getPropertyValue(`--code-${name}`).trim();
      if (value) values[name] = value;
    }
  } finally {
    probe.remove();
  }
  return values;
}

function codeThemeOf(theme: CodeThemeId): { css: string; background: string } {
  const values = readCodeThemeVariables(theme);
  const declarations = CODE_VARIABLE_NAMES.map(
    (name) => `--code-${name}: ${values[name]};`,
  );
  return {
    css: `:root {${declarations.join("")}}`,
    background: values.bg,
  };
}

const PAGE_STYLE = `
:root {
  color-scheme: light;
  --page-fg: #231f1c;
  --page-bg: #faf9f7;
  --page-muted: #7a7267;
  --page-border: #d9d2c5;
  --page-blue: #0b71c6;
  --callout-c: #1778c4;
  --callout-bg: #edf5fc;
}
* { box-sizing: border-box; }
@page { size: A4; margin: 16mm; }
body {
  margin: 0;
  padding: 0;
  background: var(--page-bg);
  font-family: ${FONT_SANS};
  font-size: 16px;
  line-height: 1.6;
  letter-spacing: 0.004em;
  word-break: break-word;
}
/* 两栏:左侧大纲(阅读导航)+ 右侧正文 */
.yz-layout {
  display: flex;
  align-items: flex-start;
  gap: 48px;
  max-width: 1180px;
  margin: 0 auto;
  padding: 48px 24px 96px;
}
.yz-content {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 848px;
  color: var(--page-fg);
}
/* 无标题文档:没有大纲,正文仍按 848px 居中 */
.yz-layout-solo { max-width: 848px; }
.yz-toc {
  flex: 0 0 232px;
  position: sticky;
  top: 48px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  border-right: 1px solid var(--page-border);
  padding-right: 16px;
  font-size: 0.8125em;
  line-height: 1.5;
}
.yz-toc-title {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0;
  border: none;
  background: none;
  font-family: inherit;
  cursor: pointer;
  font-size: 0.75em;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--page-muted);
  margin: 0 0 0.6em;
}
.yz-toc-title:hover { color: var(--page-fg); }
.yz-toc-list { list-style: none; margin: 0; padding: 0; }
.yz-toc-list li { margin: 0; }
.yz-toc-link {
  display: block;
  padding: 3px 0;
  color: var(--page-muted);
  text-decoration: none;
  border-left: 2px solid transparent;
  padding-left: 10px;
  overflow-wrap: anywhere;
}
.yz-toc-link:hover { color: var(--page-fg); }
.yz-toc-link[aria-current="true"] {
  color: var(--page-blue);
  border-left-color: var(--page-blue);
  font-weight: 600;
}
/* 窄屏(手机/邮件预览宽度):大纲移到正文上方,不再占侧栏 */
@media (max-width: 900px) {
  .yz-layout { display: block; max-width: 848px; padding: 24px 16px 64px; }
  .yz-content { max-width: none; }
  .yz-toc {
    position: static;
    max-height: none;
    overflow: visible;
    border-right: none;
    border-bottom: 1px solid var(--page-border);
    padding: 0 0 12px;
    margin-bottom: 24px;
  }
}
/* 折叠状态:窄屏默认折叠(脚本加类),宽屏可手动折叠 */
body.yz-toc-collapsed .yz-toc-list { display: none; }
body.yz-toc-collapsed .yz-toc-title::after { content: " ▸"; }
h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.15em 0 0.45em; font-weight: 600; }
/* 文档标题横幅:正文没有同名 H1 时补的一个文档名 */
.yz-doc-title {
  font-size: 2.8em;
  letter-spacing: -0.02em;
  margin: 0 0 1em;
}
h1 { font-size: 1.9em; margin-top: 0.4em; letter-spacing: -0.018em; }
h2 { font-size: 1.5em; letter-spacing: -0.018em; }
h3 { font-size: 1.22em; letter-spacing: -0.018em; }
p { margin: 0.75em 0; }
img { max-width: 100%; height: auto; }
table { margin: 1em 0; }
/* 默认左对齐:浏览器 UA 样式给 th 的默认值是居中、td 是左对齐,
   不统一的话导出页表头居中、内容左对齐。显式对齐走 inline style,优先级更高。 */
th, td { text-align: left; }
pre {
  margin: 1em 0;
  padding: 0.9em 1.1em;
  background: var(--code-bg, #f0ede6);
  color: var(--code-fg, var(--page-fg));
  border-radius: 6px;
  font-family: ${FONT_MONO};
  font-size: 0.875em;
  line-height: 1.7;
  white-space: pre;
  overflow-x: auto;
}
pre code { font: inherit; }
.yz-tok-kw { color: var(--code-kw); }
.yz-tok-fn { color: var(--code-fn); }
.yz-tok-str { color: var(--code-str); }
.yz-tok-emb { color: var(--code-emb); }
.yz-tok-cm { color: var(--code-cm); }
.yz-tok-num { color: var(--code-num); }
.yz-tok-var { color: var(--code-var); }
.yz-tok-op { color: var(--code-op); }
.yz-tok-link { color: var(--code-link); }
.yz-tok-ins { color: var(--code-ins); }
.yz-tok-del { color: var(--code-del); }
.yz-tok-chg { color: var(--code-chg); }
.yz-tok-tag { color: var(--code-tag); }
.yz-tok-attr { color: var(--code-attr); }
input[type="checkbox"] { margin-right: 0.35em; }
.yz-callout {
  border-left: 3px solid var(--callout-c);
  background: var(--callout-bg);
  border-radius: 6px;
  padding: 0.6em 0.9em;
  margin: 1em 0;
}
.yz-callout[data-callout="success"] { --callout-c: hsl(152 62% 27%); --callout-bg: hsl(152 40% 95%); }
.yz-callout[data-callout="warning"] { --callout-c: hsl(32 92% 30%); --callout-bg: hsl(38 90% 95%); }
.yz-callout[data-callout="caution"] { --callout-c: hsl(4 78% 44%); --callout-bg: hsl(4 70% 96%); }
.yz-callout-head {
  display: flex; align-items: center; gap: 0.5em;
  color: var(--callout-c); font-weight: 600; font-size: 0.95em;
  line-height: 1.6; margin-bottom: 0.2em;
}
.yz-callout-icon { width: 1em; height: 1em; flex-shrink: 0; }
.yz-callout-title-placeholder { color: var(--page-muted); font-weight: 400; }
.yz-details {
  border: 1px solid var(--page-border);
  border-radius: 6px;
  padding: 0.35em 0.75em;
  margin: 1em 0;
}
.yz-details summary {
  font-weight: 600; font-size: 0.95em; line-height: 1.6;
  cursor: pointer; white-space: break-spaces;
}
.yz-details-body { padding-top: 0.2em; }
.yz-attachment { margin: 1em 0; }
.yz-attachment-btn {
  display: inline-flex; align-items: center; gap: 0.5em;
  max-width: 100%; padding: 0.4em 0.9em;
  border: 1px solid var(--page-border); border-radius: 6px;
  color: var(--page-fg); background: #fff;
  font-size: 0.95em; line-height: 1.6; text-decoration: none;
}
.yz-attachment-icon { width: 1.1em; height: 1.1em; flex-shrink: 0; color: var(--page-blue); }
.yz-attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yz-math-block {
  border: 1px solid var(--page-border);
  border-radius: 6px;
  padding: 0.75em 1em;
  margin: 1em 0;
  text-align: center;
}
.yz-math-block .katex-display { margin: 0; }
.yz-math-empty { color: var(--page-muted); }
.yz-mmd-stage { min-height: 3em; padding: 0.5em 0; margin: 1em 0; }
.yz-mmd-svg { overflow-x: auto; }
.yz-mmd-svg svg { max-width: 100%; height: auto; }
.yz-mmd-empty, .yz-mmd-error { color: var(--page-muted); font-size: 0.9em; padding: 0.6em 0; }
.yz-mmd-error { color: hsl(4 78% 44%); overflow-wrap: anywhere; }
.yz-mmd-error-detail { display: block; margin-top: 0.3em; color: var(--page-muted); font-family: ${FONT_MONO}; font-size: 0.85em; opacity: 0.8; }
.yz-raw-html-preview {
  display: block; width: 100%; height: 240px;
  border: 0; border-radius: 0;
  background: transparent; overflow: hidden; margin: 0;
}
.yz-raw-html-preview iframe { display: block; width: 100%; border: 0; background: #fff; }

/* 打印版只留正文:大纲是阅读导航,印成纸没有意义。
   放在最后 —— 同优先级下后写的规则赢,放前面会被上面的 .yz-layout 覆盖掉。 */
@media print {
  body {
    max-width: none;
    padding: 0;
    background: #fff;
  }
  .yz-layout { display: block !important; max-width: none !important; padding: 0 !important; }
  .yz-content { max-width: none !important; }
  .yz-toc { display: none !important; }
  pre {
    white-space: pre-wrap;
    overflow: visible;
    break-inside: avoid;
  }
  table {
    width: 100%;
    table-layout: fixed;
  }
  th, td { overflow-wrap: anywhere; }
  img, .yz-callout, .yz-details, .yz-math-block, .yz-mmd-stage, .yz-raw-html-preview {
    break-inside: avoid;
  }
}
`;

const RAW_HTML_IFRAME_CSS = `
--foreground: #231f1c;
--editor: #fff;
--border-subtle: #e6e0d6;
--font-sans: ${FONT_SANS};
`;

const KATEX_FONT_IMPORTS: Record<string, () => Promise<{ default: string }>> = {
  "KaTeX_AMS-Regular.woff2": () => import("katex/dist/fonts/KaTeX_AMS-Regular.woff2?url"),
  "KaTeX_Caligraphic-Bold.woff2": () => import("katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?url"),
  "KaTeX_Caligraphic-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?url"),
  "KaTeX_Fraktur-Bold.woff2": () => import("katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?url"),
  "KaTeX_Fraktur-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?url"),
  "KaTeX_Main-Bold.woff2": () => import("katex/dist/fonts/KaTeX_Main-Bold.woff2?url"),
  "KaTeX_Main-BoldItalic.woff2": () => import("katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?url"),
  "KaTeX_Main-Italic.woff2": () => import("katex/dist/fonts/KaTeX_Main-Italic.woff2?url"),
  "KaTeX_Main-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Main-Regular.woff2?url"),
  "KaTeX_Math-BoldItalic.woff2": () => import("katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?url"),
  "KaTeX_Math-Italic.woff2": () => import("katex/dist/fonts/KaTeX_Math-Italic.woff2?url"),
  "KaTeX_SansSerif-Bold.woff2": () => import("katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?url"),
  "KaTeX_SansSerif-Italic.woff2": () => import("katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?url"),
  "KaTeX_SansSerif-Regular.woff2": () => import("katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?url"),
  "KaTeX_Script-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Script-Regular.woff2?url"),
  "KaTeX_Size1-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Size1-Regular.woff2?url"),
  "KaTeX_Size2-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Size2-Regular.woff2?url"),
  "KaTeX_Size3-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Size3-Regular.woff2?url"),
  "KaTeX_Size4-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Size4-Regular.woff2?url"),
  "KaTeX_Typewriter-Regular.woff2": () => import("katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?url"),
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** KaTeX CSS 与 woff2 全部内嵌,导出的公式离线打开也不丢字形。 */
async function embeddedKatexCss(): Promise<string> {
  const { KATEX_EXPORT_CSS } = await import("./katex-export-css");
  const css = KATEX_EXPORT_CSS;
  const names = [...css.matchAll(/fonts\/([^)]+\.woff2)/g)].map((match) => match[1]);
  const entries = await Promise.all(
    [...new Set(names)].map(async (name) => {
      const loader = KATEX_FONT_IMPORTS[name];
      if (!loader) return [name, null] as const;
      try {
        const { default: url } = await loader();
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        return [name, `data:font/woff2;base64,${bytesToBase64(bytes)}`] as const;
      } catch {
        return [name, null] as const;
      }
    }),
  );
  const fonts = new Map(entries);
  return css.replace(/@font-face\s*\{[^}]+\}/g, (block) => {
    const name = block.match(/fonts\/([^)]+\.woff2)/)?.[1];
    const data = name ? fonts.get(name) : null;
    if (!data) return block;
    return block.replace(/src:[^;}]+;?/, `src: url(${data}) format("woff2");`);
  });
}

function appendSvgChild(svg: SVGElement, tag: string, attrs: Record<string, string>) {
  const child = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, value);
  svg.append(child);
}

function calloutIcon(doc: Document, type: string): SVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (type === "success") {
    appendSvgChild(svg, "circle", { cx: "12", cy: "12", r: "10" });
    appendSvgChild(svg, "path", { d: "m16 9-5.5 5.5L8 12" });
  } else if (type === "warning") {
    appendSvgChild(svg, "path", {
      d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    });
    appendSvgChild(svg, "path", { d: "M12 9v4" });
    appendSvgChild(svg, "path", { d: "M12 17h.01" });
  } else if (type === "caution") {
    appendSvgChild(svg, "path", { d: "M12 16h.01" });
    appendSvgChild(svg, "path", { d: "M12 8v4" });
    appendSvgChild(svg, "path", {
      d: "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",
    });
  } else {
    appendSvgChild(svg, "circle", { cx: "12", cy: "12", r: "10" });
    appendSvgChild(svg, "path", { d: "M12 16v-4" });
    appendSvgChild(svg, "path", { d: "M12 8h.01" });
  }
  return svg;
}

function attachmentIcon(doc: Document): SVGElement {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  appendSvgChild(svg, "path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" });
  appendSvgChild(svg, "path", { d: "M14 2v4a2 2 0 0 0 2 2h4" });
  return svg;
}

function renderCallouts(root: ParentNode) {
  for (const callout of Array.from(root.querySelectorAll<HTMLElement>("[data-callout]"))) {
    callout.classList.add("yz-callout");
    const type = callout.getAttribute("data-callout") ?? "info";
    const head = callout.ownerDocument.createElement("div");
    head.className = "yz-callout-head";
    const icon = calloutIcon(callout.ownerDocument, type);
    icon.classList.add("yz-callout-icon");
    head.append(icon);
    const title = callout.getAttribute("data-title") ?? "";
    const titleEl = callout.ownerDocument.createElement("span");
    if (title) {
      titleEl.className = "yz-callout-title";
      titleEl.textContent = title;
    } else {
      titleEl.className = "yz-callout-title yz-callout-title-placeholder";
      titleEl.textContent = "标题(可选)";
    }
    head.append(titleEl);
    callout.prepend(head);
    if (!callout.children.length) callout.append(callout.ownerDocument.createElement("p"));
  }
}

function renderDetails(root: ParentNode) {
  for (const source of Array.from(root.querySelectorAll<HTMLElement>("[data-details]"))) {
    const doc = source.ownerDocument;
    const details = doc.createElement("details");
    details.className = "yz-details";
    if (source.hasAttribute("data-open")) details.open = true;
    const summary = doc.createElement("summary");
    summary.textContent = source.getAttribute("data-summary") || "摘要标题";
    const body = doc.createElement("div");
    body.className = "yz-details-body";
    body.append(...Array.from(source.childNodes));
    if (!body.firstChild) body.append(doc.createElement("p"));
    details.append(summary, body);
    source.replaceWith(details);
  }
}

function renderAttachments(root: ParentNode) {
  for (const source of Array.from(root.querySelectorAll<HTMLElement>("[data-attachment]"))) {
    const doc = source.ownerDocument;
    const anchor = doc.createElement("a");
    anchor.className = "yz-attachment-btn";
    anchor.href = source.getAttribute("data-href") ?? "";
    const icon = attachmentIcon(doc);
    icon.classList.add("yz-attachment-icon");
    const name = doc.createElement("span");
    name.className = "yz-attachment-name";
    name.textContent = source.getAttribute("data-name") ?? "附件";
    anchor.append(icon, name);
    source.replaceWith(anchor);
  }
}

function renderMath(root: ParentNode): boolean {
  let used = false;
  for (const source of Array.from(root.querySelectorAll<HTMLElement>("[data-math-inline]"))) {
    const doc = source.ownerDocument;
    const output = doc.createElement("span");
    output.className = "yz-math-inline";
    const latex = decodeLatex(source.getAttribute("data-latex"));
    if (!latex.trim()) {
      output.textContent = "空公式";
      output.classList.add("yz-math-empty");
    } else {
      output.innerHTML = katexHtml(latex, false);
    }
    source.replaceWith(output);
    used = true;
  }
  for (const source of Array.from(root.querySelectorAll<HTMLElement>("[data-math-block]"))) {
    const doc = source.ownerDocument;
    const output = doc.createElement("div");
    output.className = "yz-math-block";
    const latex = decodeLatex(source.getAttribute("data-latex"));
    if (!latex.trim()) {
      output.textContent = "空公式";
      output.classList.add("yz-math-empty");
    } else {
      output.innerHTML = katexHtml(latex, true);
    }
    source.replaceWith(output);
    used = true;
  }
  return used;
}

async function renderMermaidBlocks(root: ParentNode) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  if (!blocks.length) return;
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) continue;
    const source = code.textContent ?? "";
    const doc = code.ownerDocument;
    const stage = doc.createElement("div");
    stage.className = "yz-mmd-stage";
    if (!source.trim()) {
      const empty = doc.createElement("div");
      empty.className = "yz-mmd-empty";
      empty.textContent = "空图表,双击或点右上角「源码」编辑";
      stage.append(empty);
    } else {
      try {
        const svg = await renderMermaid(source, false);
        const holder = doc.createElement("div");
        holder.className = "yz-mmd-svg";
        holder.innerHTML = svg;
        stage.append(holder);
      } catch (error) {
        const failed = doc.createElement("div");
        failed.className = "yz-mmd-error";
        failed.textContent = "图表语法有误,请检查源码";
        const detail = doc.createElement("span");
        detail.className = "yz-mmd-error-detail";
        detail.textContent = error instanceof Error ? error.message : String(error);
        failed.append(detail);
        stage.append(failed);
      }
    }
    pre.replaceWith(stage);
  }
}

async function embedLocalImages(root: ParentNode, opts: ExportHtmlOptions) {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!src || isExternalSrc(src)) continue;
    const rel = assetRelPosix(opts.docRel, src);
    if (!rel) continue;
    const data = await opts.readAssetBase64(rel).catch(() => null);
    if (data) img.setAttribute("src", `data:${data.mime};base64,${data.data}`);
  }
}

async function renderRawHtml(root: ParentNode, opts: ExportHtmlOptions) {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-raw-html]"));
  if (!nodes.length) return;
  for (const source of nodes) {
    const raw = decodeURIComponent(source.getAttribute("data-raw-html") ?? "");
    const sanitized = sanitizeRawHtmlPreview(raw, RAW_HTML_IFRAME_CSS, (src) => src);
    const frameDoc = new DOMParser().parseFromString(sanitized, "text/html");
    await embedLocalImages(frameDoc.body, opts);
    const doc = source.ownerDocument;
    const shell = doc.createElement("div");
    shell.className = "yz-raw-html-preview";
    const frame = doc.createElement("iframe");
    frame.title = "HTML 块";
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.srcdoc = `<!doctype html>${frameDoc.documentElement.outerHTML}`;
    frame.setAttribute(
      "onload",
      "(function(){var f=this;var r=function(){try{var d=f.contentDocument;if(!d)return;f.height=Math.max(96,Math.min(720,d.body.scrollHeight+16));}catch(e){}};r();if(f.contentWindow)f.contentWindow.addEventListener('load',r);}).call(this)",
    );
    shell.append(frame);
    source.replaceWith(shell);
  }
}

function escapeHtmlTitle(value: string): string {
  return value.replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );
}

/** 大纲条目:层级 + 标题文本 + 锚点 id */
interface TocEntry {
  level: number;
  text: string;
  id: string;
}

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

/**
 * 收集正文标题并写入锚点 id,返回左侧大纲的 HTML。
 * 标题锚点用 `sec-序号`(稳定且不与正文内容冲突);同名标题靠序号区分。
 */
function buildToc(body: HTMLElement): { html: string; count: number } {
  const headings = Array.from(body.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
  const entries: TocEntry[] = [];
  const used = new Set<string>();

  headings.forEach((heading, index) => {
    const text = (heading.textContent ?? "").trim();
    const level = Number(heading.tagName.slice(1)) || 1;
    let id = `sec-${index + 1}`;
    while (used.has(id)) id = `${id}-x`;
    used.add(id);
    heading.id = id;
    entries.push({ level, text: text || "无标题", id });
  });

  if (!entries.length) return { html: "", count: 0 };

  const doc = body.ownerDocument;
  const nav = doc.createElement("nav");
  nav.className = "yz-toc";
  nav.setAttribute("aria-label", "文档大纲");

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "yz-toc-title";
  toggle.setAttribute("aria-expanded", "true");
  toggle.textContent = "大纲";
  nav.append(toggle);

  const list = doc.createElement("ul");
  list.className = "yz-toc-list";
  for (const entry of entries) {
    const item = doc.createElement("li");
    const link = doc.createElement("a");
    link.className = "yz-toc-link";
    link.href = `#${entry.id}`;
    link.textContent = entry.text;
    link.dataset.tocTarget = entry.id;
    link.style.paddingLeft = `${10 + (entry.level - 1) * 12}px`;
    item.append(link);
    list.append(item);
  }
  nav.append(list);
  return { html: nav.outerHTML, count: entries.length };
}

/**
 * 导出页脚本(全部内联,零外部请求):
 * - 大纲折叠(窄屏默认收起,宽屏恒展开)
 * - 滚动高亮当前标题(与编辑器右栏 TOC 同口径:取最后一个已滚过顶部的标题)
 */
const TOC_SCRIPT = `
(function () {
  var nav = document.querySelector('.yz-toc');
  if (!nav) return;
  var toggle = nav.querySelector('.yz-toc-title');
  var links = Array.prototype.slice.call(nav.querySelectorAll('.yz-toc-link'));
  if (!links.length) return;

  if (toggle) {
    toggle.addEventListener('click', function () {
      var collapsed = document.body.classList.toggle('yz-toc-collapsed');
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    // 窄屏默认折叠,宽屏始终展开(桌面无 JS 也能看全大纲)
    if (window.matchMedia('(max-width: 900px)').matches) {
      document.body.classList.add('yz-toc-collapsed');
      toggle.setAttribute('aria-expanded', 'false');
    }
  }

  var targets = links.map(function (link) {
    return document.getElementById(link.getAttribute('data-toc-target'));
  });
  var ticking = false;
  function update() {
    ticking = false;
    var top = 96;
    var active = 0;
    for (var i = 0; i < targets.length; i++) {
      var el = targets[i];
      if (!el) continue;
      if (el.getBoundingClientRect().top <= top) active = i;
    }
    links.forEach(function (link, i) {
      if (i === active) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
})();
`;

/**
 * 文档标题横幅。
 * 正文里已经有同名 H1 就不重复加(避免「标题 + 标题」);否则在正文顶部补一个。
 * 标题不进大纲 —— 它是文档名,不是章节。
 */
function buildDocTitle(body: HTMLElement, title: string): string {
  const target = normalizeDocTitle(title);
  if (!target) return "";
  const hasSameH1 = Array.from(body.querySelectorAll<HTMLElement>("h1")).some(
    (h1) => plainInline(h1.textContent ?? "") === target,
  );
  if (hasSameH1) return "";
  const doc = body.ownerDocument;
  const heading = doc.createElement("h1");
  heading.className = "yz-doc-title";
  heading.textContent = target;
  body.prepend(heading);
  return target;
}

/**
 * PDF 大纲书签标记:给每个标题末尾追加一个隐形 span,
 * Rust 侧(export.rs apply_pdf_outline)按最终 PDF 分页提取该标记定位页码,
 * 再写入 PDF /Outlines。字符串格式勿改;HTML 导出不调用本函数。
 */
function injectPdfBookmarkMarkers(body: HTMLElement): void {
  const doc = body.ownerDocument;
  // 全局递增 seq:Rust 侧按 seq 去重,防止引擎文本层重复(如 macOS 分块边界复制)
  let seq = 0;
  for (const heading of Array.from(body.querySelectorAll<HTMLElement>(HEADING_SELECTOR))) {
    const level = Number(heading.tagName.slice(1)) || 1;
    // 书签名里的方括号/竖线与标记定界符冲突,替换成空格
    const title = (heading.textContent ?? "")
      .replace(/[\[\]|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;
    const marker = doc.createElement("span");
    marker.className = "yz-bm-marker";
    // 不能用 overflow:hidden 裁掉标记:Chrome/WebView 打印文本层会连同被裁文字一起
    // 丢弃,PDF 书签就提取不到。让标题作为定位容器,标记绝对定位且透明、2px,
    // 不裁剪、不换行,视觉零占位的同时保留完整可提取文本。
    // 注意:这里解析的是 DOMParser 生成的未挂载文档,Chromium 的
    // getComputedStyle(heading).position 返回空串而不是 "static"。不能靠
    // "static" 判断,否则标题不会成为定位容器,Windows 打印时所有绝对定位标记
    // 都会落到第一页左上角,书签全部指向第一页顶部。导出标题来自 markdown,
    // 统一设为 relative 不改变视觉布局,却能保证它是标记的定位容器。
    heading.style.position = "relative";
    marker.style.cssText =
      "position:absolute;left:0;top:0;color:transparent;font-size:2px;line-height:1;white-space:nowrap;pointer-events:none";
    marker.textContent = `[[YZ-PDF-BM:${level}:${seq}|${title}]]`;
    seq += 1;
    heading.append(marker);
  }
}

export async function buildExportHtml(opts: ExportHtmlOptions): Promise<string> {
  const doc = new DOMParser().parseFromString(mdToHtml(opts.md), "text/html");
  renderCallouts(doc.body);
  renderDetails(doc.body);
  renderAttachments(doc.body);
  const hasMath = renderMath(doc.body);
  await renderMermaidBlocks(doc.body);
  await renderRawHtml(doc.body, opts);
  await highlightCodeElements(doc.body);
  await embedLocalImages(doc.body, opts);
  // 大纲要在取 innerHTML 之前算:锚点 id 是写进标题元素上的。
  // 标题横幅在大纲之后加 —— 标题是文档名,不算章节,不该出现在大纲里。
  // 关闭导出大纲时同时跳过 PDF 书签:两者都是“导出后的阅读导航”。
  const includeOutline = opts.includeOutline !== false;
  const toc = includeOutline ? buildToc(doc.body) : { count: 0, html: "" };
  if (opts.includeDocTitle !== false) {
    buildDocTitle(doc.body, opts.title);
  }
  if (opts.pdfBookmarks && includeOutline) injectPdfBookmarkMarkers(doc.body);
  const codeTheme = codeThemeOf(opts.codeTheme ?? "yanzhi");
  const content = inlineStyles(doc.body.innerHTML, { codeBackground: codeTheme.background });
  const titleAlignCss = opts.titleAlign === "center" ? "\n.yz-doc-title { text-align: center; }" : "";
  const styles = `${PAGE_STYLE}${titleAlignCss}${codeTheme.css}${hasMath ? await embeddedKatexCss() : ""}`;
  const layout = toc.count
    ? `<div class="yz-layout">${toc.html}<article class="yz-content">${content}</article></div>`
    : `<div class="yz-layout yz-layout-solo"><article class="yz-content">${content}</article></div>`;
  return `<!doctype html>
<html lang="zh" data-code-theme="${opts.codeTheme ?? "yanzhi"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlTitle(opts.title)}</title>
<style>${styles}</style>
</head>
<body${toc.count ? ' class="yz-has-toc"' : ""}>
${layout}
${toc.count ? `<script>${TOC_SCRIPT}</script>` : ""}
</body>
</html>
`;
}
