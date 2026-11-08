import Image from "@tiptap/extension-image";
import type { Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { resolveRenderSrc } from "@/kb/asset-src";

/**
 * 图片卡片(PRD §5.3.7):attrs.src 始终存 md 相对引用(`./assets/x.png`),
 * 渲染时经 resolveRenderSrc 解析成可显示 URL(tauri asset: 协议 / mock dataURL);
 * 序列化零改动,md 真源不被渲染 URL 污染。
 * width/align 是视图层属性,不进 md 序列化(方言表无宽度语法,不擅自扩方言;
 * M3 已定:持久化不做,会话级视图属性,见 STATUS 决策记录)。
 * 资源加载失败(路径写错 / 文件被外部删除 / assets 迁移漏了)不留空白框:
 * 渲染成 Typora 式「破图图标 + 图片地址」,地址即 md 原文(src),便于用户照着修。
 * 独占段落的图片居中由段落级 decoration 实现(inline img 自身无法居中)。
 * 选中时可拖左右手柄连续改宽(仍写 width 百分比 attrs)。
 */

const WIDTH_MIN = 20;
const WIDTH_MAX = 100;

/** 独占段落且 align=center 的图片所在段落 → 居中 class */
const centerParagraphsPlugin = new Plugin({
  key: new PluginKey("yzImageAlign"),
  props: {
    decorations(state) {
      const decorations: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "paragraph" || node.childCount !== 1) return;
        const img = node.firstChild;
        if (img?.type.name !== "image" || img.attrs.align !== "center") return;
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "yz-img-center",
          }),
        );
      });
      return DecorationSet.create(state.doc, decorations);
    },
  },
});

/**
 * 加载失败判定(纯函数,单测锁定):
 * - 空地址直接算失败(没有 src 的图片节点就是坏图);
 * - failedSrc 与当前解析地址相同才算失败 —— 用户改了图片地址后自动重试,不再挂着旧失败态。
 */
export function isBrokenImage(rawSrc: string, renderSrc: string, failedSrc: string | null): boolean {
  return !rawSrc.trim() || failedSrc === renderSrc;
}

/** 失败占位展示的地址文案(md 原文,用户照着就能修) */
export function brokenImageLabel(rawSrc: string): string {
  return rawSrc.trim() || "(空图片地址)";
}

function parseWidthPct(width: unknown, fallbackPx: number, editorWidth: number): number {
  if (typeof width === "string" && width.endsWith("%")) {
    const n = Number.parseFloat(width);
    if (Number.isFinite(n)) return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n));
  }
  if (editorWidth > 0 && fallbackPx > 0) {
    return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round((fallbackPx / editorWidth) * 100)));
  }
  return 100;
}

function ImageCardView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const { src, alt, width } = node.attrs;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const draggingRef = useRef(false);
  /** 加载失败的解析后 URL;与当前 renderSrc 相同才算失败(改了地址即自动重试) */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const rawSrc = String(src ?? "");
  const renderSrc = resolveRenderSrc(rawSrc);
  const broken = isBrokenImage(rawSrc, renderSrc, failedSrc);
  /** 悬停提示:alt + 解析后的真实地址(tauri 下 asset:// 绝对路径,便于定位文件) */
  const brokenTitle = [alt, renderSrc !== rawSrc ? renderSrc : null]
    .filter(Boolean)
    .join(" · ");

  const startResize = useCallback(
    (edge: "left" | "right") => (event: React.PointerEvent<HTMLSpanElement>) => {
      if (event.button !== 0 || !editor || editor.isDestroyed) return;
      event.preventDefault();
      event.stopPropagation();
      const img = imgRef.current;
      const docEl = editor.view.dom as HTMLElement;
      if (!img || !docEl) return;

      const startX = event.clientX;
      const startPx = img.getBoundingClientRect().width;
      const editorWidth = docEl.clientWidth || 1;
      const startPct = parseWidthPct(node.attrs.width, startPx, editorWidth);
      draggingRef.current = true;
      docEl.classList.add("yz-img-resizing");

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        const dx = edge === "right" ? ev.clientX - startX : startX - ev.clientX;
        const deltaPct = (dx / editorWidth) * 100;
        const next = Math.round(
          Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startPct + deltaPct)),
        );
        updateAttributes({ width: `${next}%` });
      };
      const onUp = () => {
        draggingRef.current = false;
        docEl.classList.remove("yz-img-resizing");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editor, node.attrs.width, updateAttributes],
  );

  // 宽度加在卡片上而非 img:避免「img 百分比 + inline-block 父级」循环算宽,
  // 父级被撑满正文宽、图只占一半时,右侧手柄漂在空白里。
  // 加载失败时不再套 width%(占位是文字,按正文宽截断更合适)。
  return (
    <NodeViewWrapper
      as="span"
      className="yz-img-card"
      data-selected={selected || undefined}
      style={width && !broken ? { width } : undefined}
    >
      {broken ? (
        <span
          className="yz-img-broken"
          contentEditable={false}
          title={brokenTitle || undefined}
        >
          <ImageOff className="size-3.5 shrink-0 text-destructive" aria-hidden />
          <span className="yz-img-broken-text">{brokenImageLabel(rawSrc)}</span>
        </span>
      ) : (
        <img
          ref={imgRef}
          key={renderSrc}
          src={renderSrc}
          alt={alt ?? ""}
          draggable={false}
          onError={() => setFailedSrc(renderSrc)}
        />
      )}
      {selected && !broken && (
        <>
          <span
            className="yz-img-handle yz-img-handle-w"
            contentEditable={false}
            onPointerDown={startResize("left")}
          />
          <span
            className="yz-img-handle yz-img-handle-e"
            contentEditable={false}
            onPointerDown={startResize("right")}
          />
        </>
      )}
    </NodeViewWrapper>
  );
}

/** 插入独立段落的图片并选中(浮出工具条,便于立即改地址/宽度) */
export function insertImage(editor: Editor, attrs: { src: string; alt?: string | null }): void {
  const { state } = editor;
  const tr = state.tr;
  const img = state.schema.nodes.image.create({ alt: null, ...attrs });
  const para = state.schema.nodes.paragraph.create(null, img);
  tr.replaceSelectionWith(para, false);
  // 块级插入后 selection 与插入内容的间隔不定(可能隔着后续块的开标签),
  // 以节点引用比对在插入点附近探测图片真实位置
  const around = tr.selection.from;
  for (let p = around; p >= 0 && p >= around - para.nodeSize - 2; p--) {
    if (tr.doc.nodeAt(p) === img) {
      tr.setSelection(NodeSelection.create(tr.doc, p));
      break;
    }
  }
  editor.view.dispatch(tr);
}

export const ImageCard = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      /** 显示宽度百分比("50%" 等);null = 原始尺寸(不超过正文宽) */
      width: {
        default: null,
        renderHTML: () => ({}), // 由 NodeView 的 style 负责
      },
      /** left | center | null;left 与 null 视觉相同,仅为控件激活态记录 */
      align: {
        default: null,
        renderHTML: () => ({}),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageCardView);
  },

  addProseMirrorPlugins() {
    return [centerParagraphsPlugin];
  },
});
