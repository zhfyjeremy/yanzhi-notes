import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LoadingDots } from "./LoadingDots";
import type { TitleAiState } from "./useTitleAiSession";

interface TitleAiControlProps {
  state: TitleAiState;
  ready: boolean;
  currentTitle: string;
  stale: boolean;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
  onStart: () => void;
  onNeedSettings: () => void;
  onApply: (title: string) => void;
  onCancel: () => void;
  onDismiss: () => void;
}

export function TitleAiControl({
  state,
  ready,
  currentTitle,
  stale,
  popoverOpen,
  onPopoverOpenChange,
  onStart,
  onNeedSettings,
  onApply,
  onCancel,
  onDismiss,
}: TitleAiControlProps) {
  const running = state.phase === "running";
  const hasPanel = state.phase === "running" || state.phase === "result" || state.phase === "error";

  return (
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
              if (state.phase === "idle") onStart();
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
      {hasPanel && (
        <PopoverContent
          align="end"
          className={
            state.phase === "running"
              ? "yz-ai-running-chip w-auto gap-2 rounded-full px-2.5 py-1.5 text-xs"
              : "w-80 gap-2 text-xs"
          }
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {state.phase === "running" && (
            <div
              className="flex items-center gap-2"
              role="status"
              aria-live="polite"
              aria-label="正在生成标题"
            >
              <span className="bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-full">
                <Sparkles className="yz-ai-spark size-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-foreground flex items-center gap-1.5 font-medium leading-none">
                  正在生成标题
                  <LoadingDots />
                </p>
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
      )}
    </Popover>
  );
}
