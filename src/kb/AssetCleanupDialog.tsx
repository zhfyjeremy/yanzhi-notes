import { useEffect, useState } from "react";
import { HardDrive, LoaderCircle, Trash2 } from "lucide-react";
import { kbBackend } from "./backend";
import { unReferencedAssets } from "./assets";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AssetCleanupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: string | null;
}

export function AssetCleanupDialog({ open, onOpenChange, root }: AssetCleanupDialogProps) {
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<string[]>([]);
  const [unused, setUnused] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);

  const scan = async () => {
    if (!root) return;
    setScanning(true);
    setNotice("");
    try {
      const [docs, trashDocs, allAssets] = await Promise.all([
        kbBackend.readAllDocs(root),
        kbBackend.readAllTrashDocs(root),
        kbBackend.listAssets(root),
      ]);
      setAssets(allAssets);
      // 回收站里的文档仍可能恢复,其资源必须保留
      setUnused(unReferencedAssets([...docs, ...trashDocs], allAssets));
      setConfirming(false);
    } catch (e) {
      setAssets([]);
      setUnused([]);
      setNotice(`扫描失败:${String(e)}`);
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (open) void scan();
    else {
      setAssets([]);
      setUnused([]);
      setNotice("");
      setConfirming(false);
    }
    // 只在打开/库变化时重新扫描
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, root]);

  const remove = async () => {
    if (!root || !unused.length) return;
    setBusy(true);
    try {
      const removed = await kbBackend.deleteAssets(root, unused);
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
          <DialogTitle>清理未引用资源</DialogTitle>
          <DialogDescription>
            扫描全库 Markdown 中指向 `assets/` 的链接,删除已无任何文档引用的图片和附件。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border">
          <div className="bg-muted/40 flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
            {scanning ? <LoaderCircle className="size-4 animate-spin" /> : <HardDrive className="size-4" />}
            <span>
              {scanning ? "正在扫描…" : `assets 文件 ${assets.length} 个,未引用 ${unused.length} 个`}
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto p-1.5">
            {unused.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-xs">
                {scanning ? "请稍候" : "没有可清理的文件"}
              </p>
            ) : (
              unused.map((rel) => (
                <div key={rel} className="text-muted-foreground truncate rounded px-2 py-1 text-xs" title={rel}>
                  {rel}
                </div>
              ))
            )}
          </div>
        </div>

        {confirming && unused.length > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
            <p className="text-destructive">
              确认永久删除这 {unused.length} 个资源文件?此操作不可恢复。
            </p>
            <div className="mt-2 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => void remove()}>
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
            {busy ? "清理中…" : `清理 ${unused.length} 个…`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
