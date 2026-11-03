import { Editor } from "@tiptap/core";
import { Fragment, type Mark, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { mdToHtml } from "../editor/markdown/md-instance";
import { markdownToDoc } from "../editor/markdown/parse";
import { extractLatex, stripCodeFence } from "./node-context";
import type { AiApplyMode } from "./actions";

function commonBlockAt(
  doc: PMNode,
  from: number,
  to: number,
): { node: PMNode; from: number; to: number } | null {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  let depth = Math.min($from.depth, $to.depth);
  while (depth > 0 && $from.node(depth) !== $to.node(depth)) depth--;
  if (depth === 0) return null; // 跨块选区仍走块级 Markdown 替换
  const node = $from.node(depth);
  if (!node?.isBlock || node.type.name === "codeBlock") return null;
  return { node, from, to };
}

/** 部分选区替换时保留宿主块(标题/引用/段落)与原行内 mark。 */
function inlineFragmentFromMarkdown(
  markdown: string,
  schema: Schema,
  inheritedMarks: readonly Mark[],
): Fragment {
  const parsed = markdownToDoc(markdown.trim(), schema);
  const inline: PMNode[] = [];
  const pushInline = (node: PMNode) => {
    if (node.isText) {
      const marks = node.marks.length ? [...inheritedMarks, ...node.marks] : inheritedMarks;
      inline.push(schema.text(node.text!, marks));
      return;
    }
    inline.push(node.marks.length ? node : node.mark(inheritedMarks));
  };
  const visit = (node: PMNode) => {
    node.forEach((child) => {
      if (child.isInline) pushInline(child);
      else visit(child);
    });
  };
  parsed.forEach((child, _offset, index) => {
    if (index > 0 && inline.length) inline.push(schema.text(" ", inheritedMarks));
    visit(child);
  });
  if (!inline.length) return Fragment.empty;
  return Fragment.fromArray(inline);
}

/** 将模型返回的 Markdown 插入/替换进编辑器(走现有 md→HTML→Schema 路径) */
export function applyAiMarkdown(
  editor: Editor,
  markdown: string,
  mode: "insert" | "replace",
  range?: { from: number; to: number },
  opts?: { blockApply?: boolean },
): void {
  const html = mdToHtml(markdown.trim());
  if (mode === "replace" && range && range.from !== range.to) {
    // 结构类(大纲拆段/表格等)强制块级回写;写作类同块局部替换仍走行内,避免拆宿主块
    if (!opts?.blockApply) {
      const block = commonBlockAt(editor.state.doc, range.from, range.to);
      // 选区仍在同一个文本块内:把模型结果降为 inline 内容,避免 `# 标题` 之类
      // 把当前标题拆成新块。标题/引用等宿主样式因此保持不变。
      if (block) {
        const inheritedMarks = editor.state.doc.resolve(range.from).marks();
        const fragment = inlineFragmentFromMarkdown(markdown, editor.schema, inheritedMarks);
        editor
          .chain()
          .focus()
          .insertContentAt({ from: range.from, to: range.to }, fragment)
          .run();
        return;
      }
    }
    editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, html).run();
    return;
  }
  if (mode === "replace" && !editor.state.selection.empty) {
    editor.chain().focus().deleteSelection().insertContent(html).run();
    return;
  }
  editor.chain().focus().insertContent(html).run();
}

/** AI-3:按 applyMode 写回(代码内容 / Mermaid 围栏 / 公式节点 / 普通 Markdown) */
export function applyAiResult(
  editor: Editor,
  raw: string,
  mode: "insert" | "replace",
  range: { from: number; to: number } | null | undefined,
  opts: {
    applyMode?: AiApplyMode;
    blockApply?: boolean;
    mathOption?: string;
    contentRange?: { from: number; to: number } | null;
  },
): void {
  const applyMode = opts.applyMode ?? "markdown";
  if (applyMode === "codeContent") {
    const code = stripCodeFence(raw);
    const cr = opts.contentRange;
    if (!cr || cr.from >= cr.to) {
      // 无内容区间时退化为整段 Markdown 代码块替换
      applyAiMarkdown(editor, "```\n" + code + "\n```", mode, range ?? undefined, {
        blockApply: true,
      });
      return;
    }
    const textNode = code.length ? editor.schema.text(code) : null;
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) {
          if (textNode) tr.replaceWith(cr.from, cr.to, textNode);
          else tr.delete(cr.from, cr.to);
        }
        return true;
      })
      .run();
    return;
  }
  if (applyMode === "mermaidFence") {
    const src = stripCodeFence(raw);
    const md = "```mermaid\n" + src + "\n```";
    applyAiMarkdown(editor, md, mode, range ?? undefined, { blockApply: true });
    return;
  }
  if (applyMode === "math") {
    const latex = extractLatex(raw);
    if (!latex) return;
    const block = (opts.mathOption ?? "行内") === "块级";
    const node = {
      type: block ? "mathBlock" : "mathInline",
      attrs: { latex },
    };
    if (mode === "replace" && range && range.from !== range.to) {
      editor.chain().focus().insertContentAt({ from: range.from, to: range.to }, node).run();
      return;
    }
    editor.chain().focus().insertContent(node).run();
    return;
  }
  applyAiMarkdown(editor, raw, mode, range ?? undefined, {
    blockApply: opts.blockApply,
  });
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
