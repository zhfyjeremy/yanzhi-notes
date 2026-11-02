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
  LANG_OPTIONS,
  TONE_OPTIONS,
  type AiActionId,
} from "./actions";
import type { AiSession } from "./useAiSession";
import { selectionText } from "./apply";
import { Hint } from "@/components/hint";
import { cn } from "@/lib/utils";

/**
 * 编辑器 AI 表层(§7.8):
 * - 选区浮动条(主路径)
 * - 结果条:插入 / 替换 / 复制
 * - 右键 AI 子菜单(document contextmenu)
 * 视觉:宣纸 raised 轻条 + 主色点缀,不用紫系聊天壳。
 */

interface AiChromeProps {
  editor: Editor;
  session: AiSession;
  enabled: boolean;
  onNeedSettings: () => void;
}

type PendingOption = { id: AiActionId; kind: "tone" | "lang" };
type FloatingPoint = { top: number; left: number; placement: "top" | "bottom" };

function LoadingDots() {
  return (
    <span className="inline-flex items-end gap-0.5 pb-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="bg-primary/70 size-1.5 rounded-full"
          style={{
            animation: "yz-ai-dot 1s infinite",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
}

export function AiChrome({ editor, session, enabled, onNeedSettings }: AiChromeProps) {
  const [bar, setBar] = useState<FloatingPoint | null>(null);
  const [panel, setPanel] = useState<FloatingPoint | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null);
  const [pending, setPending] = useState<PendingOption | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointerDownRef = useRef(false);
  const toolbarSelectionRef = useRef<{ from: number; to: number } | null>(null);

  // 选区浮动条定位:鼠标拖拽期间始终隐藏;松开且选区含文本后再出现。
  useLayoutEffect(() => {
    let timer = 0;
    const parent = wrapRef.current?.offsetParent as HTMLElement | null;
    const hide = () => {
      window.clearTimeout(timer);
      setBar(null);
    };
    const position = () => {
      if (!enabled || session.state.phase !== "idle" || editor.isDestroyed) {
        setBar(null);
        return;
      }
      const { empty, from, to } = editor.state.selection;
      const hasText = !empty && selectionText(editor).trim().length > 0;
      if (!hasText) {
        toolbarSelectionRef.current = null;
        setBar(null);
        return;
      }
      toolbarSelectionRef.current = { from, to };
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);
      const pref = parent?.getBoundingClientRect();
      const x = (left + right) / 2 - (pref?.left ?? 0) + (parent?.scrollLeft ?? 0);
      const width = parent?.clientWidth ?? 0;
      const clampedX = Math.max(170, Math.min(x, Math.max(170, width - 170)));
      const aboveViewport = top >= 180;
      setBar({
        top:
          (aboveViewport ? top : bottom) -
          (pref?.top ?? 0) +
          (parent?.scrollTop ?? 0) +
          (aboveViewport ? -44 : 10),
        left: clampedX,
        placement: aboveViewport ? "top" : "bottom",
      });
    };
    const schedule = (delay = 220) => {
      hide();
      if (pointerDownRef.current) return;
      timer = window.setTimeout(position, delay);
    };
    const onPointerDown = () => {
      pointerDownRef.current = true;
      hide();
    };
    const onPointerUp = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      schedule(120);
    };
    const onEditorChange = () => schedule();
    editor.on("selectionUpdate", onEditorChange);
    editor.on("transaction", onEditorChange);
    editor.view.dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      hide();
      editor.off("selectionUpdate", onEditorChange);
      editor.off("transaction", onEditorChange);
      editor.view.dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [editor, enabled, session.state.phase]);

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
      const halfWidth = phase === "running" ? 24 : 192;
      const anchorX = phase === "running" ? end.right : (left + right) / 2;
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

  // 右键菜单
  useEffect(() => {
    const dom = editor.view.dom;
    const onCtx = (e: MouseEvent) => {
      if (!enabled) return;
      // 仅在编辑器正文内、且未点在原生控件上
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, button, a, .yz-code-card")) return;
      e.preventDefault();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        hasSel: !editor.state.selection.empty,
      });
      setPending(null);
    };
    const close = () => setMenu(null);
    dom.addEventListener("contextmenu", onCtx);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      dom.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [editor, enabled]);

  const trigger = (id: AiActionId, option?: string) => {
    setMenu(null);
    setPending(null);
    setBar(null);
    const def = AI_ACTIONS.find((a) => a.id === id)!;
    if (def.option && !option) {
      setPending({ id, kind: def.option });
      return;
    }
    void session.run(editor, id, option, toolbarSelectionRef.current ?? undefined);
  };

  const pickAction = (id: AiActionId) => {
    if (!enabled) {
      onNeedSettings();
      return;
    }
    const def = AI_ACTIONS.find((a) => a.id === id)!;
    if (!def.allowEmptySelection && editor.state.selection.empty && !toolbarSelectionRef.current) {
      setMenu(null);
      return;
    }
    trigger(id);
  };

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-20 overflow-visible">
      {/* 选区浮动条:未开启时仅一枚引导芯片 */}
      {bar && session.state.phase === "idle" && (
        <div
          className="pointer-events-auto absolute flex items-center gap-0.5 rounded-lg border border-border-subtle bg-raised px-1 py-0.5 shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--foreground)_28%,transparent)]"
          style={{
            top: bar.top,
            left: bar.left,
            transform: "translateX(-50%)",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {!enabled ? (
            <button
              type="button"
              className="text-primary hover:bg-hover flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
              onClick={onNeedSettings}
            >
              <Sparkles className="size-3" />
              AI · 去设置开启
            </button>
          ) : (
            <>
              <span className="text-primary flex items-center gap-1 px-1.5 text-[11px] font-medium">
                <Sparkles className="size-3" />
                AI
              </span>
              <span className="bg-border-subtle mx-0.5 h-3 w-px" />
              {(["polish", "expand", "shorten", "translate", "fix"] as AiActionId[]).map((id) => {
                const a = AI_ACTIONS.find((x) => x.id === id)!;
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="hover:bg-hover text-foreground/80 hover:text-foreground rounded-md px-1.5 py-1 text-[11px]"
                    onClick={() => pickAction(a.id)}
                  >
                    {a.label}
                  </button>
                );
              })}
              <Hint label="更多 AI 动作">
                <button
                  type="button"
                  className="hover:bg-hover text-muted-foreground rounded-md px-1.5 py-1 text-[11px]"
                  onClick={(e) => {
                    const r = (e.target as HTMLElement).getBoundingClientRect();
                    setMenu({ x: r.left, y: r.bottom + 4, hasSel: true });
                  }}
                >
                  更多
                </button>
              </Hint>
            </>
          )}
        </div>
      )}

      {/* 语气/语言选项 */}
      {pending && (
        <div
          className="pointer-events-auto fixed z-50 flex flex-col gap-0.5 rounded-lg border border-border-subtle bg-raised p-1 shadow-md"
          style={{
            top: menu?.y ?? 120,
            left: menu?.x ?? 120,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="text-muted-foreground px-2 py-1 text-[10px]">
            {pending.kind === "tone" ? "选择语气" : "目标语言"}
          </p>
          {(pending.kind === "tone" ? TONE_OPTIONS : LANG_OPTIONS).map((opt) => (
            <button
              key={opt}
              type="button"
              className="hover:bg-hover rounded-md px-2.5 py-1.5 text-left text-[12px]"
              onClick={() => trigger(pending.id, opt)}
            >
              {opt}
            </button>
          ))}
          <button
            type="button"
            className="text-muted-foreground hover:bg-hover rounded-md px-2.5 py-1 text-left text-[11px]"
            onClick={() => setPending(null)}
          >
            取消
          </button>
        </div>
      )}

      {/* 右键 / 更多菜单 */}
      {menu && !pending && (
        <div
          className="pointer-events-auto fixed z-50 min-w-40 rounded-lg border border-border-subtle bg-raised p-1 shadow-md"
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-primary flex items-center gap-1 px-2 py-1 text-[10px] font-medium">
            <Sparkles className="size-3" />
            AI 助手
          </p>
          {AI_ACTIONS.filter((a) => menu.hasSel || a.allowEmptySelection).map((a) => (
            <button
              key={a.id}
              type="button"
              className="hover:bg-hover flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px]"
              onClick={() => pickAction(a.id)}
            >
              {a.id === "translate" ? <Languages className="size-3.5 opacity-60" /> : null}
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* 请求中 / 结果条 — 跟随选区，上方优先/下方兜底并水平居中 */}
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
              session.state.phase === "running"
                ? "flex items-center justify-center"
                : "border-border-subtle bg-raised flex w-[min(24rem,calc(100vw-2rem))] max-w-full flex-col gap-2 rounded-xl border px-3 py-2.5 shadow-[0_10px_28px_-18px_color-mix(in_oklab,var(--foreground)_28%,transparent)]",
            )}
          >
            {session.state.phase === "running" && (
              <div className="flex h-6 items-center justify-center">
                <LoadingDots />
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
            {session.state.phase === "result" && (
              <>
                <div className="flex items-center gap-2">
                  <Sparkles className="text-primary size-3.5" />
                  <span className="text-[12px] font-medium">{session.state.actionLabel}结果</span>
                  <button type="button" className="ml-auto p-0.5" onClick={session.clearResult}>
                    <X className="text-muted-foreground size-3.5" />
                  </button>
                </div>
                <pre className="text-muted-foreground max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-5">
                  {session.state.result.slice(0, 800)}
                  {session.state.result.length > 800 ? "…" : ""}
                </pre>
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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
