import { cloneElement, forwardRef, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * 悬停提示(icon 类统一入口):radix Tooltip 400ms 出现——
 * 原生 title 延迟浏览器固定且不可控(WKWebView 实测 1-3s)。
 * 文本截断类提示(长路径/超长标题)仍用原生 title。
 *
 * forwardRef 把外部 ref 合并进 children:树「+」按钮是
 * DropdownMenuTrigger asChild → Hint → span,ref 断了 popper anchor 就丢。
 */
export const Hint = forwardRef<
  HTMLElement,
  {
    label: string;
    side?: "top" | "bottom" | "left" | "right";
    /** 默认 = label;自带文本的元素(如菜单项)传 null 关闭,避免覆盖原 accessible name */
    ariaLabel?: string | null;
    children: ReactNode;
  }
>(function Hint({ label, side = "bottom", ariaLabel = label, children }, ref) {
  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ ref?: unknown; "aria-label"?: string }>, {
        ref,
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}), // icon 无文字时标注给读屏与 E2E
      })
    : children;
  return (
    // radix 统一包的 Tooltip 强制要求 Provider;嵌套 Provider 合法
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>{child}</TooltipTrigger>
        {/* 无箭头:贴近语雀/系统 tooltip 的平贴样式 */}
        <TooltipContent side={side} arrow={false} className="px-2 py-1">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
