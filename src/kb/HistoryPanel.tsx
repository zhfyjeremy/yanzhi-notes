import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Camera, ChevronDown, ChevronRight } from "lucide-react";
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

interface HistoryItem {
  entry: HistoryEntry;
  /** 相对更旧一份快照的字数变化;最旧一份没有可比对象 */
  delta: number | null;
}

interface HistoryGroup {
  key: string;
  label: string;
  items: HistoryItem[];
}

/** 快照时间展示:同年省年份,不同年带年份(面板与对话框共用) */
export function formatSnapshotTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 右栏时间线:今天/昨天只展示时刻,更早展示日期 + 时刻 */
function formatTimelineTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const dayDelta = (startOfDay(now) - startOfDay(d)) / 86_400_000;
  if (dayDelta === 0) return time;
  if (dayDelta === 1) return `昨天 ${time}`;
  const date = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return d.getFullYear() === now.getFullYear() ? `${date} ${time}` : `${d.getFullYear()}-${date} ${time}`;
}

function groupHistory(entries: HistoryEntry[]): HistoryGroup[] {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = today - 86_400_000;
  const groups: HistoryGroup[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const d = new Date(entry.time);
    const day = startOfDay(d);
    const label =
      day === today ? "今天" : day === yesterday ? "昨天" : d.getFullYear() === now.getFullYear()
        ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    let group = groups.length ? groups[groups.length - 1] : undefined;
    if (!group || group.label !== label) {
      group = { key: `${day}-${label}`, label, items: [] };
      groups.push(group);
    }
    group.items.push({
      entry,
      delta: i + 1 < entries.length ? entry.chars - entries[i + 1].chars : null,
    });
  }
  return groups;
}

function formatDelta(delta: number | null): string | null {
  if (delta == null) return null;
  if (delta === 0) return "±0 字";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} 字`;
}

export function HistoryPanel({ docRel, version, intervalMin, listHistory, onSnapshot, onOpenEntry }: HistoryPanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const groups = useMemo(() => groupHistory(entries), [entries]);

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
    <section className="border-border-subtle flex max-h-64 shrink-0 flex-col border-t">
      <header className="flex h-10 shrink-0 items-center gap-1 px-3">
        <button
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold tracking-[0.03em]"
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
          <span className="bg-selection text-primary ring-primary/15 rounded-full px-1.5 text-[10px] leading-4 ring-1">
            {entries.length}
          </span>
        )}
        <span className="ml-auto">
          <Hint label="打快照(手动,不受间隔限制)">
            <button
              aria-label="打快照"
              className="text-muted-foreground hover:text-foreground hover:bg-hover flex size-7 cursor-pointer items-center justify-center rounded-md"
              onClick={() => void onSnapshot()}
            >
              <Camera className="size-3.5" />
            </button>
          </Hint>
        </span>
      </header>
      {!collapsed && (
        <div className="max-h-56 min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
          {entries.length === 0 ? (
            <div className="text-muted-foreground mx-1 rounded-lg border border-dashed border-border-subtle px-3 py-5 text-center">
              <Camera className="mx-auto mb-1.5 size-4 opacity-55" />
              <p className="text-xs">暂无快照</p>
              <p className="mt-1 text-[10px] leading-4">
                {intervalMin > 0
                  ? `编辑后每隔约 ${intervalMin} 分钟自动保存一份`
                  : "每次保存后自动保存一份"}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.key} aria-label={`${group.label}的历史版本`}>
                <h4 className="text-muted-foreground/65 mb-1 pl-6 text-[10px] font-semibold tracking-[0.04em]">
                  {group.label}
                </h4>
                <div className="relative ml-2 space-y-1">
                  <span
                    aria-hidden="true"
                    className="bg-border-subtle absolute top-2 bottom-2 left-[3px] w-px"
                  />
                  {group.items.map(({ entry, delta }) => (
                    <button
                      key={entry.id}
                      onClick={() => onOpenEntry(entry)}
                      title={`${formatSnapshotTime(entry.time)} 的快照,点击查看与恢复`}
                      className="group hover:bg-hover relative flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 pl-6 text-left transition-colors"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute top-1/2 left-0 size-[7px] -translate-y-1/2 rounded-full",
                          entry.auto
                            ? "bg-muted-foreground/45 ring-[3px] ring-[color-mix(in_oklab,var(--muted-foreground)_10%,transparent)]"
                            : "bg-primary ring-primary/15 ring-[3px]",
                        )}
                      />
                      <span className="text-foreground/90 min-w-0 flex-1 truncate text-xs leading-4 font-medium tabular-nums">
                        {formatTimelineTime(entry.time)}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">
                        {entry.chars} 字
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 text-[10px] leading-4 tabular-nums",
                          entry.auto ? "bg-hover text-muted-foreground" : "bg-selection text-primary",
                        )}
                      >
                        {entry.auto ? "自动" : "手动"}
                      </span>
                      {delta != null && (
                        <span
                          className={cn(
                            "shrink-0 text-[10px] tabular-nums",
                            delta > 0 ? "text-primary" : "text-muted-foreground/70",
                          )}
                        >
                          {formatDelta(delta)}
                        </span>
                      )}
                      <ArrowUpRight className="text-muted-foreground/40 group-hover:text-primary size-3.5 shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </section>
  );
}
