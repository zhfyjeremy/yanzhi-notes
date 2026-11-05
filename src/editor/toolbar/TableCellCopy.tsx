import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";

/**
 * 表格单元格悬停复制(设置 tableCellCopy 开启时):
 * 不改 Schema/md,仅在 td/th 右上角浮一层按钮,点一下复制该格纯文本。
 */

interface TableCellCopyProps {
  editor: Editor;
  enabled: boolean;
}

interface Anchor {
  top: number;
  left: number;
  text: string;
}

function cellOf(target: EventTarget | null, root: HTMLElement): HTMLTableCellElement | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest("td, th");
  if (!(cell instanceof HTMLTableCellElement)) return null;
  if (!root.contains(cell)) return null;
  // 复制按钮自身不算「悬停在单元格内容」
  if (target.closest("[data-yz-cell-copy]")) return cell;
  return cell;
}

function cellText(cell: HTMLTableCellElement): string {
  return (cell.innerText || cell.textContent || "").replace(/\u00a0/g, " ").trim();
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

export function TableCellCopy({ editor, enabled }: TableCellCopyProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setAnchor(null);
      setCopied(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const root = editor.view.dom;
    const host = hostRef.current?.parentElement;
    if (!host) return;

    const clearHide = () => {
      if (hideTimer.current !== undefined) {
        window.clearTimeout(hideTimer.current);
        hideTimer.current = undefined;
      }
    };

    const scheduleHide = () => {
      clearHide();
      hideTimer.current = window.setTimeout(() => {
        setAnchor(null);
        setCopied(false);
      }, 120);
    };

    const showFor = (cell: HTMLTableCellElement) => {
      const text = cellText(cell);
      if (!text) {
        setAnchor(null);
        return;
      }
      const c = cell.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      clearHide();
      setAnchor({
        top: Math.max(0, c.top - h.top + 4),
        left: Math.max(0, c.right - h.left - 28),
        text,
      });
    };

    const onMove = (e: MouseEvent) => {
      const cell = cellOf(e.target, root);
      if (!cell) {
        scheduleHide();
        return;
      }
      showFor(cell);
    };

    const onLeave = (e: MouseEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && (root.contains(next) || hostRef.current?.contains(next))) return;
      scheduleHide();
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      clearHide();
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, enabled]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (!enabled) {
    return <div ref={hostRef} className="hidden" aria-hidden="true" />;
  }

  return (
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-20" aria-hidden={!anchor}>
      {anchor && (
        <div
          data-yz-cell-copy=""
          className="pointer-events-auto absolute"
          style={{ top: anchor.top, left: anchor.left }}
          onMouseEnter={() => {
            if (hideTimer.current !== undefined) {
              window.clearTimeout(hideTimer.current);
              hideTimer.current = undefined;
            }
          }}
          onMouseLeave={() => {
            hideTimer.current = window.setTimeout(() => {
              setAnchor(null);
              setCopied(false);
            }, 120);
          }}
        >
          <Hint label={copied ? "已复制" : "复制单元格"}>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="bg-raised border-border-subtle size-6 shadow-sm"
              aria-label={copied ? "已复制" : "复制单元格"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void writeClipboard(anchor.text).then(() => {
                  setCopied(true);
                  if (copiedTimer.current !== undefined) window.clearTimeout(copiedTimer.current);
                  copiedTimer.current = window.setTimeout(() => setCopied(false), 1200);
                });
              }}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </Hint>
        </div>
      )}
    </div>
  );
}
