import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

/**
 * 自研块交互插件(原生 ProseMirror Plugin,不依赖 Tiptap Pro)。
 *
 * ⚠️ 状态:阶段 0 S1 原型,块编辑模式已后移 V2(PRD §6.5),MVP 不挂载本插件。
 * 已验证:registerPlugin/unregisterPlugin 动态挂卸可行、不重建 editor;
 * 未竟事项:手柄定位稳定性、拖拽指示线打磨(V2 启用时继续)。
 *
 * - hover 顶层块时在左侧渲染六点手柄(widget decoration)
 * - pointer 事件自实现拖拽排序(WKWebView 里 HTML5 DnD 不可靠)
 * - decorations 缓存在 plugin state:只在 hover 块变化时重建 widget,
 *   否则每次 view 更新都会销毁重建手柄 DOM(闪烁/错位的根源)
 * - 拖拽期间冻结 hover 更新;事件挂 window 兜底
 * - 仅在 block 模式挂载;flow 模式 unregisterPlugin 完全卸载(PRD §4.0/§4.5)
 *
 * 粒度 = 顶层块(段落/标题/列表整体等);列表项级粒度待 fixtures 锁定。
 */

export const blockHandlePluginKey = new PluginKey<BlockHandleState>(
  "yzBlockHandle",
);

interface BlockHandleState {
  /** 当前 hover 的顶层块起始位置,null 表示无 */
  handlePos: number | null;
  /** 缓存的 decoration 集:handlePos 未变则不重建(widget 不闪) */
  decos: DecorationSet;
}

interface TopLevelRange {
  start: number;
  end: number;
  index: number;
}

interface DropTarget {
  range: TopLevelRange;
  before: boolean;
}

const GRIP_SVG = `<svg width="10" height="20" viewBox="0 0 10 20" fill="currentColor" aria-hidden="true"><circle cx="3" cy="4" r="1.4"/><circle cx="7" cy="4" r="1.4"/><circle cx="3" cy="10" r="1.4"/><circle cx="7" cy="10" r="1.4"/><circle cx="3" cy="16" r="1.4"/><circle cx="7" cy="16" r="1.4"/></svg>`;

/** 找到 pos 所在的顶层(depth 0)块的范围 */
function topLevelRangeAt(doc: PMNode, pos: number): TopLevelRange | null {
  let offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const size = doc.child(i).nodeSize;
    if (pos <= offset + size) {
      return { start: offset, end: offset + size, index: i };
    }
    offset += size;
  }
  return null;
}

/**
 * 按视口 Y 坐标命中顶层块(hover 与拖拽共用,规避 posAtCoords 边界歧义)。
 * 超出文档底部时兜底为「最后一块之后」。
 */
function blockAtY(view: EditorView, clientY: number): DropTarget | null {
  const doc = view.state.doc;
  if (!doc.childCount) return null;
  let offset = 0;
  let last: TopLevelRange | null = null;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const dom = view.nodeDOM(offset) as HTMLElement | null;
    if (dom) {
      const rect = dom.getBoundingClientRect();
      if (clientY <= rect.bottom) {
        return {
          range: { start: offset, end: offset + node.nodeSize, index: i },
          before: clientY < (rect.top + rect.bottom) / 2,
        };
      }
      last = { start: offset, end: offset + node.nodeSize, index: i };
    }
    offset += node.nodeSize;
  }
  return last ? { range: last, before: false } : null;
}

function createIndicator(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "yz-drop-indicator";
  document.body.appendChild(el);
  return el;
}

function createHandleDOM(
  view: EditorView,
  getPos: () => number | undefined,
  onDraggingChange: (dragging: boolean) => void,
): HTMLElement {
  const el = document.createElement("div");
  el.className = "yz-block-handle";
  el.contentEditable = "false";
  el.title = "拖拽排序";
  el.innerHTML = GRIP_SVG;

  // 手柄按块 DOM 顶部精确定位(静态位置会落在块间 margin 区,视觉错位)
  const position = () => {
    const pos = getPos();
    if (pos == null) return;
    const blockDom = view.nodeDOM(pos) as HTMLElement | null;
    if (!blockDom) return;
    const bRect = blockDom.getBoundingClientRect();
    const cRect = view.dom.getBoundingClientRect();
    el.style.top = `${bRect.top - cRect.top}px`;
  };

  let src: TopLevelRange | null = null;
  let srcEl: HTMLElement | null = null;
  let indicator: HTMLDivElement | null = null;
  let startY = 0;
  let dragging = false;

  const updateIndicator = (clientY: number) => {
    if (!indicator) return;
    const target = blockAtY(view, clientY);
    if (!target) return;
    const dom = view.nodeDOM(target.range.start) as HTMLElement | null;
    if (!dom) return;
    const bRect = dom.getBoundingClientRect();
    let y: number;
    if (target.before) {
      y = bRect.top;
    } else {
      // 锚定下一块顶部:落在间隙时视觉贴近文字,而非远处块底
      const nextDom = view.nodeDOM(target.range.end) as HTMLElement | null;
      y = nextDom ? nextDom.getBoundingClientRect().top : bRect.bottom;
    }
    indicator.style.left = `${bRect.left}px`;
    indicator.style.width = `${bRect.width}px`;
    indicator.style.top = `${y - 1}px`;
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onWindowMove);
    window.removeEventListener("pointerup", onWindowUp);
    window.removeEventListener("pointercancel", onWindowCancel);
    srcEl?.classList.remove("yz-block-dragging");
    document.body.classList.remove("yz-block-dragging");
    indicator?.remove();
    indicator = null;
    srcEl = null;
    src = null;
    if (dragging) {
      dragging = false;
      onDraggingChange(false);
    }
  };

  const onWindowMove = (event: PointerEvent) => {
    if (!src) return;
    if (!dragging && Math.abs(event.clientY - startY) > 4) {
      dragging = true;
      onDraggingChange(true);
      document.body.classList.add("yz-block-dragging");
      srcEl = view.nodeDOM(src.start) as HTMLElement | null;
      srcEl?.classList.add("yz-block-dragging");
      indicator = createIndicator();
    }
    if (dragging) updateIndicator(event.clientY);
  };

  const onWindowUp = (event: PointerEvent) => {
    if (dragging && src) {
      const target = blockAtY(view, event.clientY);
      if (target && target.range.index !== src.index) {
        const doc = view.state.doc;
        const srcNode = doc.child(src.index);
        const insertAt = target.before ? target.range.start : target.range.end;
        const adjusted =
          src.start < insertAt ? insertAt - (src.end - src.start) : insertAt;
        const tr = view.state.tr;
        tr.delete(src.start, src.end);
        tr.insert(adjusted, srcNode);
        tr.setMeta(blockHandlePluginKey, { pos: null });
        view.dispatch(tr);
      }
    }
    cleanup();
  };

  const onWindowCancel = () => cleanup();

  position();

  el.addEventListener("pointerdown", (event) => {
    event.preventDefault(); // 不让 PM 抢选区
    event.stopPropagation();
    const pos = getPos();
    src = pos == null ? null : topLevelRangeAt(view.state.doc, pos);
    if (!src) return;
    startY = event.clientY;
    // 挂 window:即便手柄 widget 被 PM 重建,事件链也不断
    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", onWindowUp);
    window.addEventListener("pointercancel", onWindowCancel);
  });

  return el;
}

export function createBlockHandlePlugin(): Plugin {
  let isDragging = false;

  const buildDecos = (doc: PMNode, handlePos: number | null): DecorationSet => {
    if (handlePos == null) return DecorationSet.empty;
    const range = topLevelRangeAt(doc, handlePos);
    if (!range) return DecorationSet.empty;
    return DecorationSet.create(doc, [
      Decoration.widget(
        handlePos,
        (view: EditorView, getPos: () => number | undefined) =>
          createHandleDOM(view, getPos, (d) => {
            isDragging = d;
          }),
        { side: -1 },
      ),
      Decoration.node(range.start, range.end, { class: "yz-block-hover" }),
    ]);
  };

  return new Plugin<BlockHandleState>({
    key: blockHandlePluginKey,
    state: {
      init: () => ({ handlePos: null, decos: DecorationSet.empty }),
      apply(tr, prev) {
        const meta = tr.getMeta(blockHandlePluginKey) as
          | { pos: number | null }
          | undefined;
        if (meta) {
          return {
            handlePos: meta.pos,
            decos: buildDecos(tr.doc, meta.pos),
          };
        }
        if (tr.docChanged && prev.handlePos != null) {
          return {
            handlePos: prev.handlePos,
            decos: prev.decos.map(tr.mapping, tr.doc),
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        return blockHandlePluginKey.getState(state)?.decos ?? DecorationSet.empty;
      },
      handleDOMEvents: {
        mousemove(view, event) {
          if (isDragging) return false; // 拖拽中冻结 hover,防 widget 重建断事件
          const mouse = event as MouseEvent;
          const hit = blockAtY(view, mouse.clientY);
          const target = hit ? hit.range.start : null;
          const current =
            blockHandlePluginKey.getState(view.state)?.handlePos ?? null;
          if (target !== current) {
            view.dispatch(
              view.state.tr.setMeta(blockHandlePluginKey, { pos: target }),
            );
          }
          return false;
        },
        mouseleave(view) {
          if (isDragging) return false;
          const current =
            blockHandlePluginKey.getState(view.state)?.handlePos ?? null;
          if (current != null) {
            view.dispatch(
              view.state.tr.setMeta(blockHandlePluginKey, { pos: null }),
            );
          }
          return false;
        },
      },
    },
  });
}
