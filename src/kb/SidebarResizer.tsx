import { useCallback, useEffect, useRef, useState } from "react";
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, clampSidebarWidth } from "../settings";

/**
 * 左栏(目录树)与正文之间的可拖拽分隔条。
 *
 * 交互:
 * - 常态:一条 1px 细线(落在两侧面板之间的间隙正中)
 * - 悬停/拖动:线加粗并染主色,鼠标变 col-resize
 * - 拖动:实时改宽度;拖动中禁用 transition 保证跟手(0 延迟),
 *   松手后恢复 transition,右侧正文区随之平滑收缩
 *
 * 布局:自身宽度为 0,靠绝对定位的伪元素把命中区撑到 ±6px,
 * 这样分隔条不额外撑开父级 gap,视觉线正好落在间隙中央。
 */
export function SidebarResizer({
  width,
  onWidthChange,
  onDragStateChange,
  className,
}: {
  /** 当前左栏宽度(px) */
  width: number;
  /** 拖动过程中持续回调(实时宽度) */
  onWidthChange: (width: number) => void;
  /** 拖动开始/结束时通知父级(用于切换 transition 等) */
  onDragStateChange?: (dragging: boolean) => void;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);
  // 拖动起点快照:startX + 起始宽度,避免用当前宽度累加导致漂移
  const dragStart = useRef<{ x: number; width: number } | null>(null);
  /** 拖动中的同步标记:比 state 更早更新,避免事件回调里读到上一帧的值 */
  const draggingRef = useRef(false);
  /** 最新宽度:键盘微调基于它算下一步,不依赖父级重渲染时机 */
  const widthRef = useRef(width);
  widthRef.current = width;

  const finishDrag = useCallback(() => {
    dragStart.current = null;
    // 注意:不要在 setState 的 updater 里做副作用(React 严格模式下会重复执行),
    // 这里先读当前值再置位,避免 onDragStateChange 被调两次。
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    onDragStateChange?.(false);
  }, [onDragStateChange]);

  // 全局监听:mousemove / mouseup 绑在 window 上,
  // 鼠标移出分隔条也不会中断拖动(否则会"拖到边缘卡住")。
  // 监听器按 draggingRef 判断是否在拖,而不是靠 state:
  // state 更新要等一次渲染,拖动的第一帧移动会被漏掉。
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const start = dragStart.current;
      if (!start) return;
      const next = clampSidebarWidth(start.width + (e.clientX - start.x));
      widthRef.current = next;
      onWidthChange(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      finishDrag();
    };
    // 窗口失焦(拖到窗口外松手)也要收尾,否则宽度永远停在"拖动中"状态
    const onBlur = () => {
      if (!draggingRef.current) return;
      finishDrag();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [finishDrag, onWidthChange]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 只响应主键;别让右键/中键的 contextmenu 误触发拖动
      if (e.button !== 0) return;
      e.preventDefault();
      dragStart.current = { x: e.clientX, width };
      draggingRef.current = true;
      setDragging(true);
      onDragStateChange?.(true);
    },
    [width, onDragStateChange],
  );

  // 双击回到默认宽度(常见分隔条惯例)
  const onDoubleClick = useCallback(() => {
    const reset = clampSidebarWidth(undefined);
    widthRef.current = reset;
    onWidthChange(reset);
    // 双击复位也要落盘:宽度变了,得让父级把新值写进 settings
    onDragStateChange?.(false);
  }, [onWidthChange, onDragStateChange]);

  // 键盘微调:←/→ 每次 16px,Shift 加速到 48px,Home/End 跳到两端
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 48 : 16;
      const current = widthRef.current;
      let next: number | null = null;
      if (e.key === "ArrowLeft") next = current - step;
      else if (e.key === "ArrowRight") next = current + step;
      else if (e.key === "Home") next = SIDEBAR_WIDTH_MIN;
      else if (e.key === "End") next = SIDEBAR_WIDTH_MAX;
      if (next === null) return;
      e.preventDefault();
      const clamped = clampSidebarWidth(next);
      widthRef.current = clamped;
      onWidthChange(clamped);
      // 键盘调完也要落盘
      onDragStateChange?.(false);
    },
    [onWidthChange, onDragStateChange],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整左栏宽度"
      aria-valuenow={Math.round(width)}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      // 可聚焦:分隔条除了鼠标拖动,还支持键盘 ←/→ 微调、Home/End 跳到边界
      tabIndex={0}
      title="拖动调整左栏宽度,双击复位"
      data-dragging={dragging ? "" : undefined}
      data-resizer="sidebar"
      className={[
        "group/resizer relative z-20 w-px shrink-0 cursor-col-resize",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {/* 命中区:绝对定位撑到两侧各 6px,视觉上线仍是 1px */}
      <span
        aria-hidden
        className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize"
      />
      {/* 视觉线:常态 1px 淡色;hover/拖动加粗并染主色 */}
      <span
        aria-hidden
        className={[
          "absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-150",
          dragging
            ? "bg-primary w-[3px]"
            : "bg-border-subtle w-px group-hover/resizer:bg-primary group-hover/resizer:w-[3px]",
        ].join(" ")}
      />
    </div>
  );
}
