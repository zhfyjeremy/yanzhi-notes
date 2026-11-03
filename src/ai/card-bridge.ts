/**
 * 代码块卡片 → AI 会话桥(与 slash setSlashAiHandler 同构)。
 * NodeView 不直接持有 React session,经模块级 handler 注入。
 */

import type { Editor } from "@tiptap/core";
import type { AiActionId } from "./actions";

export type CardAiHandler = (
  editor: Editor,
  actionId: AiActionId,
  /** 该卡片 codeBlock 节点起点,必须传入以免下拉抢焦点后选区跑偏 */
  nodePos: number,
) => void;

let handler: CardAiHandler | null = null;

export function setCardAiHandler(fn: CardAiHandler | null): void {
  handler = fn;
}

export function cardAiAvailable(): boolean {
  return handler != null;
}

export function runCardAi(editor: Editor, actionId: AiActionId, nodePos: number): void {
  handler?.(editor, actionId, nodePos);
}
