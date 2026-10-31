import MarkdownIt from "markdown-it";

/**
 * 砚知 markdown-it 实例:GFM + 方言规则(PRD §10)。
 * 方言 ==高亮==、[[双链]] 以内联规则注入;任务列表以 core 规则改造 token,
 * 输出与 Tiptap TaskList/TaskItem 的 parseHTML(data-type)对齐。
 */
export const md = new MarkdownIt({
  html: true, // <u>、<details> 等方言 HTML 片段须可解析
  breaks: false,
  linkify: false,
});

/* 默认 normalizeLink 会把非 ASCII 链接目标百分号编码(中文文档路径重灾),
 * 往返落盘即被改写——关闭编码,href 保持用户原文(§4.4 用户感知无损) */
md.normalizeLink = (url: string) => url;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/* $…$ → <span data-math-inline data-latex>(PRD §10:$ 紧贴非空白内容才触发,
 * `$$` 让给块级规则)。latex 经 encodeURIComponent 进属性,避免二次转义 */
md.inline.ruler.before("escape", "yz_math_inline", (state, silent) => {
  const src = state.src;
  if (src[state.pos] !== "$" || src[state.pos + 1] === "$") return false;
  const close = src.indexOf("$", state.pos + 2);
  if (close === -1) return false;
  const latex = src.slice(state.pos + 1, close);
  // 开 $ 后/闭 $ 前须紧贴非空白(PRD §10);不跨行
  if (
    !latex.trim() ||
    /\s/.test(latex[0]) ||
    /\s/.test(latex[latex.length - 1]) ||
    latex.includes("\n")
  ) {
    return false;
  }
  if (!silent) {
    const tok = state.push("html_inline", "", 0);
    tok.content = `<span data-math-inline data-latex="${encodeURIComponent(latex)}"></span>`;
  }
  state.pos = close + 1;
  return true;
});

/* ==高亮== → <mark>…</mark>
 * 注:高亮内容按纯文本处理(内部不再解析强调),fixtures 锁定该行为 */
md.inline.ruler.before("emphasis", "yz_highlight", (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== "==") return false;
  const end = state.src.indexOf("==", state.pos + 2);
  if (end === -1) return false;
  const content = state.src.slice(state.pos + 2, end);
  if (!content.trim()) return false;
  if (!silent) {
    const open = state.push("html_inline", "", 0);
    open.content = "<mark>";
    const text = state.push("text", "", 0);
    text.content = content;
    const close = state.push("html_inline", "", 0);
    close.content = "</mark>";
  }
  state.pos = end + 2;
  return true;
});

/* [[目标|显示名]] → <a data-type="wiki-link" data-target="…">显示名</a> */
md.inline.ruler.before("link", "yz_wikilink", (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== "[[") return false;
  const end = state.src.indexOf("]]", state.pos + 2);
  if (end === -1) return false;
  const inner = state.src.slice(state.pos + 2, end);
  const match = inner.match(/^([^|\]]+)\|?(.*)$/);
  if (!match) return false;
  const target = match[1].trim();
  const label = match[2] || target;
  if (!target) return false;
  if (!silent) {
    const open = state.push("html_inline", "", 0);
    open.content = `<a data-type="wiki-link" data-target="${escapeAttr(target)}">`;
    const text = state.push("text", "", 0);
    text.content = label;
    const close = state.push("html_inline", "", 0);
    close.content = "</a>";
  }
  state.pos = end + 2;
  return true;
});

/* - [ ] / - [x] → taskList/taskItem token(对齐 Tiptap parseHTML) */md.core.ruler.after("inline", "yz_tasklist", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "paragraph_open") continue;
    const inline = tokens[i + 1];
    if (!inline || inline.type !== "inline" || !inline.children?.length) {
      continue;
    }
    const first = inline.children[0];
    const match = first.content.match(/^\[([ xX])\]\s+/);
    if (!match) continue;
    // 向上找所属 list_item_open
    let li = -1;
    for (let j = i; j >= 0; j--) {
      if (tokens[j].type === "list_item_open") {
        li = j;
        break;
      }
      if (tokens[j].type === "list_item_close") break; // 属于更外层已完成项
    }
    if (li === -1) continue;
    first.content = first.content.slice(match[0].length);
    tokens[li].attrSet("data-type", "taskItem");
    tokens[li].attrSet("data-checked", match[1] === " " ? "false" : "true");
    // 向上找最近的 list_open 标记为 taskList
    for (let j = li; j >= 0; j--) {
      if (tokens[j].type === "bullet_list_open") {
        tokens[j].attrSet("data-type", "taskList");
        break;
      }
    }
  }
});

/* > [!INFO] 标题 → div[data-callout] 提示块(PRD §10;仅 4 种类型,未知保持普通引用)。
 * 标题 = 标记后同行的纯文本;标记行与正文间的 softbreak 一并摘除,
 * 只剩标记的首段整段丢弃(标题即整行的情形) */
md.core.ruler.after("inline", "yz_callout", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "blockquote_open") continue;
    const open = tokens[i + 1];
    const inline = tokens[i + 2];
    if (
      !open ||
      open.type !== "paragraph_open" ||
      !inline ||
      inline.type !== "inline" ||
      !inline.children?.length
    ) {
      continue;
    }
    const match = inline.children[0].content.match(
      /^\[!(INFO|SUCCESS|WARNING|CAUTION)\][ \t]*(.*)$/,
    );
    if (!match) continue;
    inline.children.splice(
      0,
      inline.children[1]?.type === "softbreak" ? 2 : 1,
    );
    const openTok = tokens[i];
    openTok.type = "callout_open";
    openTok.tag = "div";
    openTok.markup = "";
    openTok.attrSet("data-callout", match[1].toLowerCase());
    const title = match[2].trim();
    if (title) openTok.attrSet("data-title", escapeAttr(title));
    if (!inline.children.length) tokens.splice(i + 1, 3);
    // 配对的 blockquote_close(计嵌套)一并改 div
    let depth = 0;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === "blockquote_open") depth++;
      else if (tokens[j].type === "blockquote_close") {
        if (depth > 0) {
          depth--;
          continue;
        }
        tokens[j].type = "callout_close";
        tokens[j].tag = "div";
        tokens[j].markup = "";
        break;
      }
    }
  }
});

/* 独立段落整体为 $$…$$ → div[data-math-block](PRD §10)。
 * latex 从 inline token 的原始 content 提取(不走 children,反斜杠命令
 * 如 \frac 会被 CommonMark 转义规则吃掉);单行 $$E$$ 形式也接受,
 * 序列化统一规范化为 $$/latex/$$ 三行(fixtures 锁定) */
md.core.ruler.after("inline", "yz_math_block", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "paragraph_open") continue;
    const inline = tokens[i + 1];
    if (!inline || inline.type !== "inline") continue;
    const match = inline.content.match(/^\$\$([\s\S]*?)\$\$$/);
    if (!match) continue;
    const latex = match[1].trim();
    inline.children = [];
    const openTok = tokens[i];
    openTok.type = "math_block_open";
    openTok.tag = "div";
    openTok.markup = "";
    openTok.attrSet("data-math-block", "1");
    openTok.attrSet("data-latex", encodeURIComponent(latex));
    const closeTok = tokens[i + 2];
    closeTok.type = "math_block_close";
    closeTok.tag = "div";
    closeTok.markup = "";
  }
});

/* <details><summary>标题</summary> … </details> → div[data-details] 折叠摘要块(PRD §6.1.2/§10)。
 * md-it 把块级开标签吃到空行为止:开+摘要在同一 html_block token,闭标签独立一块;
 * 紧凑形态(无空行)整块一个 token。仅认空属性或 open;其它属性/未闭合/引用内
 * 一律不转换,保持 rawHtml 原文(§4.6 禁止静默丢弃)。summary 为纯文本(实体解码后存 attr)。 */
const DETAILS_COMPACT = /^<details((?:\s[^>]*)?)>\n<summary>([\s\S]*?)<\/summary>\n<\/details>\n?$/;
const DETAILS_OPEN = /^<details((?:\s[^>]*)?)>\n<summary>([\s\S]*?)<\/summary>\n?$/;

/** open 属性:仅认空/open="open",其它属性返回 null(不转换,原文保留) */
function detailsOpenAttr(raw: string | undefined): boolean | null {
  if (!raw) return false;
  const v = raw.trim();
  if (v === "open" || v === 'open="open"' || v === "open='open'") return true;
  return null;
}

function decodeSummaryEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) =>
    ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[e] as string),
  );
}

md.core.ruler.after("yz_math_block", "yz_details", (state) => {
  const tokens = state.tokens;
  const markDetails = (tok: (typeof tokens)[number], open: boolean, summary: string) => {
    tok.type = "details_open";
    tok.tag = "div";
    tok.markup = "";
    tok.attrSet("data-details", "1");
    // md-it 渲染器对属性值自行 HTML 转义,这里存解码后的明文即可
    tok.attrSet("data-summary", decodeSummaryEntities(summary));
    if (open) tok.attrSet("data-open", "1");
  };
  const closeToken = () =>
    Object.assign(new state.Token("details_close", "div", -1), { markup: "" });
  // 空内容补一个空段落:content "block+" 至少一块,保证解析端拿到确定结构
  const emptyParagraph = () => [
    new state.Token("paragraph_open", "p", 1),
    Object.assign(new state.Token("inline", "", 0), { content: "", children: [] }),
    new state.Token("paragraph_close", "p", -1),
  ];
  let quoteDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "blockquote_open") quoteDepth++;
    else if (t.type === "blockquote_close") quoteDepth--;
    else if (t.type === "html_block" && quoteDepth === 0) {
      const compact = t.content.match(DETAILS_COMPACT);
      if (compact) {
        const open = detailsOpenAttr(compact[1]);
        if (open === null) continue;
        markDetails(t, open, compact[2]);
        tokens.splice(i + 1, 0, ...emptyParagraph(), closeToken());
        continue;
      }
      const openM = t.content.match(DETAILS_OPEN);
      if (!openM) continue;
      const open = detailsOpenAttr(openM[1]);
      if (open === null) continue;
      // 找配对闭标签(中间嵌套的 <details> 计数);未闭合保持原文
      let nest = 0;
      let closeIdx = -1;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type !== "html_block") continue;
        if (/^<\/details/.test(tokens[j].content)) {
          if (nest === 0) {
            closeIdx = j;
            break;
          }
          nest--;
        } else if (/^<details[\s>]/.test(tokens[j].content)) {
          nest++;
        }
      }
      if (closeIdx === -1) continue;
      markDetails(t, open, openM[2]);
      tokens[closeIdx].type = "details_close";
      tokens[closeIdx].tag = "div";
      tokens[closeIdx].markup = "";
      tokens[closeIdx].nesting = -1; // html_block 原 nesting=0,须改成闭标签渲染
      if (closeIdx === i + 1) tokens.splice(i + 1, 0, ...emptyParagraph());
      i = closeIdx;
    }
  }
});

/* 独立段落整段恰为一个 assets 链接 → div[data-attachment] 附件卡片(PRD 6.1.5)。
 * §10 无附件专用方言:存储就是标准链接 `[名称](./assets/xx.ext)`,卡片是砚知的
 * 渲染增强;行内混排/非 assets 相对路径/外链/带 title/空名称一律保持普通链接。
 * name/href 存 md 源文本形态(text token 未解码、destination 原样),序列化
 * 原样写回,逐字往返。 */
const ATTACHMENT_HREF = /^(\.{1,2}\/)?assets\/[^/]+$/;

md.core.ruler.after("yz_details", "yz_attachment", (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "paragraph_open") continue;
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (inline?.type !== "inline" || close?.type !== "paragraph_close") continue;
    const kids = inline.children ?? [];
    if (kids.length !== 3) continue;
    const [lo, text, lc] = kids;
    if (lo.type !== "link_open" || text.type !== "text" || lc.type !== "link_close") {
      continue;
    }
    if (!text.content.trim()) continue;
    // 带 title 的链接不转(避免静默丢 title;§4.6)
    const attrs = lo.attrs ?? [];
    if (attrs.length !== 1 || attrs[0][0] !== "href") continue;
    const href = String(attrs[0][1] ?? "");
    if (!ATTACHMENT_HREF.test(href)) continue;
    const openTok = tokens[i];
    openTok.type = "attachment_open";
    openTok.tag = "div";
    openTok.markup = "";
    openTok.attrSet("data-attachment", "1");
    openTok.attrSet("data-href", href);
    openTok.attrSet("data-name", text.content);
    // paragraph_close 自身已是 nesting=-1,直接改形态
    close.type = "attachment_close";
    close.tag = "div";
    close.markup = "";
  }
});

/* 块级未知 HTML → data-raw-html 占位(原文保留,见 extensions/raw-html.ts) */
md.renderer.rules.html_block = (tokens, idx) => {
  const encoded = encodeURIComponent(tokens[idx].content);
  return `<div data-raw-html="${encoded}"></div>`;
};

export function mdToHtml(markdown: string): string {
  return md.render(markdown);
}
