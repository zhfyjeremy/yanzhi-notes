/**
 * fixed 浮层视口夹紧:底部空间不够则上翻,并给出可滚动 maxHeight。
 */

export type FloatMenuPos = {
  x: number;
  y: number;
  placement: "top" | "bottom";
  maxHeight: number;
};

export function placeFloatMenu(
  anchor: { left: number; right: number; top: number; bottom: number },
  opts?: {
    preferBelow?: boolean;
    /** 预估高度,用于决定是否上翻 */
    estimatedHeight?: number;
    margin?: number;
    width?: number;
  },
): FloatMenuPos {
  const margin = opts?.margin ?? 8;
  const estimated = opts?.estimatedHeight ?? 380;
  const width = opts?.width ?? 180;
  const spaceBelow = window.innerHeight - anchor.bottom - margin;
  const spaceAbove = anchor.top - margin;
  const preferBelow = opts?.preferBelow !== false;
  const placeBottom =
    (preferBelow && spaceBelow >= Math.min(estimated, 200)) || spaceBelow >= spaceAbove;
  const available = placeBottom ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(120, Math.min(estimated, available));
  let x = anchor.left;
  x = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
  const y = placeBottom ? anchor.bottom + 4 : Math.max(margin, anchor.top - 4);
  return {
    x,
    y,
    placement: placeBottom ? "bottom" : "top",
    maxHeight,
  };
}
