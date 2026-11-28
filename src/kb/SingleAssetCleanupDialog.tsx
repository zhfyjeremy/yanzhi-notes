import { useEffect, useState } from "react";
import { HardDrive, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SingleAssetCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 资源目录名,如「笔记.assets」 */
  folderName: string;
  /** 扫描:返回目录内全部文件 + 其中未被正文引用的 */
  listUnused: () => Promise<{ files: string[]; unused: string[] }>;
  remove: (names: string[]) => Promise<number>;
}

/**
 * 单文件「清理未引用图片」(docs/single-file-mode.md):与知识库的清理工具同形。
 * 只列不自动删 —— 正文里删图不等于要删文件,撤回必须永远完整;这里删是用户明确点的。
 */
export function SingleAssetCleanupDialog({
  open,
  onOpenChange,
  folderName,
  listUnused,
  remove,
}: SingleAssetCleanupDialogProps) {
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const [unused, setUnused] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);

  const scan = async () => {
    setScanning(true);
    setNotice("");
    try {
      const result = await listUnused();
      setTotal(result.files.length);
      setUnused(result.unused);
      setConfirming(false);
    } catch (e) {
      setTotal(0);
      setUnused([]);
      setNotice(`扫描失败:${String(e)}`);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (open) void scan();
    else {
      setTotal(0);
      setUnused([]);
      setNotice("");
      setConfirming(false);
    }
    // 只在打开时重新扫描
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doRemove = async () => {
    if (!unused.length) return;
    setBusy(true);
    try {
      const removed = await remove(unused);
      await scan();
      setNotice(`已清理 ${removed} 个未引用文件`);
    } catch (e) {
      setNotice(`清理失败:${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>清理未引用图片</DialogTitle>
          <DialogDescription>
            「{folderName}」里没有被这篇正文引用的图片和附件。删除后无法恢复,正文不受影响。
          </DialogDescription>
        </DialogHeader>

        <div className="border-border-subtle rounded-lg border">
          <div className="bg-hover flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-xs">
            {scanning ? <LoaderCircle className="size-4 animate-spin" /> : <HardDrive className="size-4" />}
            <span>{scanning ? "正在扫描…" : `文件 ${total} 个,未引用 ${unused.length} 个`}</span>
          </div>
          <div className="max-h-48 overflow-y-auto p-1.5">
            {unused.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                {scanning ? "请稍候" : "没有可清理的文件"}
              </p>
            ) : (
              unused.map((name) => (
                <div key={name} className="text-muted-foreground truncate rounded px-2 py-1 text-xs" title={name}>
                  {name}
                </div>
              ))
            )}
          </div>
        </div>

        {confirming && unused.length > 0 && (
          <div className="border-destructive/30 bg-destructive/5 rounded-md border p-2 text-xs">
            <p className="text-destructive">确认永久删除这 {unused.length} 个文件?此操作不可恢复。</p>
            <div className="mt-2 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" disabled={busy} onClick={() => void doRemove()}>
                确认清理
              </Button>
            </div>
          </div>
        )}

        {notice && <p className="text-muted-foreground text-[11px]">{notice}</p>}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button variant="outline" disabled={busy || scanning} onClick={() => void scan()}>
            重新扫描
          </Button>
          <Button
            variant="destructive"
            disabled={busy || scanning || !unused.length}
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="size-3.5" />
            {busy ? "清理中…" : `清理 ${unused.length} 个`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
