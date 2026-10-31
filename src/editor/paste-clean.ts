/**
 * 粘贴清洗(PRD §5.7):微信/网页/Word HTML → 干净 HTML,再交给 schema DOMParser。
 * 只动 HTML 层,不碰解析/序列化管线;策略 = 保结构(标题/列表/链接/图片/简单表格/代码块),
 * 丢样式(字体字号背景边距)、丢脚本与私有 XML、追踪参数、合并单元格表格降级纯文本;
 * 文字颜色吸附到最近预设色保留(font-color.ts,§10 方言)。
 */

import { colorFromStyle, nearestFontColor } from "./extensions/font-color";

/** schema 可理解 + 结构有意义的标签;白名单外块级标签 unwrap 保内容,私有命名空间直接删 */
const KEEP_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code", "br", "hr",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "strong", "b", "em", "i", "u", "s", "strike", "del",
  "a", "img", "mark", "font",
]);

/** 逐标签属性白名单;style/class/事件属性一律不进白名单(等于丢弃) */
const KEEP_ATTRS: Record<string, readonly string[]> = {
  a: ["href"],
  img: ["src", "alt"],
  font: ["color"],
  // codeBlock 的 language 解析自 code 的 language-* class(@tiptap/extension-code-block)
  code: ["class"],
  li: ["data-type", "data-checked"],
  ul: ["data-type"],
  // 折叠块(normalizeDetails 产出的形态,见下)
  div: ["data-details", "data-summary", "data-open"],
};

/** 危险/噪音标签,连同内容删除(任务列表的 checkbox 在改造后也已移除) */
const DROP_TAGS =
  "script,style,noscript,iframe,frame,object,embed,meta,link,base,title,head," +
  "svg,canvas,form,button,select,textarea,input,video,audio,picture,source,track";

/** 常见追踪参数;utm_ 前缀另配 */
const TRACKING_PARAMS = [
  "spm", "spmid", "from", "isappinstalled", "scene", "subscene",
  "chksm", "srcid", "sn", "exportid", "nwr_flag",
  "sharer_shareid", "sharer_shareinfo", "tt_from",
];

/** 外部颜色形态统一:span[style*=color] / font[color] → font[color=最近预设色](§5.7) */
function normalizeColors(root: HTMLElement, doc: Document): void {
  for (const span of [...root.querySelectorAll('span[style*="color:" i]')]) {
    const color = colorFromStyle(span.getAttribute("style") ?? "");
    const nearest = color ? nearestFontColor(color) : null;
    if (!nearest) continue;
    const font = doc.createElement("font");
    font.setAttribute("color", nearest);
    span.replaceWith(font);
    font.append(...span.childNodes);
  }
  for (const font of [...root.querySelectorAll("font[color]")]) {
    const nearest = nearestFontColor(font.getAttribute("color") ?? "");
    nearest
      ? font.setAttribute("color", nearest)
      : font.removeAttribute("color");
  }
}
/** a[href] 清洗:危险协议摘除,http(s) 剥追踪参数 */
function cleanHref(href: string): string | null {
  const value = href.trim();
  if (/^(javascript|vbscript|data):/i.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) return value; // 锚点/mailto/相对路径原样
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || TRACKING_PARAMS.includes(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

/** 外部任务列表(li>input[type=checkbox])→ tiptap 结构(li[data-type]/ul[data-type]);混合列表不转,避免语义篡改 */
function normalizeTaskLists(root: HTMLElement): void {
  const lists = new Set<HTMLElement>();
  for (const li of root.querySelectorAll("li")) {
    const ul = li.parentElement;
    if (ul?.tagName !== "UL") continue;
    const items = [...ul.children].filter((el) => el.tagName === "LI");
    if (items.every((el) => el.querySelector('input[type="checkbox"]'))) {
      lists.add(ul);
    }
  }
  for (const ul of lists) {
    ul.setAttribute("data-type", "taskList");
    for (const el of ul.children) {
      if (el.tagName !== "LI") continue;
      const li = el as HTMLElement;
      const box = li.querySelector('input[type="checkbox"]');
      li.setAttribute("data-type", "taskItem");
      li.setAttribute(
        "data-checked",
        String(box?.hasAttribute("checked") || (box as HTMLInputElement | null)?.checked === true),
      );
      box?.remove();
    }
  }
}

/** 带 colspan/rowspan 的表格(GFM 无法表达)降级为纯文本:行 = 段落,单元格 \t 分隔 */
function downgradeMergedTables(root: HTMLElement): void {
  for (const table of [...root.querySelectorAll("table")]) {
    const merged = [...table.querySelectorAll("td,th")].some((cell) => {
      const el = cell as HTMLElement;
      return Number(el.getAttribute("colspan")) > 1 || Number(el.getAttribute("rowspan")) > 1;
    });
    if (!merged) continue;
    const frag = document.createDocumentFragment();
    for (const tr of table.querySelectorAll("tr")) {
      const line = [...tr.querySelectorAll("td,th")]
        .map((cell) => cell.textContent?.trim() ?? "")
        .join("\t");
      if (line.trim()) {
        const p = document.createElement("p");
        p.textContent = line;
        frag.appendChild(p);
      }
    }
    table.replaceWith(frag);
  }
}

/** 原生 <details><summary> → div[data-details]:粘贴(GitHub 等)的折叠块直接转可编辑节点 */
function normalizeDetails(root: HTMLElement): void {
  for (const el of [...root.querySelectorAll("details")]) {
    const summary = el.querySelector("summary");
    const div = el.ownerDocument.createElement("div");
    div.setAttribute("data-details", "1");
    if (summary) div.setAttribute("data-summary", summary.textContent ?? "");
    if (el.hasAttribute("open")) div.setAttribute("data-open", "1");
    summary?.remove();
    while (el.firstChild) div.append(el.firstChild);
    el.replaceWith(div);
  }
}

export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.body;

  // 0) 原生 details 归一化(在标签白名单 unwrap 之前,折叠结构才不会被拆掉)
  normalizeDetails(root);

  // 1) 任务列表改造(需在删 input 之前)
  normalizeTaskLists(root);

  // 2) 危险/噪音标签
  root.querySelectorAll(DROP_TAGS).forEach((el) => el.remove());

  // 3) 合并单元格表格降级(在属性白名单洗掉 colspan 之前检测)
  downgradeMergedTables(root);

  // 4) 文字颜色吸附(需在属性白名单洗掉 style 之前)
  normalizeColors(root, doc);

  // 5) 属性白名单;code 的 class 只留 language-*
  for (const el of root.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    const keep = KEEP_ATTRS[tag] ?? [];
    for (const attr of [...el.attributes]) {
      if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
    }
    if (tag === "code" && el.hasAttribute("class")) {
      const lang = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .find((cls) => cls.startsWith("language-"));
      lang ? el.setAttribute("class", lang) : el.removeAttribute("class");
    }
  }

  // 6) 链接清洗 + 图片源校验(http(s) 之外不保留:PRD 禁 base64,剪贴板图片文件落盘在 M3)
  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (href == null) continue;
    const cleaned = cleanHref(href);
    cleaned == null ? a.removeAttribute("href") : a.setAttribute("href", cleaned);
  }
  for (const img of [...root.querySelectorAll("img")]) {
    if (!/^https?:\/\//i.test(img.getAttribute("src") ?? "")) img.remove();
  }

  // 7) 白名单外标签:私有命名空间(Word/WPS XML)整删,其余 unwrap 保内容
  //    (normalizeDetails 产出的 div[data-details] 是 schema 可解析形态,豁免)
  for (const el of [...root.querySelectorAll("*")].reverse()) {
    const tag = el.tagName.toLowerCase();
    if (KEEP_TAGS.has(tag)) continue;
    if (tag === "div" && el.hasAttribute("data-details")) continue;
    if (/^[a-z][a-z0-9]*:/.test(tag) || tag === "xml") el.remove();
    else el.replaceWith(...el.childNodes);
  }

  // 8) &nbsp; 归一为普通空格(md 源无需不可断空格)
  return root.innerHTML.split("\u00A0").join(" ").split("&nbsp;").join(" ");
}
