import type { ReactNode, RefObject } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ConfirmTone = "info" | "warning" | "danger" | "success";

const TONE_STYLES = {
  info: {
    Icon: Info,
    iconClassName: "bg-[var(--callout-info-bg)] text-[var(--callout-info)]",
  },
  warning: {
    Icon: TriangleAlert,
    iconClassName: "bg-[var(--callout-warning-bg)] text-[var(--callout-warning)]",
  },
  danger: {
    Icon: CircleAlert,
    iconClassName: "bg-destructive/10 text-destructive",
  },
  success: {
    Icon: CircleCheck,
    iconClassName: "bg-[var(--callout-success-bg)] text-[var(--callout-success)]",
  },
} as const;

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone?: ConfirmTone;
  /** 覆盖 tone 默认图标(仍保留同一色块) */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 标题/说明下的正文区,例如目标路径、列表、表单 */
  children?: ReactNode;
  footer: ReactNode;
  footerClassName?: string;
  className?: string;
  /** 打开时聚焦主操作,避免默认落到取消键出现粗焦点环 */
  initialFocusRef?: RefObject<HTMLElement>;
  showCloseButton?: boolean;
}

/**
 * 二次确认/提示弹窗的统一外壳(PRD 5.x 交互):
 * 图标先行、标题说明、正文可选、底部操作无边框分隔带。
 * 具体动作由调用方传入,避免把危险/普通/成功语义塞进组件里。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  tone = "warning",
  icon,
  title,
  description,
  children,
  footer,
  footerClassName,
  className,
  initialFocusRef,
  showCloseButton = true,
}: ConfirmDialogProps) {
  const { Icon, iconClassName } = TONE_STYLES[tone];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={showCloseButton}
        onOpenAutoFocus={
          initialFocusRef
            ? (event) => {
                event.preventDefault();
                initialFocusRef.current?.focus();
              }
            : undefined
        }
        className={cn(
          "gap-0 overflow-hidden p-0 sm:max-w-sm",
          className
        )}
      >
        <div className="flex items-start gap-3 pr-10 pl-5 pt-5">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              iconClassName
            )}
          >
            {icon ?? <Icon className="size-5" aria-hidden="true" />}
          </span>
          <div className="min-w-0 pt-0.5">
            <DialogTitle className="text-[17px] leading-6 font-semibold tracking-[-0.01em]">
              {title}
            </DialogTitle>
            {description && (
              <DialogDescription className="mt-1 text-[13px] leading-5">
                {description}
              </DialogDescription>
            )}
          </div>
        </div>

        {children && <div className="px-5 pt-4">{children}</div>}

        <div
          className={cn(
            "flex flex-wrap items-center justify-end gap-2 px-5 py-4",
            footerClassName
          )}
        >
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}