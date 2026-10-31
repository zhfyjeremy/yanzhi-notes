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

/* 块级未知 HTML → data-raw-html 占位(原文保留,见 extensions/raw-html.ts) */
md.renderer.rules.html_block = (tokens, idx) => {
  const encoded = encodeURIComponent(tokens[idx].content);
  return `<div data-raw-html="${encoded}"></div>`;
};

export function mdToHtml(markdown: string): string {
  return md.render(markdown);
}
