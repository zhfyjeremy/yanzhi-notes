/**
 * AI-3 卡片上下文:定位光标/选区所在的 codeBlock(含 mermaid)。
 */

import type { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

export type AiCodeBlockContext = {
  kind: "codeBlock" | "mermaid";
  language: string;
  text: string;
  /** 整个节点外沿,供 NodeSelection / 整块替换 */
  range: { from: number; to: number };
  /** 节点内容区间(不含开闭标签),供改写源码 */
  contentRange: { from: number; to: number };
};

function fromPos(_doc: PMNode, pos: number, node: PMNode): AiCodeBlockContext {
  const language = (node.attrs.language as string) || "plaintext";
  const kind = language === "mermaid" ? "mermaid" : "codeBlock";
  return {
    kind,
    language,
    text: node.textContent,
    range: { from: pos, to: pos + node.nodeSize },
    contentRange: { from: pos + 1, to: pos + node.nodeSize - 1 },
  };
}

/** 按文档绝对位置取代码块(卡片 AI 显式传入,避免下拉抢焦点后选区漂移) */
export function codeBlockContextAt(
  doc: PMNode,
  pos: number,
): AiCodeBlockContext | null {
  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== "codeBlock") return null;
  return fromPos(doc, pos, node);
}

/** 解析当前选区所在代码块;不在代码块内返回 null */
export function resolveCodeBlockContext(
  editor: Editor,
  /** 优先使用的节点起点(来自代码块卡片) */
  nodePos?: number,
): AiCodeBlockContext | null {
  if (editor.isDestroyed) return null;
  const { selection, doc } = editor.state;
  if (typeof nodePos === "number") {
    const pinned = codeBlockContextAt(doc, nodePos);
    if (pinned) return pinned;
  }
  if (selection instanceof NodeSelection && selection.node.type.name === "codeBlock") {
    return fromPos(doc, selection.from, selection.node);
  }
  const $from = selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "codeBlock") {
      return fromPos(doc, $from.before(d), node);
    }
  }
  return null;
}

/** 去掉模型爱加的 ```lang 围栏,只留正文 */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).replace(/\n$/, "");
}

/** 从模型输出抽出 LaTeX(去掉 $ / $$ / 围栏) */
export function extractLatex(text: string): string {
  const t = text.trim();
  const block = t.match(/^\$\$([\s\S]+?)\$\$/);
  if (block) return block[1].trim();
  const inline = t.match(/^\$([^$]+)\$/);
  if (inline) return inline[1].trim();
  const fence = t.match(/^```(?:latex|tex)?\n?([\s\S]*?)\n?```$/i);
  if (fence) return fence[1].trim();
  return t.replace(/^`+|`+$/g, "").trim();
}
