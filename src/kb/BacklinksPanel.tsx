import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { BacklinkRow } from "./backlinks";
import { cn } from "@/lib/utils";

/**
 * 反向链接面板(PRD §5.4-2 基础版):列出引用当前文档的来源;
 * 裸名/路径/别名写法已归一按目标聚合,同源多次引用计次数;
 * 来源在回收站 → 灰态「已删除」,点击引导去回收站(5.1.1-3)。
 * 挂在右栏大纲下方,与大纲同款折叠头。
 */

interface BacklinksPanelProps {
  rows: BacklinkRow[];
  /** 打开来源文档并高亮其内的引用写法 */
  onOpenSource: (rel: string) => void;
  onOpenTrash: () => void;
}

const rowName = (p: string) => p.replace(/\.md$/i, "").split("/").pop()!;
const rowParent = (p: string) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

export function BacklinksPanel({ rows, onOpenSource, onOpenTrash }: BacklinksPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="flex max-h-64 shrink-0 flex-col border-t border-border">
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
          反向链接
        </button>
        {rows.length > 0 && (
          <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-[10px] leading-4">
            {rows.length}
          </span>
        )}
      </header>
      {!collapsed && (
        <div className="max-h-52 min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">暂无文档引用本文档</p>
          ) : (
            rows.map((r) => (
              <button
                key={r.source}
                onClick={() => (r.deleted ? onOpenTrash() : onOpenSource(r.source))}
                className={cn(
                  "hover:bg-accent/50 flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left",
                  r.deleted ? "opacity-55" : "text-foreground/90",
                )}
                title={r.deleted ? `「${r.source}」已移入回收站` : r.source}
              >
                <FileText className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs leading-4">{rowName(r.source)}</span>
                  {rowParent(r.source) && (
                    <span className="text-muted-foreground block truncate text-[10px] leading-3">
                      {rowParent(r.source)}
                    </span>
                  )}
                </span>
                {r.deleted ? (
                  <span className="text-muted-foreground shrink-0 text-[10px]">已删除</span>
                ) : r.count > 1 ? (
                  <span className="text-muted-foreground shrink-0 text-[10px]">×{r.count}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
