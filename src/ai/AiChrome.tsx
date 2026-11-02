import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import {
  Check,
  ClipboardCopy,
  Languages,
  Loader2,
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

export function AiChrome({ editor, session, enabled, onNeedSettings }: AiChromeProps) {
  const [bar, setBar] = useState<{ top: number; left: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null);
  const [pending, setPending] = useState<PendingOption | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 选区浮动条定位
  useLayoutEffect(() => {
    const sync = () => {
      if (!enabled || session.state.phase === "running" || session.state.phase === "result") {
        setBar(null);
        return;
      }
      const { empty, from, to } = editor.state.selection;
      if (empty) {
        setBar(null);
        return;
      }
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const left = Math.min(start.left, end.left);
      const top = Math.min(start.top, end.top) - 44;
      const parent = wrapRef.current?.offsetParent as HTMLElement | null;
      const pref = parent?.getBoundingClientRect();
      setBar({
        top: top - (pref?.top ?? 0) + (parent?.scrollTop ?? 0),
        left: left - (pref?.left ?? 0) + (parent?.scrollLeft ?? 0),
      });
    };
    sync();
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
    };
  }, [editor, enabled, session.state.phase]);

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
    void session.run(editor, id, option, id === "continue");
  };

  const pickAction = (id: AiActionId) => {
    if (!enabled) {
      onNeedSettings();
      return;
    }
    const def = AI_ACTIONS.find((a) => a.id === id)!;
    if (!def.allowEmptySelection && editor.state.selection.empty && id !== "continue") {
      // 允许对当前段:二次由 run(allowBlockFallback) — 续写除外
      if (window.confirm("未选中文字,是否对当前段落使用 AI?")) {
        void session.run(editor, id, undefined, true);
        setMenu(null);
        return;
      }
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
          style={{ top: bar.top, left: bar.left }}
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

      {/* 请求中 / 结果条 — 贴编辑列底 */}
      {(session.state.phase === "running" ||
        session.state.phase === "result" ||
        session.state.phase === "error") && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-3 z-30 flex justify-center px-4">
          <div
            className={cn(
              "border-border-subtle bg-raised flex max-w-xl flex-col gap-2 rounded-xl border px-3 py-2.5 shadow-[0_12px_32px_-16px_color-mix(in_oklab,var(--foreground)_30%,transparent)]",
            )}
          >
            {session.state.phase === "running" && (
              <div className="flex items-center gap-2 text-[12px]">
                <Loader2 className="text-primary size-3.5 animate-spin" />
                <span className="text-foreground/80">
                  正在请求：<span className="font-medium tabular-nums">{session.state.host}</span>
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground ml-auto text-[11px]"
                  onClick={() => void session.cancel()}
                >
                  取消
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
            {session.state.phase === "result" && (
              <>
                <div className="flex items-center gap-2">
                  <Sparkles className="text-primary size-3.5" />
                  <span className="text-[12px] font-medium">{session.state.actionLabel}结果</span>
                  <button type="button" className="ml-auto p-0.5" onClick={session.clearResult}>
                    <X className="text-muted-foreground size-3.5" />
                  </button>
                </div>
                <pre className="text-muted-foreground max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-5">
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
