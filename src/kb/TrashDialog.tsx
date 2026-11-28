import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckSquare2,
  FileText,
  FolderOpen,
  MoreHorizontal,
  Search,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { TrashEntry } from "./types";
import { KbConflictError } from "./backend";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { minimalRestoreRoots, type BatchResult } from "./batch";

/**
 * 回收站(PRD 5.1.1):管理型 Dialog。
 * 列表只展示最上层可恢复条目,避免文件夹与子文档重复出现;行点击统一进入
 * 多选模式,批量恢复默认同名改名。清空/彻底删除是显式破坏性操作,均需确认。
 */

const CONFIRM_ALL = "__all__";

interface TrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listTrash: () => Promise<TrashEntry[]>;
  restoreTrash: (rel: string, strategy?: "overwrite" | "rename") => Promise<string>;
  restoreTrashMany: (rels: string[], strategy?: "overwrite" | "rename") => Promise<BatchResult>;
  purgeTrash: (rel: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  onToast: (message: string) => void;
}

const basenameOf = (path: string) => path.replace(/\.md$/i, "").split("/").pop() ?? path;
const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** 只保留回收站最上层条目;若祖先也在站内,子项随祖先一起恢复/删除。 */
function topLevelEntries(entries: TrashEntry[]): TrashEntry[] {
  const paths = new Set(entries.map((entry) => entry.path));
  return entries.filter((entry) => {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (paths.has(parts.slice(0, i).join("/"))) return false;
    }
    return true;
  });
}

export function TrashDialog({
  open,
  onOpenChange,
  listTrash,
  restoreTrash,
  restoreTrashMany,
  purgeTrash,
  emptyTrash,
  onToast,
}: TrashDialogProps) {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  const roots = useMemo(() => topLevelEntries(entries), [entries]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleEntries = useMemo(() => {
    if (!normalizedQuery) return roots;
    return roots.filter((entry) =>
      entries.some((item) => {
        const inTree = item.path === entry.path || item.path.startsWith(entry.path + "/");
        return inTree && item.path.toLocaleLowerCase().includes(normalizedQuery);
      }),
    );
  }, [entries, normalizedQuery, roots]);

  const refresh = useCallback(async () => {
    try {
      setEntries(await listTrash());
      setSelected(new Set());
      setAnchor(null);
    } catch (e) {
      console.error("[kb] 读取回收站失败:", e);
      setEntries([]);
    }
  }, [listTrash]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // 搜索时隐藏不可见条目的旧选择,避免“恢复所选”包含屏幕上看不到的内容。
  useEffect(() => {
    const visible = new Set(visibleEntries.map((entry) => entry.path));
    setSelected((prev) => {
      const next = new Set([...prev].filter((path) => visible.has(path)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleEntries]);

  // Dialog 内 Cmd/Ctrl+A;搜索框里保留系统文本全选。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.code !== "KeyA") return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      setSelected((prev) =>
        prev.size === visibleEntries.length
          ? new Set()
          : new Set(visibleEntries.map((entry) => entry.path)),
      );
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, visibleEntries]);

  const closeAllStrips = () => {
    setConflict(null);
    setConfirming(null);
  };

  const tryRestore = async (rel: string, strategy?: "overwrite" | "rename") => {
    setBusy(true);
    try {
      const finalRel = await restoreTrash(rel, strategy);
      setConflict(null);
      onToast(finalRel === rel ? `已恢复「${rel}」` : `已恢复为「${finalRel}」`);
      await refresh();
    } catch (e) {
      if (e instanceof KbConflictError) setConflict(rel);
      else console.error("[kb] 恢复失败:", e);
    } finally {
      setBusy(false);
    }
  };

  const doPurge = async (rel: string) => {
    setBusy(true);
    try {
      if (rel === CONFIRM_ALL) {
        await emptyTrash();
        onToast("回收站已清空");
      } else {
        await purgeTrash(rel);
        onToast(`已彻底删除「${rel}」`);
      }
      setConfirming(null);
      await refresh();
    } catch (e) {
      console.error("[kb] 彻底删除失败:", e);
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (
    entry: TrashEntry,
    event?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean },
  ) => {
    if (busy || conflict !== null || confirming !== null) return;

    if (event?.shiftKey && anchor) {
      const from = visibleEntries.findIndex((item) => item.path === anchor);
      const to = visibleEntries.findIndex((item) => item.path === entry.path);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        const range = visibleEntries.slice(start, end + 1).map((item) => item.path);
        setSelected((prev) => new Set([...prev, ...range]));
        return;
      }
    }

    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
    setAnchor(entry.path);
  };

  const restoreSelected = async () => {
    const rels = minimalRestoreRoots([...selected]);
    if (!rels.length) return;
    setBusy(true);
    try {
      const result = await restoreTrashMany(rels, "rename");
      onToast(
        `已恢复 ${result.ok} 条${result.failed ? `,${result.failed} 条失败` : ""};同名冲突项已使用新名称`,
      );
      if (result.errors.length) onToast(result.errors[0]);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const actionDisabled = busy || conflict !== null || confirming !== null;
  const allVisibleSelected =
    visibleEntries.length > 0 && visibleEntries.every((entry) => selected.has(entry.path));

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          closeAllStrips();
          setQuery("");
        }
        onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>回收站</DialogTitle>
          <DialogDescription>删除的文档与文件夹会保留在这里,直到你恢复或彻底删除。</DialogDescription>
        </DialogHeader>

        {conflict !== null && (
          <div className="bg-selection ring-primary/10 rounded-lg p-3 text-xs ring-1">
            <p className="font-medium">「{conflict}」原位置已存在同名条目</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void tryRestore(conflict, "overwrite")}>
                恢复并覆盖
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void tryRestore(conflict, "rename")}>
                恢复为新名称
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
                取消
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {/* 工具条:填充式搜索框(不再加一层边框)+ 安静的全选 */}
          <div className="flex items-center gap-2">
            <div className="bg-hover/60 focus-within:bg-hover flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 transition-colors focus-within:ring-1 focus-within:ring-ring/40">
              <Search className="text-muted-foreground/70 size-3.5 shrink-0" />
              <input
                value={query}
                aria-label="搜索回收站"
                placeholder="搜索名称或路径…"
                onChange={(e) => setQuery(e.target.value)}
                className="placeholder:text-muted-foreground/60 h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              />
              {query && (
                <button
                  type="button"
                  aria-label="清除搜索"
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => setQuery("")}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground shrink-0"
              disabled={actionDisabled || visibleEntries.length === 0}
              onClick={() =>
                setSelected(() =>
                  allVisibleSelected
                    ? new Set()
                    : new Set(visibleEntries.map((entry) => entry.path)),
                )
              }
            >
              {allVisibleSelected
                ? "取消全选"
                : `全选${visibleEntries.length ? ` ${visibleEntries.length} 项` : ""}`}
            </Button>
          </div>

          {/* 列表贴边铺满:发丝分隔 + 选中左色条,不再「盒子套卡片」 */}
          <div className="-mx-5 max-h-[min(24rem,52vh)] min-h-40 overflow-y-auto border-y border-border-subtle">
            {confirming === CONFIRM_ALL && (
              <div className="border-destructive/15 bg-destructive/5 border-b px-5 py-3 text-xs">
                <p className="text-destructive font-medium">
                  彻底清空回收站?共 {roots.length} 项,无法恢复。
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    取消
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void doPurge(CONFIRM_ALL)}>
                    清空
                  </Button>
                </div>
              </div>
            )}

            {entries.length === 0 ? (
              <div className="text-muted-foreground flex min-h-40 flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
                <Trash2 className="size-5 opacity-40" />
                <p className="text-xs">回收站是空的</p>
                <p className="text-[11px] opacity-70">删除的文档会在这里保留,可随时恢复。</p>
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-2 px-6 py-8 text-center">
                <p className="text-xs">没有找到「{query.trim()}」</p>
                <button
                  type="button"
                  className="text-primary text-[11px] hover:underline"
                  onClick={() => setQuery("")}
                >
                  清除搜索
                </button>
              </div>
            ) : (
              <ul className="divide-border-subtle divide-y" aria-label="回收站条目">
                {visibleEntries.map((entry) => {
                  const isSelected = selected.has(entry.path);
                  return (
                    <li key={entry.path}>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        onClick={(event) =>
                          toggleSelected(entry, {
                            shiftKey: event.shiftKey,
                            metaKey: event.metaKey,
                            ctrlKey: event.ctrlKey,
                          })
                        }
                        onDoubleClick={() => !actionDisabled && void tryRestore(entry.path)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && event.target === event.currentTarget) {
                            event.preventDefault();
                            toggleSelected(entry, event);
                          }
                        }}
                        className={cn(
                          "group relative flex h-11 cursor-pointer items-center gap-3 px-5 outline-none transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                          confirming === entry.path
                            ? "bg-destructive/5"
                            : isSelected
                              ? "bg-selection"
                              : "hover:bg-hover/70 focus-visible:bg-hover/70",
                          actionDisabled && "opacity-60",
                        )}
                      >
                        {isSelected && (
                          <span aria-hidden className="bg-primary absolute inset-y-0 left-0 w-0.5" />
                        )}
                        <button
                          type="button"
                          aria-label={isSelected ? `取消选择「${entry.path}」` : `选择「${entry.path}」`}
                          aria-pressed={isSelected}
                          className={cn(
                            "flex size-5 shrink-0 cursor-pointer items-center justify-center",
                            isSelected ? "text-primary" : "text-muted-foreground/60 hover:text-primary",
                          )}
                          disabled={actionDisabled}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSelected(entry, event);
                          }}
                        >
                          {isSelected ? (
                            <CheckSquare2 className="size-4" strokeWidth={2} />
                          ) : (
                            <Square className="size-4" strokeWidth={1.75} />
                          )}
                        </button>

                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center",
                            entry.isDir ? "text-primary" : "text-muted-foreground",
                          )}
                        >
                          {entry.isDir ? <FolderOpen className="size-4" /> : <FileText className="size-4" />}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] leading-5 font-medium">
                            {basenameOf(entry.path)}
                          </span>
                          <span className="text-muted-foreground block truncate text-[11px] leading-4">
                            {parentOf(entry.path) || "根目录"}
                          </span>
                        </span>

                        {entry.isDir && (
                          <span className="text-muted-foreground/70 shrink-0 text-[11px] tabular-nums">
                            {entry.docs} 篇
                          </span>
                        )}

                        <DropdownMenu>
                          <Hint label="条目操作">
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                aria-label={`操作「${entry.path}」`}
                                className="text-muted-foreground/50 hover:bg-hover hover:text-foreground flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <MoreHorizontal className="size-4" />
                              </button>
                            </DropdownMenuTrigger>
                          </Hint>
                          <DropdownMenuContent align="end" alignOffset={-2} className="w-36">
                            <DropdownMenuItem
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                void tryRestore(entry.path);
                              }}
                            >
                              <Undo2 /> 恢复
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={busy}
                              onClick={(event) => {
                                event.stopPropagation();
                                setConfirming(entry.path);
                              }}
                            >
                              <Trash2 /> 彻底删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {confirming === entry.path && (
                        <div className="bg-destructive/5 px-5 py-3 text-xs">
                          <p className="text-destructive">
                            彻底删除「{basenameOf(entry.path)}」?
                            {entry.isDir ? ` 其中 ${entry.docs} 篇文档也会一并删除。` : " "}
                            此操作无法撤销。
                          </p>
                          <div className="mt-2 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                              取消
                            </Button>
                            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void doPurge(entry.path)}>
                              彻底删除
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {entries.length > 0 && confirming === null && conflict === null ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={busy || conflict !== null}
              onClick={() => setConfirming(CONFIRM_ALL)}
            >
              <Trash2 className="size-3.5" />
              清空回收站
            </Button>
          ) : (
            <span />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button disabled={busy || selected.size === 0} onClick={() => void restoreSelected()}>
              <Undo2 className="size-3.5" />
              {selected.size > 0 ? `恢复 ${selected.size} 项` : "恢复所选"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
