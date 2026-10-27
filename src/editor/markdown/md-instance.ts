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

/* 块级未知 HTML → data-raw-html 占位(原文保留,见 extensions/raw-html.ts) */
md.renderer.rules.html_block = (tokens, idx) => {
  const encoded = encodeURIComponent(tokens[idx].content);
  return `<div data-raw-html="${encoded}"></div>`;
};

export function mdToHtml(markdown: string): string {
  return md.render(markdown);
}
