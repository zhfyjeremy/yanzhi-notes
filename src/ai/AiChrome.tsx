import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  Check,
  ClipboardCopy,
  Languages,
  Sparkles,
  X,
} from "lucide-react";
import {
  AI_ACTIONS,
  AI_GROUP_LABEL,
  LANG_OPTIONS,
  MATH_OPTIONS,
  TONE_OPTIONS,
  visibleAiActions,
  type AiActionId,
} from "./actions";
import { placeFloatMenu, type FloatMenuPos } from "./float-menu";
import type { AiSession } from "./useAiSession";
import { parseWikiSuggestTargets } from "./wiki-suggest";
import { cn } from "@/lib/utils";
import { LoadingDots } from "./LoadingDots";
import { shortcutMatches } from "@/shortcuts";

/**
 * 编辑器 AI 表层(§7.8)精简版:
 * - 请求中 / 结果条(跟随选区)
 * - 右键 / ⌘⇧A AI 动作菜单
 * 选区 idle 浮动条已并入 SelectionBubble(格式 + AI 入口)。
 */

interface AiChromeProps {
  editor: Editor;
  session: AiSession;
  enabled: boolean;
  onNeedSettings: () => void;
  /** 打开 AI 动作菜单(默认 Mod+Shift+A,可在快捷键窗改) */
  menuShortcut?: string;
}

type PendingOption = { id: AiActionId; kind: "tone" | "lang" | "math" };
type FloatingPoint = { top: number; left: number; placement: "top" | "bottom" };
type CtxMenu = FloatMenuPos & { hasSel: boolean };

export function AiChrome({
  editor,
  session,
  enabled,
  onNeedSettings,
  menuShortcut = "Mod+Shift+KeyA",
}: AiChromeProps) {
  const [panel, setPanel] = useState<FloatingPoint | null>(null);
  const [menu, setMenu] = useState<CtxMenu | null>(null);
  const [pending, setPending] = useState<PendingOption | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const ctxSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const menuOpenRef = useRef(false);
  const pendingRef = useRef(false);
  menuOpenRef.current = !!menu;
  pendingRef.current = !!pending;

  const openActionMenuAt = (clientX: number, clientY: number, hasSel: boolean) => {
    const pos = placeFloatMenu(
      { left: clientX, right: clientX, top: clientY, bottom: clientY },
      { estimatedHeight: 460, width: 176, preferBelow: true },
    );
    setMenu({ ...pos, hasSel });
    setPending(null);
  };

  // 请求/结果面板锚定选区:优先上方，视口不足放下方，并按选区中心水平居中。
  useLayoutEffect(() => {
    const phase = session.state.phase;
    if (phase !== "running" && phase !== "result" && phase !== "error") {
      setPanel(null);
      return;
    }
    const parent = wrapRef.current?.offsetParent as HTMLElement | null;
    const position = () => {
      if (editor.isDestroyed) return;
      const range = session.state.range;
      const from = range?.from ?? editor.state.selection.from;
      const to = range?.to ?? editor.state.selection.to;
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);
      const pref = parent?.getBoundingClientRect();
      const width = parent?.clientWidth ?? 0;
      // running / result 都锚在选区水平中心,避免「裸点挂在行尾」与结果条错位
      const halfWidth = phase === "running" ? 88 : 192;
      const anchorX = (left + right) / 2;
      const x = anchorX - (pref?.left ?? 0) + (parent?.scrollLeft ?? 0);
      const aboveViewport = top >= 250;
      setPanel({
        top:
          (aboveViewport ? top : bottom) -
          (pref?.top ?? 0) +
          (parent?.scrollTop ?? 0) +
          (aboveViewport ? -12 : 12),
        left: Math.max(halfWidth, Math.min(x, Math.max(halfWidth, width - halfWidth))),
        placement: aboveViewport ? "top" : "bottom",
      });
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [editor, session.state.phase, session.state.range]);

  // 右键菜单 + ⌘/Ctrl+Shift+A 动作菜单
  useEffect(() => {
    const dom = editor.view.dom;
    const onCtx = (e: MouseEvent) => {
      if (!enabled) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, button, a, .yz-code-card")) return;
      e.preventDefault();
      const { empty, from, to } = editor.state.selection;
      ctxSelectionRef.current = empty ? null : { from, to };
      openActionMenuAt(e.clientX, e.clientY, !empty);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutMatches(e, menuShortcut)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='false']")) return;
      e.preventDefault();
      e.stopPropagation();
      if (!enabled) {
        onNeedSettings();
        return;
      }
      // 再按一次关闭
      if (menuOpenRef.current || pendingRef.current) {
        setMenu(null);
        setPending(null);
        return;
      }
      if (session.state.phase !== "idle") return;
      const { empty, from, to } = editor.state.selection;
      ctxSelectionRef.current = empty ? null : { from, to };
      const coords = editor.view.coordsAtPos(empty ? from : Math.floor((from + to) / 2));
      openActionMenuAt(coords.left, coords.bottom, !empty);
    };
    const close = () => {
      setMenu(null);
      setPending(null);
    };
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && floatRef.current?.contains(t)) return;
      close();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!menuOpenRef.current && !pendingRef.current) return;
      e.preventDefault();
      close();
    };
    dom.addEventListener("contextmenu", onCtx);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onEsc);
    window.addEventListener("click", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      dom.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editor, enabled, menuShortcut, onNeedSettings, session.state.phase]);

  const trigger = (id: AiActionId, option?: string) => {
    const def = AI_ACTIONS.find((a) => a.id === id)!;
    if (def.option && !option) {
      // 保留 menu 坐标给语气/语言/公式二次面板
      setPending({ id, kind: def.option });
      return;
    }
    setMenu(null);
    setPending(null);
    void session.run(editor, id, option, ctxSelectionRef.current ?? undefined);
  };

  const pickAction = (id: AiActionId) => {
    if (!enabled) {
      onNeedSettings();
      return;
    }
    const def = AI_ACTIONS.find((a) => a.id === id)!;
    if (!def.allowEmptySelection && editor.state.selection.empty && !ctxSelectionRef.current) {
      setMenu(null);
      return;
    }
    trigger(id);
  };

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-20 overflow-visible">
      {pending && (
        <div
          ref={floatRef}
          className="chrome-float pointer-events-auto fixed z-50 flex max-h-[min(50vh,20rem)] flex-col gap-0.5 overflow-y-auto rounded-lg border border-border-subtle bg-raised p-1 shadow-md"
          style={{
            top: menu?.y ?? 120,
            left: menu?.x ?? 120,
            transform: menu?.placement === "top" ? "translateY(-100%)" : undefined,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="text-muted-foreground px-2 py-1 text-[10px]">
            {pending.kind === "tone"
              ? "选择语气"
              : pending.kind === "math"
                ? "公式形态"
                : "目标语言"}
          </p>
          {(pending.kind === "tone"
            ? TONE_OPTIONS
            : pending.kind === "math"
              ? MATH_OPTIONS
              : LANG_OPTIONS
          ).map((opt) => (
            <button
              key={opt}
              type="button"
              className="hover:bg-hover cursor-pointer rounded-md px-2.5 py-1.5 text-left text-[12px]"
              onClick={() => trigger(pending.id, opt)}
            >
              {opt}
            </button>
          ))}
          <button
            type="button"
            className="text-muted-foreground hover:bg-hover cursor-pointer rounded-md px-2.5 py-1 text-left text-[11px]"
            onClick={() => setPending(null)}
          >
            取消
          </button>
        </div>
      )}

      {menu && !pending && (
        <div
          ref={floatRef}
          className="chrome-float pointer-events-auto fixed z-50 flex min-w-40 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised p-1 shadow-md"
          style={{
            top: menu.y,
            left: menu.x,
            maxHeight: menu.maxHeight,
            transform: menu.placement === "top" ? "translateY(-100%)" : undefined,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-primary flex shrink-0 items-center gap-1 bg-raised px-2 py-1 text-[10px] font-medium">
            <Sparkles className="size-3" />
            AI 助手
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleAiActions(editor, menu.hasSel).map((a, i, list) => {
              const prev = list[i - 1];
              const showSep = prev && prev.group !== a.group;
              return (
                <div key={a.id}>
                  {showSep ? (
                    <p className="text-muted-foreground px-2 pt-1.5 pb-0.5 text-[10px]">
                      {AI_GROUP_LABEL[a.group]}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="hover:bg-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px]"
                    onClick={() => pickAction(a.id)}
                  >
                    {a.id === "translate" ? <Languages className="size-3.5 opacity-60" /> : null}
                    {a.label}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(session.state.phase === "running" ||
        session.state.phase === "result" ||
        session.state.phase === "error") &&
        panel && (
        <div
          className="pointer-events-auto absolute z-30"
          style={{
            top: panel.top,
            left: panel.left,
            transform:
              panel.placement === "top" ? "translate(-50%, -100%)" : "translateX(-50%)",
          }}
        >
          <div
            className={cn(
              "border-border-subtle bg-raised shadow-[0_10px_28px_-18px_color-mix(in_oklab,var(--foreground)_28%,transparent)]",
              session.state.phase === "running"
                ? "yz-ai-running-chip flex items-center gap-2 rounded-full border px-2.5 py-1.5"
                : "flex w-[min(24rem,calc(100vw-2rem))] max-w-full flex-col gap-2 rounded-xl border px-3 py-2.5",
            )}
          >
            {session.state.phase === "running" && (
              <div
                className="flex items-center gap-2"
                role="status"
                aria-live="polite"
                aria-label={`正在${session.state.runningLabel || session.state.actionLabel || "处理"}`}
              >
                <span className="bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-full">
                  <Sparkles className="yz-ai-spark size-3" />
                </span>
                <span className="text-foreground flex items-center gap-1.5 text-[12px] leading-none whitespace-nowrap">
                  正在{session.state.runningLabel || session.state.actionLabel || "处理"}
                  <LoadingDots />
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-hover hover:text-foreground -mr-0.5 ml-0.5 rounded-full p-1"
                  onClick={() => void session.cancel()}
                  aria-label="取消"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            {session.state.phase === "error" && (
              <div className="flex items-start gap-2 text-[12px]">
                <p className="text-destructive min-w-0 flex-1 leading-5">{session.state.error}</p>
                <button type="button" className="shrink-0 p-0.5" onClick={session.clearResult}>
                  <X className="size-3.5" />
                </button>
              </div>
            )}
            {session.state.phase === "result" &&
              (() => {
                const wikiTargets =
                  session.state.actionId === "wikiSuggest"
                    ? parseWikiSuggestTargets(session.state.result)
                    : [];
                const wikiMode = session.state.actionId === "wikiSuggest";
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <Sparkles className="text-primary size-3.5" />
                      <span className="text-[12px] font-medium">
                        {wikiMode ? "可选双链" : `${session.state.actionLabel}结果`}
                      </span>
                      <button type="button" className="ml-auto p-0.5" onClick={session.clearResult}>
                        <X className="text-muted-foreground size-3.5" />
                      </button>
                    </div>
                    {wikiMode && wikiTargets.length > 0 ? (
                      <>
                        <p className="text-muted-foreground text-[11px] leading-4">
                          点击一条插入对应双链，可连续挑选
                        </p>
                        <ul className="max-h-44 space-y-0.5 overflow-auto">
                          {wikiTargets.map((target) => (
                            <li key={target}>
                              <button
                                type="button"
                                className="hover:bg-hover border-border-subtle flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px]"
                                onClick={() => session.insertSnippet(editor, `[[${target}]]`)}
                              >
                                <span className="text-primary font-medium">[[{target}]]</span>
                                <span className="text-muted-foreground ml-auto text-[10px]">
                                  插入
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="hover:bg-hover border-border-subtle rounded-md border px-2.5 py-1 text-[11px]"
                            onClick={() => void session.apply(editor, "insert")}
                          >
                            全部插入
                          </button>
                          <button
                            type="button"
                            className="hover:bg-hover border-border-subtle inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px]"
                            onClick={() => void session.apply(editor, "copy")}
                          >
                            <ClipboardCopy className="size-3" />
                            仅复制
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <pre className="text-muted-foreground max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5">
                          {session.state.result.slice(0, 800)}
                          {session.state.result.length > 800 ? "…" : ""}
                        </pre>
                        {!wikiMode && (
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className="bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium"
                              onClick={() => void session.apply(editor, session.state.bias)}
                            >
                              <Check className="size-3" />
                              {session.state.bias === "replace" ? "替换选区" : "插入"}
                            </button>
                            {session.state.bias === "replace" ? (
                              <button
                                type="button"
                                className="hover:bg-hover border-border-subtle rounded-md border px-2.5 py-1 text-[11px]"
                                onClick={() => void session.apply(editor, "insert")}
                              >
                                插入
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="hover:bg-hover border-border-subtle rounded-md border px-2.5 py-1 text-[11px]"
                                onClick={() => void session.apply(editor, "replace")}
                              >
                                替换选区
                              </button>
                            )}
                            <button
                              type="button"
                              className="hover:bg-hover border-border-subtle inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px]"
                              onClick={() => void session.apply(editor, "copy")}
                            >
                              <ClipboardCopy className="size-3" />
                              仅复制
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
          </div>
        </div>
      )}
    </div>
  );
}
