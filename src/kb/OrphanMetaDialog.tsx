import { useEffect, useMemo, useState } from "react";
import { CheckSquare2, FileText, FolderOpen, Square, Trash2 } from "lucide-react";
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
 * 认领选择器默认按失联条目的 basename 过滤 —— 外部改名的同文件就在最上面。
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
  // 同名优先(外部改名的最可能目标),其余按路径
  return out.sort((a, b) => Number(b.sameBasename) - Number(a.sameBasename) || a.path.localeCompare(b.path));
}

const MAX_LIST = 50;

function metaSummary(e: OrphanMetaEntry): string {
  const parts: string[] = [];
  if (e.meta.sortIndex != null) parts.push(`排序 ${e.meta.sortIndex}`);
  if (e.isDir && (e.meta as { collapsed?: boolean }).collapsed) parts.push("曾折叠");
  if (!e.isDir && (e.meta as { pinned?: boolean }).pinned) parts.push("置顶");
  return parts.join(" · ");
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
  // claiming = 正在选择认领目标的失联路径;discarding = 待确认丢弃的失联路径
  const [claiming, setClaiming] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const live = new Set(entries.map((e) => e.path));
    setSelected((prev) => new Set([...prev].filter((p) => live.has(p))));
  }, [entries]);

  const entry = entries.find((e) => e.path === claiming) ?? null;
  const candidates = useMemo(() => {
    if (!entry) return [];
    const q = filter.trim().toLowerCase();
    const all = candidatesOf(tree, entry.isDir, basenameOf(entry.path));
    return q ? all.filter((c) => c.path.toLowerCase().includes(q)) : all;
  }, [entry, tree, filter]);

  const startClaim = (e: OrphanMetaEntry) => {
    setDiscarding(null);
    setClaiming(e.path);
    // 默认过滤 = 失联 basename:外部改名场景新名字未必相同,但同名优先排序已照顾;
    // 清空过滤展示全部,避免改名后搜不到
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

  const claimSameName = () => {
    const used = new Set<string>();
    const pairs: { entry: OrphanMetaEntry; targetRel: string }[] = [];
    for (const e of entries.filter((entry) => selected.has(entry.path))) {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setClaiming(null);
          setDiscarding(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>未识别条目</DialogTitle>
          <DialogDescription>
            这些条目在库中已不存在(可能被外部改名/移动/删除),但砚知仍保留着它们的排序等偏好。认领可把偏好转移到新位置,或直接丢弃。
          </DialogDescription>
        </DialogHeader>

        {selected.size > 0 && (
          <div className="bg-selection ring-primary/10 flex flex-wrap items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ring-1">
            <span className="text-primary mr-auto font-medium">已选 {selected.size} 条</span>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={claimSameName}>
              认领同名
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive h-6 px-2 text-[11px]"
              onClick={() => setConfirmDiscard(true)}
            >
              丢弃所选
            </Button>
          </div>
        )}

        {confirmDiscard && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
            <span className="text-destructive min-w-0 flex-1">
              丢弃所选 {selected.size} 条偏好记录?不会影响任何文件。
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="h-6 px-2 text-xs"
              onClick={() => {
                onDiscardBatch(selectedEntries);
                setSelected(new Set());
                setConfirmDiscard(false);
                setNotice(`已丢弃 ${selectedEntries.length} 条偏好记录`);
              }}
            >
              确认丢弃
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmDiscard(false)}>
              取消
            </Button>
          </div>
        )}

        {notice && <p className="text-muted-foreground text-[11px]">{notice}</p>}

        <div className="max-h-80 min-h-16 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-xs">
              没有未识别条目了
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {entries.map((e) => {
                const isClaiming = claiming === e.path;
                return (
                  <li
                    key={e.path}
                    className={cn(
                      "hover:bg-hover flex flex-col rounded-md px-2 py-1.5",
                      isClaiming && "bg-hover",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={selected.has(e.path) ? `取消选择「${e.path}」` : `选择「${e.path}」`}
                        aria-pressed={selected.has(e.path)}
                        className="text-muted-foreground hover:text-primary flex size-4 shrink-0 cursor-pointer items-center justify-center"
                        onClick={() => toggleSelected(e.path)}
                      >
                        {selected.has(e.path) ? (
                          <CheckSquare2 className="text-primary size-4" />
                        ) : (
                          <Square className="size-4" />
                        )}
                      </button>
                      {e.isDir ? (
                        <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                      ) : (
                        <FileText className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">{e.path}</span>
                        {metaSummary(e) && (
                          <span className="text-muted-foreground block text-[10px]">
                            {metaSummary(e)}
                          </span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        disabled={claiming !== null || discarding !== null}
                        onClick={() => startClaim(e)}
                      >
                        认领
                      </Button>
                      <Hint label="丢弃该条 meta">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive size-7"
                          disabled={claiming !== null || discarding !== null}
                          onClick={() => {
                            setClaiming(null);
                            setDiscarding(e.path);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Hint>
                    </div>

                    {isClaiming && entry && (
                      <div className="border-border-subtle mt-1.5 rounded-md border p-1.5">
                        <input
                          autoFocus
                          className="placeholder:text-muted-foreground/70 h-6 w-full rounded bg-transparent px-1 text-xs outline-none"
                          placeholder={entry.isDir ? "筛选文件夹…" : "筛选文档…"}
                          value={filter}
                          onChange={(ev) => setFilter(ev.target.value)}
                        />
                        <ul className="mt-1 max-h-36 overflow-y-auto">
                          {candidates.slice(0, MAX_LIST).map((c) => (
                            <li key={c.path}>
                              <button
                                className="hover:bg-hover flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-left"
                                onClick={() => {
                                  onClaim(entry, c.path);
                                  setClaiming(null);
                                  setFilter("");
                                }}
                              >
                                {entry.isDir ? (
                                  <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
                                ) : (
                                  <FileText className="text-muted-foreground size-3.5 shrink-0" />
                                )}
                                <span className="min-w-0 flex-1 truncate text-xs">{c.path}</span>
                                {c.sameBasename && (
                                  <span className="bg-primary/10 text-primary shrink-0 rounded px-1 text-[10px]">
                                    同名
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                          {candidates.length === 0 && (
                            <li className="text-muted-foreground px-2 py-2 text-center text-xs">
                              没有匹配的{entry.isDir ? "文件夹" : "文档"}
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {discarding === e.path && (
                      <div className="mt-1.5 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                        <span className="text-destructive min-w-0 flex-1">
                          丢弃「{e.path}」的偏好记录?仅丢排序偏好,不影响任何文件。
                        </span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            onDiscard(e);
                            setDiscarding(null);
                          }}
                        >
                          丢弃
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setDiscarding(null)}>
                          取消
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
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

function basenameOf(p: string): string {
  const stem = p.split("/").pop() ?? p;
  return stem.replace(/\.md$/i, "");
}
