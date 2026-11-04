import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { AlignCenter, AlignLeft, Link2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { resolveRenderSrc } from "@/kb/asset-src";

/**
 * 图片卡片工具条(PRD §5.3.7)M2:选中图片(NodeSelection)时浮出。
 * 宽度/对齐为会话级视图属性(image-card.tsx),放大走全屏 lightbox;
 * 与 TableToolbar 同款定位模式:锚在正文容器,ResizeObserver 兜底重算。
 */

const TOOLBAR_HEIGHT = 34;
const WIDTH_OPTIONS = ["50%", "75%", "100%"] as const;

interface ImageToolbarProps {
  editor: Editor;
  /** lightbox 打开时由 App 层渲染全屏预览 */
  onPreview?: (src: string | null) => void;
}

export function ImageToolbar({ editor, onPreview }: ImageToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSrc, setLinkSrc] = useState("");
  const [linkAlt, setLinkAlt] = useState("");

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { selection } = editor.state;
      // NodeSelection 时 $from.nodeAfter 即选中节点(from≠to,不能按 collapsed 判断)
      const img = selection.$from.nodeAfter;
      const isImageNode = img?.type.name === "image";
      return {
        active: !!isImageNode,
        pos: selection.from,
        src: (img?.attrs.src as string) ?? "",
        alt: (img?.attrs.alt as string | null) ?? null,
        width: (img?.attrs.width as string | null) ?? null,
        align: (img?.attrs.align as string | null) ?? null,
      };
    },
  });

  useLayoutEffect(() => {
    if (!state.active) {
      setPos(null);
      return;
    }
    const host = ref.current?.parentElement;
    const dom = editor.view.nodeDOM(state.pos) as HTMLElement | null;
    const imgEl =
      dom?.tagName === "IMG"
        ? dom
        : ((dom?.querySelector("img") as HTMLElement | null) ?? dom);
    if (!host || !imgEl) {
      setPos(null);
      return;
    }
    const r = imgEl.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    // 锚在图片下方左侧
    setPos({
      top: Math.min(h.height - TOOLBAR_HEIGHT, r.bottom - h.top + 8),
      left: Math.max(0, r.left - h.left),
    });
  }, [editor, state.active, state.pos, state.width, state.align, layoutTick]);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  if (!state.active || !pos) {
    return <div ref={ref} className="hidden" aria-hidden="true" />;
  }

  // updateAttributes 按 selection range 找节点,collapsed TextSelection 的空区间
  // 命不中目标;命令前先显式回到图片的 NodeSelection
  const setAttrs = (attrs: Record<string, unknown>) =>
    editor
      .chain()
      .focus()
      .setNodeSelection(state.pos)
      .updateAttributes("image", attrs)
      .run();

  const setWidth = (width: string) =>
    setAttrs({ width: state.width === width ? null : width });

  const setAlign = (align: "left" | "center") =>
    setAttrs({ align: state.align === align ? null : align });

  return (
    <div
      ref={ref}
      className="chrome-float bg-background/95 absolute z-20 flex items-center gap-0.5 rounded-lg border border-border-subtle p-0.5 shadow-md backdrop-blur"
      style={{ top: pos.top, left: pos.left, height: TOOLBAR_HEIGHT }}
    >
      {WIDTH_OPTIONS.map((w) => (
        <Button
          key={w}
          variant="ghost"
          size="xs"
          className={cn(
            "text-muted-foreground hover:text-foreground px-1.5 font-mono",
            state.width === w && "bg-accent text-accent-foreground hover:text-accent-foreground",
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setWidth(w)}
        >
          {w}
        </Button>
      ))}

      <div className="mx-1 h-5 w-px shrink-0 bg-border" />

      <Hint label="居左">
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            "text-muted-foreground hover:text-foreground",
            state.align !== "center" && "bg-accent text-accent-foreground hover:text-accent-foreground",
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAlign("left")}
        >
          <AlignLeft className="size-3.5" />
        </Button>
      </Hint>
      <Hint label="居中">
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn(
            "text-muted-foreground hover:text-foreground",
            state.align === "center" && "bg-accent text-accent-foreground hover:text-accent-foreground",
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setAlign("center")}
        >
          <AlignCenter className="size-3.5" />
        </Button>
      </Hint>

      <div className="mx-1 h-5 w-px shrink-0 bg-border" />

      {/* 编辑地址/描述(需输入,不 preventDefault) */}
      <Popover
        open={linkOpen}
        onOpenChange={(open) => {
          if (open) {
            setLinkSrc(state.src ?? "");
            setLinkAlt(state.alt ?? "");
          }
          setLinkOpen(open);
        }}
      >
        <Hint label="编辑图片链接">
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
            >
              <Link2 className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent align="end" className="w-72 p-2.5">
          <Input
            autoFocus
            value={linkSrc}
            onChange={(e) => setLinkSrc(e.target.value)}
            placeholder="图片地址(https:// 或相对路径)"
          />
          <Input
            className="mt-1.5"
            value={linkAlt}
            onChange={(e) => setLinkAlt(e.target.value)}
            placeholder="描述(alt)"
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              disabled={!linkSrc.trim()}
              onClick={() => {
                setAttrs({ src: linkSrc.trim(), alt: linkAlt.trim() || null });
                setLinkOpen(false);
              }}
            >
              确定
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Hint label="放大预览">
        {/* 预览走渲染解析(./assets 相对引用 → asset:/dataURL),不能直接给 md 原始 src */}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPreview?.(state.src ? resolveRenderSrc(state.src) : null)}
      >
        <Maximize2 className="size-3.5" />
        </Button>
      </Hint>
    </div>
  );
}
