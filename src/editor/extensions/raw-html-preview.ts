/**
 * 块级 Raw HTML 预览的安全子集。
 * 原文仍完整保存在 rawHtml node attrs;这里只生成 iframe srcdoc,
 * 禁脚本/表单/嵌入对象,并允许 http(s) 远程图片加载。
 */
import { resolveRenderSrc } from "@/kb/asset-src";

const REMOVE_TAGS = new Set([
  "script", "noscript", "iframe", "frame", "frameset", "object", "embed",
  "applet", "form", "input", "button", "select", "textarea", "option",
  "optgroup", "label", "fieldset", "legend", "dialog", "menu", "meta",
  "link", "base", "title", "portal", "audio", "video", "source", "track",
  "canvas", "math", "template", "slot",
]);

const GLOBAL_ATTRS = new Set([
  "abbr", "align", "alt", "axis", "char", "charoff", "class", "cite",
  "colspan", "datetime", "dir", "headers", "height", "hidden", "id",
  "lang", "reversed", "rowspan", "span", "start", "style", "title",
  "valign", "width",
]);

const URL_ATTRS = new Set(["src", "href", "poster", "background", "srcset"]);

function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (/^(?:https?:)?\/\//i.test(url)) return url;
  if (/^data:image\//i.test(url)) return url;
  if (/^(?:mailto:|tel:|#)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  return url;
}

function safeSrcset(raw: string): string {
  return raw
    .split(",")
    .map((part) => {
      const [url, ...descriptors] = part.trim().split(/\s+/);
      const resolved = safeUrl(url ?? "");
      return resolved ? [resolveRenderSrc(resolved), ...descriptors].join(" ") : "";
    })
    .filter(Boolean)
    .join(", ");
}

function safeCss(css: string): string {
  return css
    .replace(/@import\b[^;]+;?/gi, "")
    .replace(/(?:^|[;{])(?:behavior|-moz-binding)\s*:[^;}]+;?/gi, "")
    .replace(/expression\s*\(/gi, "none(")
    .replace(/javascript\s*:/gi, "data:text/plain,");
}

function sanitizeElement(element: Element) {
  const tag = element.tagName.toLowerCase();
  if (REMOVE_TAGS.has(tag)) {
    element.remove();
    return;
  }

  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name.startsWith("on") || name === "srcdoc" || name === "sandbox" || name === "http-equiv") {
      element.removeAttribute(attr.name);
      continue;
    }
    if (URL_ATTRS.has(name)) {
      if (name === "srcset") element.setAttribute(attr.name, safeSrcset(value));
      else {
        const safe = safeUrl(value);
        if (safe === null) element.removeAttribute(attr.name);
        else if (tag === "img" && name === "src") element.setAttribute(attr.name, resolveRenderSrc(safe));
        else element.setAttribute(attr.name, safe);
      }
      continue;
    }
    const allowed =
      GLOBAL_ATTRS.has(name) ||
      (tag === "a" && (name === "target" || name === "rel")) ||
      (tag === "img" && (name === "loading" || name === "decoding" || name === "sizes")) ||
      name.startsWith("data-");
    if (!allowed) element.removeAttribute(attr.name);
    else if (name === "style") element.setAttribute(attr.name, safeCss(value));
  }

  if (tag === "img") {
    // 部分图床（如掘金 byteimg）按 Referer ACL 拒绝 http://localhost 来源；
    // 预览远程图片与 Typora 行为对齐，同时避免泄露本机文档来源。
    element.setAttribute("referrerpolicy", "no-referrer");
    element.setAttribute("loading", "eager");
  }

  for (const child of Array.from(element.children)) sanitizeElement(child);
}

/** 生成隔离 iframe 使用的 HTML。原文不改写,只影响预览。 */
export function sanitizeRawHtmlPreview(source: string, themeCss = ""): string {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const styles = Array.from(parsed.querySelectorAll("style"));
  for (const style of styles) {
    style.textContent = safeCss(style.textContent ?? "");
    style.remove();
  }
  for (const child of Array.from(parsed.body.children)) sanitizeElement(child);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html { color-scheme: light; }
  ${themeCss}
  body { margin: 0; color: var(--foreground); background: var(--editor); font-family: var(--font-sans); font-size: 15px; line-height: 1.6; overflow: hidden; width: max-content; min-width: 100%; }
  img, video, svg { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid var(--border-subtle); padding: 4px 7px; }
</style>
${styles.map((style) => style.outerHTML).join("")}
</head>
<body>${parsed.body.innerHTML}</body>
</html>`;
}
