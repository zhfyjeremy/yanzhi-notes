/**
 * 复制到剪贴板(双环境):
 * - tauri:走 clipboard-manager 插件原生写(NSPasteboard/Win32)——
 *   WKWebView 的 navigator.clipboard.write 对 text/html 支持不稳,
 *   失败降级成纯文本会把表格等结构拍平,富文本必须走原生
 * - browser(mock 开发):navigator.clipboard,降级 writeText
 *
 * 富文本复制前注入内联样式(inlineStyles):复制产物离开 app 后没有
 * design tokens 与 .yz-editor-doc 样式,微信/邮件等目标只认 inline style,
 * 无边框表格/无底色代码块观感即"被拍平"。此处色值是复制专用常量
 * (浅色系安全值):目标环境没有 token 体系,dark 值贴到浅色背景不可读。
 */

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* 近似 index.css light tokens 的固定输出色(仅用于复制产物) */
const COPY_COLORS = {
  fg: "#231f1c",
  border: "#d9d2c5",
  codeBg: "#f0ede6",
  thBg: "#f7f4ee",
  mutedFg: "#7a7267",
  blue: "#0b71c6",
  mark: "#ffe58a",
} as const;

/** 给 getHTML 输出注入内联样式(规则对应 editor.css 的正文排版) */
export function inlineStyles(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  const each = (sel: string, fn: (el: HTMLElement) => void) => {
    body.querySelectorAll<HTMLElement>(sel).forEach(fn);
  };

  each("table", (el) => {
    el.style.borderCollapse = "collapse";
  });
  each("th", (el) => {
    el.style.border = `1px solid ${COPY_COLORS.border}`;
    el.style.padding = "0.4em 0.75em";
    el.style.background = COPY_COLORS.thBg;
    el.style.fontWeight = "600";
  });
  each("td", (el) => {
    el.style.border = `1px solid ${COPY_COLORS.border}`;
    el.style.padding = "0.4em 0.75em";
  });
  each("h1", (el) => {
    el.style.fontSize = "1.75em";
    el.style.fontWeight = "600";
  });
  each("h2", (el) => {
    el.style.fontSize = "1.4em";
    el.style.fontWeight = "600";
  });
  each("h3", (el) => {
    el.style.fontSize = "1.2em";
    el.style.fontWeight = "600";
  });
  each("pre", (el) => {
    el.style.background = COPY_COLORS.codeBg;
    el.style.borderRadius = "6px";
    el.style.padding = "0.9em 1.1em";
    el.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    el.style.fontSize = "0.875em";
    el.style.lineHeight = "1.7";
    el.style.whiteSpace = "pre";
    el.style.overflowX = "auto";
  });
  each(":not(pre) > code", (el) => {
    el.style.background = COPY_COLORS.codeBg;
    el.style.borderRadius = "4px";
    el.style.padding = "0.15em 0.4em";
    el.style.fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    el.style.fontSize = "0.875em";
  });
  each("blockquote", (el) => {
    el.style.borderLeft = `3px solid ${COPY_COLORS.blue}`;
    el.style.paddingLeft = "1em";
    el.style.color = COPY_COLORS.mutedFg;
    el.style.margin = "0";
  });
  each("hr", (el) => {
    el.style.border = "none";
    el.style.borderTop = `1px solid ${COPY_COLORS.border}`;
  });
  each("a", (el) => {
    el.style.color = COPY_COLORS.blue;
    el.style.textDecoration = "none";
  });
  each("mark", (el) => {
    el.style.background = COPY_COLORS.mark;
    el.style.padding = "0 0.15em";
  });
  each("img", (el) => {
    el.style.maxWidth = "100%";
  });
  each("ul, ol", (el) => {
    el.style.paddingLeft = "1.5em";
  });

  const wrap = doc.createElement("div");
  wrap.style.color = COPY_COLORS.fg;
  wrap.style.fontSize = "16px";
  wrap.style.lineHeight = "1.75";
  wrap.append(...Array.from(body.childNodes));
  return wrap.outerHTML;
}

export async function copyPlainText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

/** 富文本复制:内联样式后的 html + 纯文本回退(不支持富文本的目标用 altText) */
export async function copyRichText(html: string, plain: string): Promise<void> {
  const styled = inlineStyles(html);
  if (isTauri()) {
    const { writeHtml } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeHtml(styled, plain);
    return;
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([styled], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(plain); // 降级纯文本
  }
}
