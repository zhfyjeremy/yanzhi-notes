import { useCallback, useEffect, useState } from "react";
import { Camera, ChevronDown, ChevronRight, History } from "lucide-react";
import type { HistoryEntry } from "./types";
import { Hint } from "@/components/hint";
import { cn } from "@/lib/utils";

/**
 * 历史快照面板(PRD 6.2-3):右栏第三分区,当前文档的快照时间倒序列表。
 * 顶栏相机 = 手动「打快照」(不受节流);点条目 → HistoryDialog 查看/对比/恢复。
 * version(useKb.historyVersion)在每次快照写入后递增,驱动重拉列表。
 */

interface HistoryPanelProps {
  docRel: string | null;
  version: number;
  intervalMin: number;
  listHistory: (rel: string) => Promise<HistoryEntry[]>;
  /** 手动打快照;返回条目供 toast,失败返回 null */
  onSnapshot: () => Promise<HistoryEntry | null>;
  onOpenEntry: (entry: HistoryEntry) => void;
}

/** 快照时间展示:同年省年份,不同年带年份(面板与对话框共用) */
export function formatSnapshotTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`;
}

export function HistoryPanel({ docRel, version, intervalMin, listHistory, onSnapshot, onOpenEntry }: HistoryPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  const refresh = useCallback(() => {
    if (!docRel) {
      setEntries([]);
      return;
    }
    void listHistory(docRel)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [docRel, listHistory]);

  useEffect(refresh, [refresh, version]);

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
          历史版本
        </button>
        {entries.length > 0 && (
          <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-[10px] leading-4">
            {entries.length}
          </span>
        )}
        <span className="ml-auto">
          <Hint label="打快照(手动,不受间隔限制)">
            <button
              aria-label="打快照"
              className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex size-6 cursor-pointer items-center justify-center rounded"
              onClick={() => void onSnapshot()}
            >
              <Camera className="size-3.5" />
            </button>
          </Hint>
        </span>
      </header>
      {!collapsed && (
        <div className="max-h-52 min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {entries.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              暂无快照{intervalMin > 0 ? `;编辑后每隔约 ${intervalMin} 分钟自动保存一份` : ";每次保存自动快照"}
            </p>
          ) : (
            entries.map((e) => (
              <button
                key={e.id}
                onClick={() => onOpenEntry(e)}
                title={`${formatSnapshotTime(e.time)} 的快照,点击查看与恢复`}
                className="hover:bg-accent/50 flex w-full cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left"
              >
                <History className="text-muted-foreground size-3.5 shrink-0" />
                <span className="text-foreground/90 min-w-0 flex-1 truncate text-xs leading-4 tabular-nums">
                  {formatSnapshotTime(e.time)}
                </span>
                <span className="text-muted-foreground shrink-0 text-[10px]">{e.chars} 字</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 text-[10px] leading-4",
                    e.auto ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground",
                  )}
                >
                  {e.auto ? "自动" : "手动"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
