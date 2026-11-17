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

export interface ExportHtmlOptions {
  md: string;
  title: string;
  docRel: string;
  /** 库内相对路径 → base64(取不到返回 null,该图保留原相对引用) */
  readAssetBase64: (rel: string) => Promise<{ data: string; mime: string } | null>;
}

const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

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
@media print {
  body {
    max-width: none;
    padding: 0;
    background: #fff;
  }
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
body {
  margin: 0 auto;
  padding: 48px 24px 96px;
  max-width: 848px;
  color: var(--page-fg);
  background: var(--page-bg);
  font-family: ${FONT_SANS};
  font-size: 16px;
  line-height: 1.6;
  letter-spacing: 0.004em;
  word-break: break-word;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.35; margin: 1.15em 0 0.45em; font-weight: 600; }
h1 { font-size: 1.9em; margin-top: 0.4em; letter-spacing: -0.018em; }
h2 { font-size: 1.5em; letter-spacing: -0.018em; }
h3 { font-size: 1.22em; letter-spacing: -0.018em; }
p { margin: 0.75em 0; }
img { max-width: 100%; height: auto; }
table { margin: 1em 0; }
pre {
  margin: 1em 0;
  padding: 0.9em 1.1em;
  background: #f0ede6;
  color: var(--page-fg);
  border-radius: 6px;
  font-family: ${FONT_MONO};
  font-size: 0.875em;
  line-height: 1.7;
  white-space: pre;
  overflow-x: auto;
}
pre code { font: inherit; }
.yz-tok-kw { color: hsl(348 76% 46%); }
.yz-tok-fn { color: hsl(258 55% 52%); }
.yz-tok-str { color: hsl(130 32% 32%); }
.yz-tok-emb { color: hsl(190 75% 30%); }
.yz-tok-cm { color: hsl(25 8% 42%); }
.yz-tok-num { color: hsl(212 82% 42%); }
.yz-tok-var { color: hsl(212 40% 42%); }
.yz-tok-op { color: hsl(350 22% 46%); }
.yz-tok-link { color: hsl(204 89% 40%); }
.yz-tok-ins { color: hsl(135 42% 34%); }
.yz-tok-del { color: hsl(0 68% 46%); }
.yz-tok-chg { color: hsl(204 78% 42%); }
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
  const body = inlineStyles(doc.body.innerHTML);
  const styles = `${PAGE_STYLE}${hasMath ? await embeddedKatexCss() : ""}`;
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlTitle(opts.title)}</title>
<style>${styles}</style>
</head>
<body>
${body}
</body>
</html>
`;
}
