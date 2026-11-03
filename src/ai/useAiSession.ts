import { useCallback, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { AppSettings } from "../settings";
import { aiActionById, type AiActionId, type AiApplyMode } from "./actions";
import { applyAiResult, copyAiText, prefixContext, selectionText } from "./apply";
import { aiChat, cancelAi, hostOfBaseUrl } from "./client";
import { resolveCodeBlockContext } from "./node-context";
import {
  filterWikiSuggestOutput,
  formatWikiCatalog,
  type WikiSuggestDoc,
} from "./wiki-suggest";

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
  /** 代码块内容区间(改写/修正 Mermaid) */
  contentRange: { from: number; to: number } | null;
  /** 解释类插入落点(代码块后),避免 NodeSelection 时 insert 整块替换 */
  insertPos: number | null;
  bias: "insert" | "replace";
  actionId: AiActionId | null;
  actionLabel: string;
  /** 请求中文案(「正在…」) */
  runningLabel: string;
  /** AI-2 结构类替换走块级 Markdown */
  blockApply: boolean;
  applyMode: AiApplyMode;
  /** 公式行内/块级等二次选项 */
  option: string | null;
}

const IDLE: AiSessionState = {
  phase: "idle",
  host: "",
  requestId: null,
  result: "",
  error: "",
  range: null,
  contentRange: null,
  insertPos: null,
  bias: "replace",
  actionId: null,
  actionLabel: "",
  runningLabel: "",
  blockApply: false,
  applyMode: "markdown",
  option: null,
};

export function useAiSession(
  settings: AppSettings,
  onNeedSettings: () => void,
  onToast?: (msg: string) => void,
  /** 双链建议用:知识库文档列表(读 ref,可空=单文件/无库) */
  getWikiDocs?: () => WikiSuggestDoc[],
) {
  const [state, setState] = useState<AiSessionState>(IDLE);
  const reqRef = useRef<string | null>(null);
  const getWikiDocsRef = useRef(getWikiDocs);
  getWikiDocsRef.current = getWikiDocs;

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
      /** 代码块卡片传入的节点 pos,只解释/改写这一块 */
      nodePos?: number,
    ) => {
      if (!ready) {
        onNeedSettings();
        onToast?.("请先完成 AI 配置并通过测试");
        return;
      }
      const action = aiActionById(actionId);
      const locked =
        lockedSelection?.from != null && lockedSelection.to > lockedSelection.from
          ? lockedSelection
          : undefined;
      const selection = locked ?? editor.state.selection;
      const empty = locked !== undefined ? false : editor.state.selection.empty;
      const { from, to } = selection;
      let ctx = locked
        ? editor.state.doc.textBetween(locked.from, locked.to, "\n")
        : selectionText(editor);
      let range: { from: number; to: number } | null = locked ?? (empty ? null : { from, to });
      let contentRange: { from: number; to: number } | null = null;
      let insertPos: number | null = null;
      let promptOption = option;

      const codeCtx = resolveCodeBlockContext(editor, nodePos);
      if (action.requireNode === "mermaid") {
        if (!codeCtx || codeCtx.kind !== "mermaid") {
          onToast?.("请先把光标放在 Mermaid 图表内");
          return;
        }
        ctx = codeCtx.text;
        range = codeCtx.range;
        contentRange = codeCtx.contentRange;
        if (typeof nodePos === "number") {
          editor.commands.setNodeSelection(nodePos);
        }
      } else if (action.requireNode === "codeBlock") {
        if (!codeCtx) {
          onToast?.("请先把光标放在代码块内");
          return;
        }
        // 只用这一块的源码,绝不拼其它代码块
        ctx = codeCtx.text;
        range = codeCtx.range;
        contentRange = codeCtx.contentRange;
        insertPos = codeCtx.range.to;
        promptOption = option ?? codeCtx.language;
        if (typeof nodePos === "number") {
          editor.commands.setNodeSelection(nodePos);
        }
      }

      if (!ctx?.trim()) {
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

      let wikiDocs: WikiSuggestDoc[] = [];
      if (action.id === "wikiSuggest") {
        wikiDocs = getWikiDocsRef.current?.() ?? [];
        if (!wikiDocs.length) {
          onToast?.("当前知识库没有可关联的文档");
          return;
        }
        promptOption = formatWikiCatalog(wikiDocs);
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
        contentRange,
        insertPos,
        bias: action.bias,
        actionId: action.id,
        actionLabel: action.label,
        runningLabel: action.runningLabel ?? action.label,
        blockApply: !!action.blockApply,
        applyMode: action.applyMode ?? "markdown",
        option: option ?? null,
      });

      try {
        const text = await aiChat({
          baseUrl: settings.aiBaseUrl,
          model: settings.aiModel,
          system: action.system,
          user: action.userPrompt(ctx, promptOption),
          temperature: settings.aiTemperature,
          maxTokens: settings.aiMaxTokens,
          requestId,
        });
        if (reqRef.current !== requestId) return;
        const result =
          action.id === "wikiSuggest" ? filterWikiSuggestOutput(text, wikiDocs) : text;
        setState((s) => ({
          ...s,
          phase: "result",
          result,
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
      // 解释代码:落到该代码块后方,避免当前仍是 NodeSelection 时整块被替换
      if (
        mode === "insert" &&
        state.actionId === "explainCode" &&
        typeof state.insertPos === "number"
      ) {
        const pos = Math.min(state.insertPos, editor.state.doc.content.size);
        editor.chain().focus().setTextSelection(pos).run();
      }
      applyAiResult(editor, state.result, mode, state.range, {
        applyMode: state.applyMode,
        blockApply: state.blockApply,
        mathOption: state.option ?? undefined,
        contentRange: state.contentRange,
      });
      setState(IDLE);
    },
    [state, onToast],
  );

  /** 插入单条片段(双链建议逐条选用);不关闭结果条,方便连续挑选 */
  const insertSnippet = useCallback(
    (editor: Editor, markdown: string) => {
      const md = markdown.trim();
      if (!md) return;
      applyAiResult(editor, md, "insert", null, { applyMode: "markdown" });
      onToast?.("已插入");
    },
    [onToast],
  );

  return { state, ready, run, cancel, apply, insertSnippet, clearResult };
}

export type AiSession = ReturnType<typeof useAiSession>;
