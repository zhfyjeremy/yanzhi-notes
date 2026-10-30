import { useCallback, useEffect, useState } from "react";
import { FileText, FolderOpen, Trash2, Undo2 } from "lucide-react";
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

/**
 * 回收站(PRD 5.1.1,语雀式):列表 + 单条恢复 / 单条彻底删除 / 清空。
 * 破坏性操作(彻底删除/清空)走顶部确认条 —— 与恢复冲突三选一同款交互;
 * 批量恢复仍是 V3。删除进站后永久保留,直至恢复或手动彻底删除。
 */

const CONFIRM_ALL = "__all__";

interface TrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listTrash: () => Promise<TrashEntry[]>;
  restoreTrash: (rel: string, strategy?: "overwrite" | "rename") => Promise<string>;
  purgeTrash: (rel: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  onToast: (message: string) => void;
}

export function TrashDialog({
  open,
  onOpenChange,
  listTrash,
  restoreTrash,
  purgeTrash,
  emptyTrash,
  onToast,
}: TrashDialogProps) {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null); // 待三选一的原路径
  const [confirming, setConfirming] = useState<string | null>(null); // 待确认彻底删除的路径 / CONFIRM_ALL

  const refresh = useCallback(async () => {
    try {
      setEntries(await listTrash());
    } catch (e) {
      console.error("[kb] 读取回收站失败:", e);
      setEntries([]);
    }
  }, [listTrash]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

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

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) closeAllStrips();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>回收站</DialogTitle>
          <DialogDescription>
            删除的文档与文件夹保留在 `.yanzhi/trash/`,可恢复到原位置,或彻底删除。
          </DialogDescription>
        </DialogHeader>

        {conflict !== null && (
          <div className="bg-accent/50 rounded-md p-3 text-xs">
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

        {confirming !== null && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <p className="text-destructive font-medium">
              {confirming === CONFIRM_ALL
                ? `彻底清空回收站?共 ${entries.length} 条,`
                : `彻底删除「${confirming}」?`}
              不可恢复。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void doPurge(confirming)}>
                {confirming === CONFIRM_ALL ? "清空" : "彻底删除"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                取消
              </Button>
            </div>
          </div>
        )}

        <div className="max-h-72 min-h-16 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-xs">回收站是空的</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {entries.map((e) => (
                <li
                  key={e.path}
                  className={
                    "hover:bg-accent/50 flex items-center gap-2 rounded-md px-2 py-1.5 " +
                    (confirming === e.path ? "bg-destructive/5" : "")
                  }
                >
                  {e.isDir ? (
                    <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                  ) : (
                    <FileText className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">{e.path}</span>
                    {e.isDir && (
                      <span className="text-muted-foreground block text-[10px]">含 {e.docs} 篇文档</span>
                    )}
                  </span>
                  <Hint label="恢复到原位置">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground size-7"
                      disabled={busy || conflict !== null || confirming !== null}
                      onClick={() => void tryRestore(e.path)}
                    >
                      <Undo2 className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint label="彻底删除">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive size-7"
                      disabled={busy || conflict !== null || confirming !== null}
                      onClick={() => setConfirming(e.path)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </Hint>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          {entries.length > 0 && confirming === null && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive sm:mr-auto"
              disabled={busy || conflict !== null}
              onClick={() => setConfirming(CONFIRM_ALL)}
            >
              <Trash2 className="size-3.5" />
              清空回收站
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
