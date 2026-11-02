import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { AppSettings } from "../settings";
import { aiActionById, type AiActionId } from "./actions";
import { applyAiMarkdown, copyAiText, prefixContext, selectionText } from "./apply";
import { aiChat, cancelAi, hostOfBaseUrl } from "./client";

export type AiPhase = "idle" | "running" | "result" | "error";

export interface LockedAiSelection {
  from: number;
  to: number;
}

export interface AiSessionState {
  phase: AiPhase;
  host: string;
  requestId: string | null;
  result: string;
  error: string;
  /** 生成时锁定的选区,供替换 */
  range: { from: number; to: number } | null;
  bias: "insert" | "replace";
  actionLabel: string;
}

const IDLE: AiSessionState = {
  phase: "idle",
  host: "",
  requestId: null,
  result: "",
  error: "",
  range: null,
  bias: "replace",
  actionLabel: "",
};

export function useAiSession(
  settings: AppSettings,
  onNeedSettings: () => void,
  onToast?: (msg: string) => void,
) {
  const [state, setState] = useState<AiSessionState>(IDLE);
  const reqRef = useRef<string | null>(null);

  // 测试通过才暴露编辑器入口;Key 仍在真正请求时读取。
  const ready = settings.aiEnabled && settings.aiVerified;

  const cancel = useCallback(async () => {
    const id = reqRef.current;
    if (id) await cancelAi(id).catch(() => {});
    reqRef.current = null;
    setState(IDLE);
  }, []);

  const clearResult = useCallback(() => setState(IDLE), []);

  const run = useCallback(
    async (
      editor: Editor,
      actionId: AiActionId,
      option?: string,
      lockedSelection?: LockedAiSelection,
    ) => {
      if (!ready) {
        onNeedSettings();
        onToast?.("请先完成 AI 配置并通过测试");
        return;
      }
      const action = aiActionById(actionId);
      const locked = lockedSelection?.from != null && lockedSelection.to > lockedSelection.from
        ? lockedSelection
        : undefined;
      const selection = locked ?? editor.state.selection;
      const empty = locked !== undefined ? false : editor.state.selection.empty;
      const { from, to } = selection;
      let ctx = locked
        ? editor.state.doc.textBetween(locked.from, locked.to, "\n")
        : selectionText(editor);
      let range: { from: number; to: number } | null = locked ?? (empty ? null : { from, to });

      if (!ctx) {
        if (action.id === "continue") {
          ctx = prefixContext(editor);
          if (!ctx.trim()) {
            onToast?.("光标前没有可续写的上文");
            return;
          }
          range = null;
        } else {
          onToast?.(`请先选中要${action.label}的文字`);
          return;
        }
      }

      if (!settings.aiBaseUrl.trim() || !settings.aiModel.trim()) {
        onNeedSettings();
        return;
      }

      const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      reqRef.current = requestId;
      const host = hostOfBaseUrl(settings.aiBaseUrl);
      setState({
        phase: "running",
        host,
        requestId,
        result: "",
        error: "",
        range,
        bias: action.bias,
        actionLabel: action.label,
      });

      try {
        const text = await aiChat({
          baseUrl: settings.aiBaseUrl,
          model: settings.aiModel,
          system: action.system,
          user: action.userPrompt(ctx, option),
          temperature: settings.aiTemperature,
          maxTokens: settings.aiMaxTokens,
          requestId,
        });
        if (reqRef.current !== requestId) return;
        setState((s) => ({
          ...s,
          phase: "result",
          result: text,
          requestId: null,
        }));
        reqRef.current = null;
      } catch (e) {
        if (reqRef.current !== requestId) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("未配置") || msg.includes("Key")) {
          setState(IDLE);
          onNeedSettings();
          onToast?.(msg);
          return;
        }
        setState((s) => ({
          ...s,
          phase: msg === "已取消" ? "idle" : "error",
          error: msg === "已取消" ? "" : msg,
          requestId: null,
          result: "",
        }));
        reqRef.current = null;
        if (msg === "已取消") setState(IDLE);
      }
    },
    [ready, settings, onNeedSettings, onToast],
  );

  const apply = useCallback(
    async (editor: Editor, mode: "insert" | "replace" | "copy") => {
      if (!state.result) return;
      if (mode === "copy") {
        await copyAiText(state.result);
        onToast?.("已复制");
        setState(IDLE);
        return;
      }
      applyAiMarkdown(
        editor,
        state.result,
        mode,
        mode === "replace" ? state.range ?? undefined : undefined,
      );
      setState(IDLE);
    },
    [state.result, state.range, onToast],
  );

  return { state, ready, run, cancel, apply, clearResult };
}

export type AiSession = ReturnType<typeof useAiSession>;
