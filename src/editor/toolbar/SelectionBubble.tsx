import { useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Selection } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Check,
  ChevronDown,
  Highlighter,
  Italic,
  Languages,
  Link2,
  Palette,
  Sparkles,
} from "lucide-react";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AI_ACTIONS,
  AI_GROUP_LABEL,
  LANG_OPTIONS,
  MATH_OPTIONS,
  TONE_OPTIONS,
  visibleAiActions,
  type AiActionId,
} from "@/ai/actions";
import type { AiSession } from "@/ai/useAiSession";
import { selectionText } from "@/ai/apply";
import { FONT_COLORS } from "../extensions/font-color";
import { applyLinkAtSelection } from "../apply-link";
import { cn } from "@/lib/utils";

/**
 * 选区气泡工具条(语雀式合并条):
 * 左侧常用格式(粗体/斜体/高亮/颜色/链接);AI 就绪时右侧分隔 + AI 入口。
 * 与 AiChrome 结果条/右键分工:本组件只管 idle 选区态,请求中/结果由 AiChrome 承接。
 */

type FloatingPoint = { top: number; left: number };
type AiOptionKind = NonNullable<(typeof AI_ACTIONS)[number]["option"]>;

/** AI 开启时行内露出的常用动作;其余进「更多」 */
const AI_QUICK: AiActionId[] = ["polish", "expand", "shorten"];

interface SelectionBubbleProps {
  editor: Editor;
  /** AI 已配置且可用时传入;未就绪则只出格式侧,不打扰 */
  ai?: { session: AiSession; enabled: boolean } | null;
}

function BubbleBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={title}>
      <button
        type="button"
        className={cn(
          "text-muted-foreground hover:bg-hover hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-md",
          active && "bg-selection text-foreground ring-primary/20 ring-1",
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        {children}
      </button>
    </Hint>
  );
}

export function SelectionBubble({ editor, ai }: SelectionBubbleProps) {
  const [bar, setBar] = useState<FloatingPoint | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [menuSelection, setMenuSelection] = useState<Selection | null>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  // onOpenChange 的 state 更新是异步的;PM transaction 可能抢在 commit 前进来。
  // 必须同步 ref 先挡住 schedule() 开头的 setBar(null),否则 trigger 卸载后菜单关闭事件丢失。
  const aiMenuOpenRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointerDownRef = useRef(false);
  const lockedSelRef = useRef<{ from: number; to: number } | null>(null);

  const aiBusy = ai?.session.state.phase != null && ai.session.state.phase !== "idle";

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      highlight: ed.isActive("highlight"),
      link: ed.isActive("link"),
      fontColor: (ed.getAttributes("fontColor").color as string | undefined) ?? null,
    }),
  });

  useLayoutEffect(() => {
    let timer = 0;
    const parent = wrapRef.current?.offsetParent as HTMLElement | null;
    const hide = () => {
      window.clearTimeout(timer);
      setBar(null);
    };
    const position = () => {
      // Radix 打开菜单会转移焦点,PM 可能补一次 selection/focus transaction;
      // 此时不能重算/清空气泡,否则 trigger 被卸载,菜单会闪开即关。
      if (editor.isDestroyed || aiBusy || linkOpen || aiMenuOpenRef.current) {
        if (aiBusy) setBar(null);
        return;
      }
      const { empty, from, to } = editor.state.selection;
      const hasText = !empty && selectionText(editor).trim().length > 0;
      if (!hasText) {
        lockedSelRef.current = null;
        setBar(null);
        return;
      }
      lockedSelRef.current = { from, to };
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);
      const pref = parent?.getBoundingClientRect();
      const x = (left + right) / 2 - (pref?.left ?? 0) + (parent?.scrollLeft ?? 0);
      const width = parent?.clientWidth ?? 0;
      const half = ai?.enabled ? 200 : 160;
      const clampedX = Math.max(half, Math.min(x, Math.max(half, width - half)));
      const aboveViewport = top >= 180;
      setBar({
        top:
          (aboveViewport ? top : bottom) -
          (pref?.top ?? 0) +
          (parent?.scrollTop ?? 0) +
          (aboveViewport ? -44 : 10),
        left: clampedX,
      });
    };
    const schedule = (delay = 220) => {
      if (aiMenuOpenRef.current) return;
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
  }, [ai?.enabled, editor, aiBusy, linkOpen]);

  const snapshotMenuSelection = (open: boolean) => {
    if (open) setMenuSelection(editor.state.selection);
  };

  const withMenuSelection = () => {
    const chain = editor.chain().focus();
    if (menuSelection) {
      chain.command(({ tr }) => {
        tr.setSelection(menuSelection);
        return true;
      });
    }
    return chain;
  };

  const restoreEditorFocus = (e: Event) => {
    e.preventDefault();
    editor.commands.focus();
  };

  const openLinkPopover = (open: boolean) => {
    if (open) {
      setMenuSelection(editor.state.selection);
      setLinkUrl((editor.getAttributes("link").href as string) ?? "");
    }
    setLinkOpen(open);
  };

  const applyLink = () => {
    applyLinkAtSelection(editor, linkUrl, menuSelection);
    setLinkOpen(false);
  };

  const triggerAi = (id: AiActionId, option?: string) => {
    if (!ai?.enabled) return;
    setBar(null);
    void ai.session.run(editor, id, option, lockedSelRef.current ?? undefined);
  };

  const aiOn = !!ai?.enabled;
  const moreActions = visibleAiActions(editor, true).filter((a) => !AI_QUICK.includes(a.id));

  const aiOptions = (kind: AiOptionKind) =>
    kind === "tone" ? TONE_OPTIONS : kind === "math" ? MATH_OPTIONS : LANG_OPTIONS;

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-20 overflow-visible">
      {bar && !aiBusy && (
        <div
          className="chrome-float pointer-events-auto absolute flex items-center gap-0.5 rounded-lg border border-border-subtle bg-raised px-1 py-0.5 shadow-[0_8px_24px_-12px_color-mix(in_oklab,var(--foreground)_28%,transparent)]"
          style={{ top: bar.top, left: bar.left, transform: "translateX(-50%)" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <BubbleBtn
            title="加粗"
            active={state.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="size-3.5" />
          </BubbleBtn>
          {/* AI 开时收起斜体/颜色,把位置让给常用 AI;关 AI 时格式全开 */}
          {!aiOn && (
            <BubbleBtn
              title="斜体"
              active={state.italic}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <Italic className="size-3.5" />
            </BubbleBtn>
          )}
          <BubbleBtn
            title="高亮"
            active={state.highlight}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          >
            <Highlighter className="size-3.5" />
          </BubbleBtn>

          {!aiOn && (
            <DropdownMenu onOpenChange={snapshotMenuSelection}>
              <Hint label="文字颜色">
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "text-muted-foreground hover:bg-hover hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-md",
                      state.fontColor && "bg-selection text-foreground ring-primary/20 ring-1",
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <Palette className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
              </Hint>
              <DropdownMenuContent
                align="start"
                className="z-50 w-40 p-2"
                onCloseAutoFocus={restoreEditorFocus}
              >
                <div className="grid grid-cols-4 gap-1">
                  {FONT_COLORS.map((c) => (
                    <DropdownMenuItem
                      key={c.value}
                      title={c.label}
                      className="justify-center px-1"
                      onClick={() =>
                        withMenuSelection().setMark("fontColor", { color: c.value }).run()
                      }
                    >
                      <span
                        className="flex size-6 items-center justify-center rounded-md"
                        style={{ backgroundColor: c.value }}
                      >
                        {state.fontColor === c.value && (
                          <Check className="size-3.5 text-white" />
                        )}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuSeparator className="my-1.5" />
                <DropdownMenuItem onClick={() => withMenuSelection().unsetMark("fontColor").run()}>
                  <span className="text-muted-foreground border-border flex size-6 items-center justify-center rounded-md border border-dashed text-xs">
                    A
                  </span>
                  默认
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Popover open={linkOpen} onOpenChange={openLinkPopover}>
            <Hint label="链接">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "text-muted-foreground hover:bg-hover hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-md",
                    state.link && "bg-selection text-foreground ring-primary/20 ring-1",
                  )}
                >
                  <Link2 className="size-3.5" />
                </button>
              </PopoverTrigger>
            </Hint>
            <PopoverContent
              align="start"
              className="z-50 w-72 p-2.5"
              onCloseAutoFocus={restoreEditorFocus}
            >
              <Input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyLink();
                  if (e.key === "Escape") setLinkOpen(false);
                }}
                placeholder="https:// 或文件路径"
              />
              <div className="mt-2 flex justify-end gap-1.5">
                {editor.isActive("link") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      applyLinkAtSelection(editor, "", menuSelection);
                      setLinkOpen(false);
                    }}
                  >
                    移除
                  </Button>
                )}
                <Button size="sm" disabled={!linkUrl.trim()} onClick={applyLink}>
                  确定
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          {aiOn && (
            <>
              <span className="bg-border-subtle mx-0.5 h-3.5 w-px shrink-0" />
              <span className="text-primary flex items-center px-0.5" aria-hidden>
                <Sparkles className="size-3" />
              </span>
              {AI_QUICK.map((id) => {
                const a = AI_ACTIONS.find((x) => x.id === id)!;
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="hover:bg-hover text-foreground/85 hover:text-foreground inline-flex h-7 shrink-0 cursor-pointer items-center rounded-md px-1.5 text-[11px] whitespace-nowrap"
                    onClick={() => triggerAi(a.id)}
                  >
                    {a.label}
                  </button>
                );
              })}
              <DropdownMenu
                onOpenChange={(open) => {
                  aiMenuOpenRef.current = open;
                  setAiMenuOpen(open);
                  snapshotMenuSelection(open);
                }}
              >
                <Hint label="更多 AI 动作">
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "text-muted-foreground hover:bg-hover hover:text-foreground inline-flex h-7 shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 text-[11px] whitespace-nowrap",
                        aiMenuOpen && "bg-selection text-foreground ring-primary/20 ring-1",
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      更多
                      <ChevronDown className="size-3 opacity-70" />
                    </button>
                  </DropdownMenuTrigger>
                </Hint>
                <DropdownMenuContent
                  align="end"
                  className="w-44"
                  onCloseAutoFocus={restoreEditorFocus}
                >
                  {moreActions.map((a, i) => {
                    const prev = moreActions[i - 1];
                    return (
                      <div key={a.id}>
                        {prev && prev.group !== a.group ? (
                          <DropdownMenuSeparator />
                        ) : null}
                        {i === 0 || prev?.group !== a.group ? (
                          <DropdownMenuLabel>
                            {AI_GROUP_LABEL[a.group]}
                          </DropdownMenuLabel>
                        ) : null}
                        {a.option ? (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>{a.label}</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="w-36">
                              {aiOptions(a.option).map((opt) => (
                                <DropdownMenuItem
                                  key={opt}
                                  onSelect={() => triggerAi(a.id, opt)}
                                >
                                  {opt}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ) : (
                          <DropdownMenuItem onSelect={() => triggerAi(a.id)}>
                            {a.id === "translate" ? (
                              <Languages className="text-muted-foreground size-3.5" />
                            ) : null}
                            {a.label}
                          </DropdownMenuItem>
                        )}
                      </div>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      )}

    </div>
  );
}
