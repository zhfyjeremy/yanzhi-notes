import { useRef } from "react";
import { FileText, Link2Off, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";

interface MissingLinkDialogProps {
  /** 失效的双链目标(裸名或路径写法) */
  target: string | null;
  onClose: () => void;
  /** 用目标最后一段作为搜索词,交给左栏搜索框预置 */
  onSearch: (name: string) => void;
}

/**
 * 失效双链提示(5.2.1-5):不是危险操作,所以用「断链」警示 + 单一恢复动作;
 * 目标名用等宽 chip 呈现,方便一眼核对。
 */
export function MissingLinkDialog({ target, onClose, onSearch }: MissingLinkDialogProps) {
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchName = (target ?? "").split("/").pop()?.replace(/\.md$/i, "") ?? "";

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      tone="warning"
      icon={<Link2Off className="size-5" aria-hidden="true" />}
      title="链接目标不存在"
      description="这篇文档可能被改名或移动了。"
      initialFocusRef={searchButtonRef}
      className="sm:max-w-[430px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button ref={searchButtonRef} onClick={() => searchName && onSearch(searchName)}>
            <Search className="size-3.5" aria-hidden="true" />
            搜索同名文档
          </Button>
        </>
      }
    >
      <div className="border-border-subtle bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-2">
        <FileText className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        <span className="text-foreground/85 truncate font-mono text-xs" title={target ?? undefined}>
          {target}
        </span>
      </div>
      <p className="text-muted-foreground mt-3 text-[13px] leading-5">
        如果链接写的是路径，外部改名后就会失联。可以搜索同名文档，找到后重新链接。
      </p>
    </ConfirmDialog>
  );
}