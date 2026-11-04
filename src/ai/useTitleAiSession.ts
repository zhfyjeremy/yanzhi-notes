import { useCallback, useEffect, useRef, useState } from "react";
import type { AppSettings } from "../settings";
import { aiChat, cancelAi, hostOfBaseUrl } from "./client";
import {
  TITLE_AI_SYSTEM,
  markdownFingerprint,
  parseAiTitleSuggestions,
  titleSuggestUserPrompt,
} from "./title-suggest";

export type TitleAiPhase = "idle" | "running" | "result" | "error";

export interface TitleAiState {
  phase: TitleAiPhase;
  host: string;
  requestId: string | null;
  candidates: string[];
  error: string;
  sourcePath: string;
  fingerprint: string;
}

export interface TitleAiRunInput {
  markdown: string;
  sourcePath: string;
}

const IDLE: TitleAiState = {
  phase: "idle",
  host: "",
  requestId: null,
  candidates: [],
  error: "",
  sourcePath: "",
  fingerprint: "",
};

export function useTitleAiSession(
  settings: AppSettings,
  onNeedSettings: () => void,
  onToast?: (msg: string) => void,
) {
  const [state, setState] = useState<TitleAiState>(IDLE);
  const reqRef = useRef<string | null>(null);
  const ready = settings.aiEnabled && settings.aiVerified;

  const cancel = useCallback(async () => {
    const id = reqRef.current;
    if (id) await cancelAi(id).catch(() => {});
    reqRef.current = null;
    setState(IDLE);
  }, []);

  const clearResult = useCallback(() => setState(IDLE), []);

  // 请求期间用户关闭总开关时立即停止,不能继续等待已发出的调用自然完成。
  useEffect(() => {
    if (ready || !reqRef.current) return;
    void cancel();
  }, [ready, cancel]);

  const run = useCallback(
    async ({ markdown, sourcePath }: TitleAiRunInput) => {
      if (!ready) {
        onNeedSettings();
        onToast?.("请先完成 AI 配置并通过测试");
        return;
      }
      if (!sourcePath.endsWith(".md")) {
        onToast?.("仅知识库文档支持 AI 起标题");
        return;
      }
      if (!markdown.trim()) {
        onToast?.("先写一点内容，再让 AI 起标题");
        return;
      }
      if (!settings.aiBaseUrl.trim() || !settings.aiModel.trim()) {
        onNeedSettings();
        return;
      }

      const requestId = `title-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      reqRef.current = requestId;
      setState({
        phase: "running",
        host: hostOfBaseUrl(settings.aiBaseUrl),
        requestId,
        candidates: [],
        error: "",
        sourcePath,
        fingerprint: markdownFingerprint(markdown),
      });

      try {
        const text = await aiChat({
          baseUrl: settings.aiBaseUrl,
          model: settings.aiModel,
          system: TITLE_AI_SYSTEM,
          user: titleSuggestUserPrompt(markdown),
          temperature: settings.aiTemperature,
          maxTokens: Math.max(96, Math.min(settings.aiMaxTokens || 192, 192)),
          requestId,
        });
        if (reqRef.current !== requestId) return;
        const candidates = parseAiTitleSuggestions(text);
        if (!candidates.length) throw new Error("模型未返回可用标题");
        reqRef.current = null;
        setState((s) => ({ ...s, phase: "result", candidates, requestId: null }));
      } catch (e) {
        if (reqRef.current !== requestId) return;
        const msg = e instanceof Error ? e.message : String(e);
        reqRef.current = null;
        if (msg === "已取消") {
          setState(IDLE);
          return;
        }
        if (msg.includes("未配置") || msg.includes("Key")) {
          setState(IDLE);
          onNeedSettings();
          onToast?.(msg);
          return;
        }
        setState((s) => ({ ...s, phase: "error", error: msg, requestId: null }));
      }
    },
    [ready, settings, onNeedSettings, onToast],
  );

  return { state, ready, run, cancel, clearResult };
}

export type TitleAiSession = ReturnType<typeof useTitleAiSession>;
