import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 文档标签面板(PRD 6.3-2):当前文档的标签 chips(点击 = 左栏按标签筛选树,
 * × = 移除)+ 底部输入添加。标签只存 .yanzhi/meta.json,不进正文。
 * 挂在右栏最上方,与大纲/反链同款折叠头。
 */

interface TagsPanelProps {
  tags: string[];
  /** 点击标签 = 筛选目录树;null = 清除筛选 */
  onFilter: (tag: string | null) => void;
  /** 当前激活的筛选标签;再点同标签取消 */
  activeFilter: string | null;
  /** 一次一批追加(逗号/分号分隔拆好;批量单调用,避免多次追加互相覆盖) */
  onAdd: (tags: string[]) => void;
  onRemove: (tag: string) => void;
}

export function TagsPanel({ tags, onFilter, activeFilter, onAdd, onRemove }: TagsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    setDraft("");
    const parts = v
      .split(/[,;]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length) onAdd(parts);
  };

  return (
    <section className="flex shrink-0 flex-col border-b border-border">
      <header className="flex h-9 shrink-0 items-center gap-1 px-2">
        <button
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs font-medium"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          标签
        </button>
        {tags.length > 0 && (
          <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-[10px] leading-4">
            {tags.length}
          </span>
        )}
      </header>
      {!collapsed && (
        <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
          {tags.length === 0 && (
            <p className="text-muted-foreground w-full py-0.5 text-xs">无标签</p>
          )}
          {tags.map((t) => {
            const active = activeFilter === t;
            return (
              <span
                key={t}
                className={cn(
                  "inline-flex max-w-full items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] leading-4",
                  active
                    ? "border-primary/45 bg-primary/10 text-primary"
                    : "border-border text-foreground/80 hover:border-primary/35",
                )}
              >
                <button
                  className="cursor-pointer truncate"
                  title={active ? "清除筛选" : "按此标签筛选目录树"}
                  onClick={() => onFilter(active ? null : t)}
                >
                  #{t}
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                  title="移除标签"
                  onClick={() => onRemove(t)}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft("");
            }}
            placeholder="添加标签,回车确认"
            className="border-input bg-background h-6 min-w-24 flex-1 rounded px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}
    </section>
  );
}
