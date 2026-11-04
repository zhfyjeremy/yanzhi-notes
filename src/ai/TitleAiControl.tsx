import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TitleAiState } from "./useTitleAiSession";

export interface TitleAiConfirmInfo {
  host: string;
  chars: number;
  clipped: boolean;
}

interface TitleAiControlProps {
  state: TitleAiState;
  ready: boolean;
  currentTitle: string;
  stale: boolean;
  popoverOpen: boolean;
  confirm: TitleAiConfirmInfo | null;
  onPopoverOpenChange: (open: boolean) => void;
  onStart: () => void;
  onConfirm: () => void;
  onNeedSettings: () => void;
  onApply: (title: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
}

const fmt = (n: number) => n.toLocaleString("zh-Hans-CN");

export function TitleAiControl({
  state,
  ready,
  currentTitle,
  stale,
  popoverOpen,
  confirm,
  onPopoverOpenChange,
  onStart,
  onConfirm,
  onNeedSettings,
  onApply,
  onCancel,
  onDismiss,
}: TitleAiControlProps) {
  const running = state.phase === "running";

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
        <Hint label={running ? "AI 正在起标题" : "AI 起标题"}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-busy={running}
              onClick={() => {
                if (!ready) {
                  onNeedSettings();
                  return;
                }
                if (state.phase === "idle" && !popoverOpen) onStart();
              }}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent align="end" className="w-80 gap-2 text-xs" onOpenAutoFocus={(e) => e.preventDefault()}>
          {state.phase === "running" && (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="text-primary size-3.5" />
                  正在生成标题
                </p>
                <p className="text-muted-foreground mt-1 leading-4">正在请求：{state.host}</p>
              </div>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => void onCancel()} aria-label="取消标题生成">
                <X className="size-3.5" />
              </Button>
            </div>
          )}

          {state.phase === "error" && (
            <div className="flex items-start gap-2">
              <p className="text-destructive min-w-0 flex-1 leading-5">{state.error}</p>
              <Button type="button" variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="关闭标题生成错误">
                <X className="size-3.5" />
              </Button>
            </div>
          )}

          {state.phase === "result" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary size-3.5" />
                <span className="font-medium">选择新标题</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  onClick={onDismiss}
                  aria-label="关闭标题候选"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <p className="text-muted-foreground leading-4">
                当前：<span className="text-foreground">{currentTitle || "未命名文档"}</span>
              </p>
              <ul className="space-y-1">
                {state.candidates.map((candidate) => (
                  <li key={candidate}>
                    <button
                      type="button"
                      disabled={stale}
                      className="hover:bg-hover border-border-subtle flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-55"
                      onClick={() => onApply(candidate)}
                    >
                      <span className="min-w-0 flex-1 truncate">{candidate}</span>
                      <Check className="text-muted-foreground size-3 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-[11px] leading-4">
                {stale
                  ? "文档已修改或切换，请重新生成标题。"
                  : "应用后将重命名文件，并自动更新双链引用。"}
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>

          {state.phase === "idle" && confirm && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary size-3.5" />
                <span className="font-medium">AI 起标题</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  onClick={onDismiss}
                  aria-label="取消 AI 起标题"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <p className="text-muted-foreground leading-4">
                将发送当前文档{confirm.clipped ? `前 ${fmt(confirm.chars)} 字` : ` ${fmt(confirm.chars)} 字`}到：
                <span className="text-foreground font-medium">{confirm.host}</span>。点击候选后才会重命名。
              </p>
              <div className="flex justify-end gap-1.5">
                <Button type="button" variant="outline" size="xs" onClick={onDismiss}>
                  取消
                </Button>
                <Button type="button" size="xs" onClick={onConfirm}>
                  发送
                </Button>
              </div>
            </div>
          )}
    </>
  );
}
