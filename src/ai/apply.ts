import type { Editor } from "@tiptap/core";
import { mdToHtml } from "../editor/markdown/md-instance";

/** 将模型返回的 Markdown 插入/替换进编辑器(走现有 md→HTML→Schema 路径) */
export function applyAiMarkdown(
  editor: Editor,
  markdown: string,
  mode: "insert" | "replace",
  range?: { from: number; to: number },
): void {
  const html = mdToHtml(markdown.trim());
  if (mode === "replace" && range && range.from !== range.to) {
    editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, html).run();
    return;
  }
  if (mode === "replace" && !editor.state.selection.empty) {
    editor.chain().focus().deleteSelection().insertContent(html).run();
    return;
  }
  editor.chain().focus().insertContent(html).run();
}

export async function copyAiText(text: string): Promise<void> {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return;
    }
  } catch {
    /* fall through */
  }
  await navigator.clipboard.writeText(text);
}

/** 选区文本;空选区返回 "" */
export function selectionText(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  if (empty) return "";
  return editor.state.doc.textBetween(from, to, "\n");
}

/** 续写用:光标前上文(最多约 4000 字) */
export function prefixContext(editor: Editor, maxChars = 4000): string {
  const head = editor.state.selection.head;
  const text = editor.state.doc.textBetween(0, head, "\n");
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

/** 当前段文本(光标所在顶层块) */
export function currentBlockText(editor: Editor): string {
  const $from = editor.state.selection.$from;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isBlock) depth -= 1;
  const node = $from.node(depth);
  return node.textContent;
}
