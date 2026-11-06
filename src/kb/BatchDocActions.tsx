import { useMemo, useState } from "react";
import { ArrowRightLeft, Hash, ListFilter, MoreHorizontal, PenLine, Trash2, X } from "lucide-react";
import type { TreeNode } from "./types";
import {
  foldersOf,
  parseBatchTags,
  planBatchRename,
  type BatchRenameItem,
  type BatchResult,
} from "./batch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type Mode = "move" | "tags" | "rename" | "trash";

interface BatchDocActionsProps {
  selected: string[];
  tree: TreeNode[];
  allTags: string[];
  onClear: () => void;
  onSelectAll: () => void;
  allSelected: boolean;
  onMove: (rels: string[], destFolder: string) => Promise<BatchResult>;
  onSetTags: (rels: string[], add: string[], remove: string[]) => Promise<BatchResult>;
  onRename: (items: BatchRenameItem[]) => Promise<BatchResult>;
  onTrash: (rels: string[]) => Promise<BatchResult>;
  onToast: (message: string) => void;
}

export function BatchDocActions({
  selected,
  tree,
  allTags,
  onClear,
  onSelectAll,
  allSelected,
  onMove,
  onSetTags,
  onRename,
  onTrash,
  onToast,
}: BatchDocActionsProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState("");
  const [tagOp, setTagOp] = useState<"add" | "remove">("add");
  const [tags, setTags] = useState("");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");

  const folders = useMemo(() => foldersOf(tree), [tree]);
  const renamePlan = useMemo(
    () => planBatchRename(selected, tree, { find, replace, prefix, suffix }),
    [selected, tree, find, replace, prefix, suffix],
  );

  const finish = (result: BatchResult, verb: string) => {
    const detail = result.failed ? `,${result.failed} 篇失败` : "";
    onToast(`${verb} ${result.ok} 篇${detail}${result.errors.length ? `;${result.errors[0]}` : ""}`);
    // 批量操作可能部分成功;先退出选择态,避免旧路径再次提交造成重复失败。
    setMode(null);
    onClear();
  };

  const runMove = async () => {
    setBusy(true);
    try {
      finish(await onMove(selected, dest), "已移动");
    } finally {
      setBusy(false);
    }
  };

  const runTags = async () => {
    const parsed = parseBatchTags(tags);
    if (!parsed.length) {
      onToast("请输入至少一个标签");
      return;
    }
    setBusy(true);
    try {
      finish(
        await onSetTags(selected, tagOp === "add" ? parsed : [], tagOp === "remove" ? parsed : []),
        tagOp === "add" ? "已添加标签到" : "已从",
      );
    } finally {
      setBusy(false);
    }
  };

  const runRename = async () => {
    if (renamePlan.errors.length) return;
    setBusy(true);
    try {
      finish(await onRename(renamePlan.items), "已重命名");
    } finally {
      setBusy(false);
    }
  };

  const runTrash = async () => {
    setBusy(true);
    try {
      finish(await onTrash(selected), "已移入回收站");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex h-9 min-w-0 items-center gap-1 px-0.5 text-xs">
        <Hint label="退出选择模式">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="退出批量选择"
            className="text-muted-foreground hover:text-foreground size-7 shrink-0"
            onClick={onClear}
          >
            <X className="size-3.5" />
          </Button>
        </Hint>
        <span className="text-foreground min-w-0 flex-1 truncate font-medium tabular-nums">
          已选 <span className="text-primary">{selected.length}</span> 篇
        </span>
        <DropdownMenu>
          <Hint label="批量操作">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="批量操作"
                className="text-muted-foreground hover:text-foreground hover:bg-hover flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end" alignOffset={-2} className="w-40">
            <DropdownMenuItem disabled={!selected.length} onClick={() => setMode("move")}>
              <ArrowRightLeft /> 移动到…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selected.length} onClick={() => setMode("tags")}>
              <Hash /> 管理标签…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!selected.length} onClick={() => setMode("rename")}>
              <PenLine /> 批量重命名…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={!selected.length}
              onClick={() => setMode("trash")}
            >
              <Trash2 /> 移入回收站…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSelectAll}>
              {allSelected ? "取消全选" : "选择全部"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={mode !== null} onOpenChange={(open) => !busy && !open && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "move"
                ? "批量移动"
                : mode === "tags"
                  ? "批量标签"
                  : mode === "trash"
                    ? "移入回收站"
                    : "批量重命名"}
            </DialogTitle>
            <DialogDescription>
              {mode === "trash"
                ? `将 ${selected.length} 篇文档移入回收站,之后可在回收站恢复。`
                : `${selected.length} 篇文档。双链路径引用会随移动或改名同步更新。`}
            </DialogDescription>
          </DialogHeader>

          {mode === "move" && (
            <label className="space-y-1.5 text-xs">
              <span className="text-muted-foreground">目标文件夹</span>
              <select
                className="border-border-subtle bg-raised h-9 w-full rounded-md border px-2 outline-none"
                value={dest}
                onChange={(e) => setDest(e.target.value)}
              >
                {folders.map((f) => (
                  <option key={f.path || "__root"} value={f.path}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {mode === "tags" && (
            <div className="space-y-3 text-xs">
              <div className="bg-muted/60 flex rounded-lg p-1">
                {(["add", "remove"] as const).map((op) => (
                  <button
                    key={op}
                    className={cn(
                      "flex-1 cursor-pointer rounded-md px-2 py-1.5",
                      tagOp === op ? "bg-raised shadow-sm" : "text-muted-foreground",
                    )}
                    onClick={() => setTagOp(op)}
                  >
                    {op === "add" ? "添加标签" : "移除标签"}
                  </button>
                ))}
              </div>
              <label className="block space-y-1.5">
                <span className="text-muted-foreground">标签(逗号分隔)</span>
                <input
                  autoFocus
                  list="yz-batch-tags"
                  className="border-border-subtle bg-raised h-9 w-full rounded-md border px-2 outline-none"
                  placeholder="项目, 待读"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
                <datalist id="yz-batch-tags">
                  {allTags.map((tag) => <option key={tag} value={tag} />)}
                </datalist>
              </label>
            </div>
          )}

          {mode === "rename" && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-muted-foreground">查找</span>
                  <input
                    className="border-border-subtle bg-raised h-8 w-full rounded-md border px-2 outline-none"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    placeholder="可选"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">替换</span>
                  <input
                    className="border-border-subtle bg-raised h-8 w-full rounded-md border px-2 outline-none"
                    value={replace}
                    onChange={(e) => setReplace(e.target.value)}
                    placeholder="可选"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">前缀</span>
                  <input
                    className="border-border-subtle bg-raised h-8 w-full rounded-md border px-2 outline-none"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="可选"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-muted-foreground">后缀</span>
                  <input
                    className="border-border-subtle bg-raised h-8 w-full rounded-md border px-2 outline-none"
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="可选"
                  />
                </label>
              </div>
              <div className="border-border-subtle rounded-md border">
                <div className="text-muted-foreground border-border-subtle flex items-center gap-1 border-b px-2 py-1">
                  <ListFilter className="size-3" /> 预览
                </div>
                <div className="max-h-32 overflow-y-auto p-1">
                  {renamePlan.items.slice(0, 12).map((item) => (
                    <div key={item.rel} className="flex items-center gap-1 rounded px-1.5 py-0.5">
                      <span className="min-w-0 flex-1 truncate">{item.rel}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{item.newRel}</span>
                    </div>
                  ))}
                </div>
              </div>
              {renamePlan.errors.length > 0 && (
                <p className="text-destructive">{renamePlan.errors.join(";")}</p>
              )}
              <p className="text-muted-foreground">留空所有字段时不会改变文件名。</p>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" disabled={busy} onClick={() => setMode(null)}>
              取消
            </Button>
            <Button
              variant={mode === "trash" ? "destructive" : "default"}
              disabled={
                busy ||
                (mode === "rename" && (renamePlan.errors.length > 0 || renamePlan.items.every((i) => i.rel === i.newRel)))
              }
              onClick={() => {
                if (mode === "move") void runMove();
                else if (mode === "tags") void runTags();
                else if (mode === "trash") void runTrash();
                else void runRename();
              }}
            >
              {busy ? "处理中…" : mode === "trash" ? "移入回收站" : "应用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
