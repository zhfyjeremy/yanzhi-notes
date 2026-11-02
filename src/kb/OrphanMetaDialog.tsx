import { useEffect, useMemo, useState } from "react";
import {
  CheckSquare2,
  FileText,
  FolderOpen,
  Link2,
  Search,
  Square,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import type { TreeNode } from "./types";
import type { OrphanMetaEntry } from "./meta";
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
import { cn } from "@/lib/utils";

/**
 * 未识别条目整理(PRD 5.2.1):外部改名/移动/删除后失联的 meta 列表,
 * 逐条「认领合并」到库内真实路径(同类型,偏好转移)或「丢弃」。
 * 认领候选按 basename 同名优先排序。
 */

interface OrphanMetaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: OrphanMetaEntry[];
  tree: TreeNode[];
  onClaim: (entry: OrphanMetaEntry, targetRel: string) => void;
  onClaimBatch: (pairs: { entry: OrphanMetaEntry; targetRel: string }[]) => void;
  onDiscard: (entry: OrphanMetaEntry) => void;
  onDiscardBatch: (entries: OrphanMetaEntry[]) => void;
}

interface Candidate {
  path: string;
  name: string;
  sameBasename: boolean;
}

function basenameOf(p: string): string {
  const stem = p.split("/").pop() ?? p;
  return stem.replace(/\.md$/i, "");
}

function parentOf(p: string): string {
  return p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
}

/** 树 → 同类型候选平铺(文档或文件夹) */
function candidatesOf(tree: TreeNode[], isDir: boolean, basename: string): Candidate[] {
  const out: Candidate[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.isDir === isDir && (isDir || n.path.endsWith(".md"))) {
        out.push({ path: n.path, name: n.name, sameBasename: n.name === basename });
      }
      if (n.isDir) walk(n.children);
    }
  };
  walk(tree);
  return out.sort((a, b) => Number(b.sameBasename) - Number(a.sameBasename) || a.path.localeCompare(b.path));
}

const MAX_LIST = 50;

function metaChips(e: OrphanMetaEntry): string[] {
  const parts: string[] = [];
  if (e.meta.sortIndex != null) parts.push(`排序 ${e.meta.sortIndex}`);
  if (e.isDir && (e.meta as { collapsed?: boolean }).collapsed) parts.push("曾折叠");
  if (!e.isDir && (e.meta as { pinned?: boolean }).pinned) parts.push("置顶");
  return parts;
}

export function OrphanMetaDialog({
  open,
  onOpenChange,
  entries,
  tree,
  onClaim,
  onClaimBatch,
  onDiscard,
  onDiscardBatch,
}: OrphanMetaDialogProps) {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) {
      setClaiming(null);
      setDiscarding(null);
      setFilter("");
      setSelected(new Set());
      setConfirmDiscard(false);
      setNotice("");
    }
  }, [open]);

  useEffect(() => {
    const live = new Set(entries.map((e) => e.path));
    setSelected((prev) => {
      const next = new Set([...prev].filter((p) => live.has(p)));
      return next.size === prev.size ? prev : next;
    });
    if (claiming && !live.has(claiming)) {
      setClaiming(null);
      setFilter("");
    }
    if (discarding && !live.has(discarding)) setDiscarding(null);
  }, [entries, claiming, discarding]);

  const entry = entries.find((e) => e.path === claiming) ?? null;
  const candidates = useMemo(() => {
    if (!entry) return [];
    const q = filter.trim().toLowerCase();
    const all = candidatesOf(tree, entry.isDir, basenameOf(entry.path));
    return q ? all.filter((c) => c.path.toLowerCase().includes(q)) : all;
  }, [entry, tree, filter]);

  const startClaim = (e: OrphanMetaEntry) => {
    setDiscarding(null);
    setConfirmDiscard(false);
    setClaiming(e.path);
    setFilter("");
  };

  const toggleSelected = (path: string) => {
    setConfirmDiscard(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const allSelected = entries.length > 0 && entries.every((e) => selected.has(e.path));

  const claimSameName = () => {
    const used = new Set<string>();
    const pairs: { entry: OrphanMetaEntry; targetRel: string }[] = [];
    for (const e of entries.filter((item) => selected.has(item.path))) {
      const target = candidatesOf(tree, e.isDir, basenameOf(e.path)).find(
        (candidate) => candidate.sameBasename && !used.has(candidate.path),
      );
      if (!target) continue;
      used.add(target.path);
      pairs.push({ entry: e, targetRel: target.path });
    }
    if (!pairs.length) {
      setNotice("所选条目没有可用的同名目标");
      return;
    }
    onClaimBatch(pairs);
    setSelected(new Set());
    setNotice(`已批量认领 ${pairs.length} 条${pairs.length < selected.size ? ",其余未匹配" : ""}`);
  };

  const selectedEntries = entries.filter((e) => selected.has(e.path));
  const actionLocked = claiming !== null || discarding !== null || confirmDiscard;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setClaiming(null);
          setDiscarding(null);
          setFilter("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>未识别条目</DialogTitle>
          <DialogDescription>
            {entries.length === 0
              ? "没有需要整理的偏好记录。"
              : `${entries.length} 条偏好记录已与磁盘脱节 · 认领到现有路径,或丢弃`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {entries.length > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={actionLocked}
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.path)))
                }
              >
                {allSelected ? "取消全选" : "全选"}
              </Button>
              {selected.size > 0 && (
                <div className="bg-selection ring-primary/10 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ring-1">
                  <span className="text-primary mr-auto shrink-0 font-medium">已选 {selected.size}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    disabled={actionLocked}
                    onClick={claimSameName}
                  >
                    <Link2 className="size-3.5" />
                    认领同名
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive h-7 px-2"
                    disabled={actionLocked}
                    onClick={() => setConfirmDiscard(true)}
                  >
                    <Trash2 className="size-3.5" />
                    丢弃
                  </Button>
                </div>
              )}
            </div>
          )}

          {confirmDiscard && (
            <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-3 text-xs">
              <p className="text-destructive font-medium">
                丢弃所选 {selected.size} 条偏好记录?不会改动任何文件。
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    onDiscardBatch(selectedEntries);
                    setSelected(new Set());
                    setConfirmDiscard(false);
                    setNotice(`已丢弃 ${selectedEntries.length} 条偏好记录`);
                  }}
                >
                  确认丢弃
                </Button>
              </div>
            </div>
          )}

          {notice && (
            <p className="text-muted-foreground rounded-md bg-hover px-2.5 py-1.5 text-[11px]">{notice}</p>
          )}

          <div className="border-border-subtle bg-sidebar max-h-[min(24rem,52vh)] min-h-40 overflow-y-auto rounded-lg border p-2">
            {entries.length === 0 ? (
              <div className="text-muted-foreground flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle p-4 text-center">
                <Unlink className="mb-1.5 size-4 opacity-55" />
                <p className="text-xs">没有未识别条目了</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {entries.map((e) => {
                  const isClaiming = claiming === e.path;
                  const isDiscarding = discarding === e.path;
                  const isSelected = selected.has(e.path);
                  const chips = metaChips(e);
                  const parent = parentOf(e.path);

                  return (
                    <li key={e.path}>
                      <div
                        className={cn(
                          "group border-border-subtle bg-raised/55 hover:border-primary/25 flex items-center gap-2.5 rounded-lg border p-2 transition-colors",
                          isSelected && "bg-selection border-primary/25 ring-primary/10 ring-1",
                          (isClaiming || isDiscarding) && "border-primary/30",
                          isDiscarding && "border-destructive/35 bg-destructive/5",
                          actionLocked && !isClaiming && !isDiscarding && "opacity-65",
                        )}
                      >
                        <button
                          type="button"
                          aria-label={isSelected ? `取消选择「${e.path}」` : `选择「${e.path}」`}
                          aria-pressed={isSelected}
                          className="text-muted-foreground hover:text-primary flex size-5 shrink-0 cursor-pointer items-center justify-center"
                          disabled={actionLocked}
                          onClick={() => toggleSelected(e.path)}
                        >
                          {isSelected ? (
                            <CheckSquare2 className="text-primary size-4" />
                          ) : (
                            <Square className="size-4" />
                          )}
                        </button>

                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-md",
                            e.isDir ? "bg-selection text-primary" : "bg-hover text-muted-foreground",
                          )}
                        >
                          {e.isDir ? <FolderOpen className="size-4" /> : <FileText className="size-4" />}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium" title={e.path}>
                            {basenameOf(e.path)}
                          </span>
                          <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 truncate text-[10px]">
                            <span className="truncate">{parent || "根目录"}</span>
                            {chips.map((chip) => (
                              <span
                                key={chip}
                                className="bg-hover text-muted-foreground shrink-0 rounded px-1 py-px"
                              >
                                {chip}
                              </span>
                            ))}
                          </span>
                        </span>

                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={actionLocked}
                          onClick={() => startClaim(e)}
                        >
                          <Link2 className="size-3.5" />
                          认领
                        </Button>
                        <Hint label="丢弃该条偏好">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground/60 group-hover:text-muted-foreground hover:text-destructive size-7"
                            disabled={actionLocked}
                            onClick={() => {
                              setClaiming(null);
                              setFilter("");
                              setDiscarding(e.path);
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </Hint>
                      </div>

                      {isClaiming && entry && (
                        <div className="border-border-subtle bg-raised mt-1 space-y-2 rounded-lg border p-2.5">
                          <p className="text-muted-foreground text-[11px]">
                            把偏好合并到库内{entry.isDir ? "文件夹" : "文档"}
                          </p>
                          <div className="border-border-subtle bg-sidebar focus-within:border-ring flex h-8 items-center gap-2 rounded-md border px-2">
                            <Search className="text-muted-foreground size-3.5 shrink-0" />
                            <input
                              autoFocus
                              className="placeholder:text-muted-foreground/60 h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
                              placeholder={entry.isDir ? "筛选文件夹…" : "筛选文档…"}
                              value={filter}
                              onChange={(ev) => setFilter(ev.target.value)}
                            />
                            {filter && (
                              <button
                                type="button"
                                aria-label="清除筛选"
                                className="text-muted-foreground hover:text-foreground cursor-pointer"
                                onClick={() => setFilter("")}
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </div>
                          <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                            {candidates.slice(0, MAX_LIST).map((c) => (
                              <li key={c.path}>
                                <button
                                  type="button"
                                  className="hover:bg-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left"
                                  onClick={() => {
                                    onClaim(entry, c.path);
                                    setClaiming(null);
                                    setFilter("");
                                  }}
                                >
                                  <span
                                    className={cn(
                                      "flex size-6 shrink-0 items-center justify-center rounded-md",
                                      entry.isDir
                                        ? "bg-selection text-primary"
                                        : "bg-hover text-muted-foreground",
                                    )}
                                  >
                                    {entry.isDir ? (
                                      <FolderOpen className="size-3.5" />
                                    ) : (
                                      <FileText className="size-3.5" />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium">{c.name}</span>
                                    <span className="text-muted-foreground block truncate text-[10px]">
                                      {parentOf(c.path) || "根目录"}
                                    </span>
                                  </span>
                                  {c.sameBasename && (
                                    <span className="bg-primary/10 text-primary shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
                                      同名
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                            {candidates.length === 0 && (
                              <li className="text-muted-foreground px-2 py-4 text-center text-xs">
                                没有匹配的{entry.isDir ? "文件夹" : "文档"}
                              </li>
                            )}
                          </ul>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setClaiming(null);
                                setFilter("");
                              }}
                            >
                              取消
                            </Button>
                          </div>
                        </div>
                      )}

                      {isDiscarding && (
                        <div className="border-destructive/30 bg-destructive/5 mt-1 rounded-lg border p-3 text-xs">
                          <p className="text-destructive font-medium">
                            丢弃「{basenameOf(e.path)}」的偏好记录?仅清除排序等偏好,不影响任何文件。
                          </p>
                          <div className="mt-2 flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setDiscarding(null)}>
                              取消
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                onDiscard(e);
                                setDiscarding(null);
                              }}
                            >
                              丢弃
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
