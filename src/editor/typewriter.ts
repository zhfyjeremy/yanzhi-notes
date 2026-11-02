import type { EditorView } from "@tiptap/pm/view";

/**
 * 打字机滚动:把光标对齐到视口内固定比例处(默认略偏上,长文更自然)。
 * 纯计算便于单测;实际滚动见 scrollCaretToTypewriterLine。
 */
export function typewriterTargetScroll(
  caretY: number,
  viewportH: number,
  scrollHeight: number,
  ratio = 0.45,
): number {
  if (viewportH <= 0) return 0;
  const target = caretY - viewportH * ratio;
  const max = Math.max(0, scrollHeight - viewportH);
  return Math.min(max, Math.max(0, target));
}

/** 将当前选区 head 滚到滚动容器内的打字机线。失败(pos 越界等)静默跳过。 */
export function scrollCaretToTypewriterLine(
  view: EditorView,
  container: HTMLElement,
  ratio = 0.45,
): void {
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(view.state.selection.head);
  } catch {
    return;
  }
  const crect = container.getBoundingClientRect();
  const caretMid = (coords.top + coords.bottom) / 2;
  const caretY = caretMid - crect.top + container.scrollTop;
  container.scrollTop = typewriterTargetScroll(
    caretY,
    crect.height,
    container.scrollHeight,
    ratio,
  );
}
