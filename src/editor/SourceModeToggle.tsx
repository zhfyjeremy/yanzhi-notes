import { FileCode2 } from "lucide-react";
import { Hint } from "@/components/hint";
import { cn } from "@/lib/utils";

/** 排版 / Markdown 源码切换。放在状态栏、面包屑,不进格式工具栏。 */
export function SourceModeToggle({
  active,
  onToggle,
  className,
}: {
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <Hint label={active ? "返回排版视图 (⌘/Ctrl+/)" : "源码模式 (⌘/Ctrl+/)"}>
      <button
        type="button"
        aria-pressed={active}
        className={cn(
          "hover:text-foreground hover:bg-hover flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px]",
          active ? "text-primary" : "text-muted-foreground",
          className,
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
      >
        <FileCode2 className="size-3.5" />
        源码
      </button>
    </Hint>
  );
}
