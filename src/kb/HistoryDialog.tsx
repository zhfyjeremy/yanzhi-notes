import { useEffect, useState } from "react";
import { GitCompare, Eye } from "lucide-react";
import type { HistoryEntry } from "./types";
import { diffLines } from "./diff";
import { formatSnapshotTime } from "./HistoryPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 快照查看对话框(PRD 6.2-4):只读查看 Markdown 源码 / 与当前内容行级对比高亮;
 * 「恢复此版本」= 先为当前内容自动存一份快照再整体替换(防手滑丢稿)。
 */

interface HistoryDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry: HistoryEntry | null;
  /** 打开时的当前正文(对比基准) */
  currentMd: string;
  /** 拉取快照内容(entry 变化时调用) */
  loadContent: () => Promise<string>;
  onRestore: (content: string, entry: HistoryEntry) => void;
}

export function HistoryDialog({ open, onOpenChange, entry, currentMd, loadContent, onRestore }: HistoryDialogProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"preview" | "diff">("preview");

  useEffect(() => {
    if (!open || !entry) return;
    setContent(null);
    setError(false);
    setMode("preview");
    let alive = true;
    loadContent()
      .then((c) => alive && setContent(c))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
    // loadContent 随 entry 闭包 currentPath,deps 以 entry 为准
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry]);

  const rows = content != null ? diffLines(content, currentMd) : [];
  const changed = rows.filter((r) => r.type !== "ctx").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>历史快照 · {entry ? formatSnapshotTime(entry.time) : ""}</DialogTitle>
          <DialogDescription>
            {entry?.auto ? "自动快照" : "手动快照"} · {entry?.chars ?? 0} 字;恢复前会先为当前内容自动存一份快照
          </DialogDescription>
        </DialogHeader>

        <div className="bg-hover flex rounded-lg p-1" role="radiogroup" aria-label="查看方式">
          {(
            [
              { id: "preview", label: "只读查看", icon: Eye },
              { id: "diff", label: `对比当前${changed && content != null ? `(${changed} 处)` : ""}`, icon: GitCompare },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              className={cn(
                "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
                mode === id
                  ? "bg-raised text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setMode(id)}
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        <div className="border-border-subtle bg-editor max-h-[55vh] min-h-40 overflow-auto rounded-lg border p-1.5 font-mono text-xs leading-5 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
          {error ? (
            <p className="text-destructive p-3 font-sans text-sm">快照读取失败,可能已被清理</p>
          ) : content == null ? (
            <p className="text-muted-foreground p-3 font-sans text-sm">读取中…</p>
          ) : mode === "preview" ? (
            <pre className="text-foreground/90 px-2 py-1 whitespace-pre-wrap">{content}</pre>
          ) : (
            <div>
              {rows.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    "px-2 py-1 whitespace-pre-wrap",
                    r.type === "add" && "yz-diff-add",
                    r.type === "del" && "yz-diff-del",
                  )}
                >
                  {r.type === "add" ? "+ " : r.type === "del" ? "- " : "  "}
                  {r.text || " "}
                </div>
              ))}
              {changed === 0 && (
                <p className="text-muted-foreground px-2 py-2 font-sans">与当前内容一致</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button
            disabled={content == null || error}
            onClick={() => {
              if (content == null || !entry) return;
              onRestore(content, entry);
              onOpenChange(false);
            }}
          >
            恢复此版本
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
