import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 右栏文档大纲 TOC(PRD §5.4):自动抓取 H1~H6、点击跳转、滚动高亮当前标题、可折叠。
 * 滚动监听挂在编辑区滚动容器(YanzhiEditor 的 scrollContainerRef 透传)。
 * 外层容器是 App 里共享右栏的 aside(下方还挂反向链接面板),本组件占 flex-1。
 */

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

const SCROLL_TOP_THRESHOLD = 32;

export function TocPanel({
  editor,
  scrollContainer,
}: {
  editor: Editor;
  scrollContainer: HTMLElement | null;
}) {
  const [activePos, setActivePos] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const headings = useEditorState({
    editor,
    selector: ({ editor }) => {
      const items: HeadingItem[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
          items.push({
            level: node.attrs.level as number,
            text: node.textContent,
            pos,
          });
        }
      });
      return items;
    },
  });

  // 滚动高亮:取最后一个已滚过容器顶部的标题(rAF 节流)
  useEffect(() => {
    if (!scrollContainer) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (editor.isDestroyed || !editor.view) return;
      const containerTop = scrollContainer.getBoundingClientRect().top;
      let active: number | null = null;
      for (const heading of headings) {
        const dom = editor.view.domAtPos(heading.pos + 1);
        const el =
          dom.node.nodeType === 1
            ? (dom.node as HTMLElement)
            : dom.node.parentElement;
        if (!el) continue;
        if (el.getBoundingClientRect().top - containerTop <= SCROLL_TOP_THRESHOLD) {
          active = heading.pos;
        }
      }
      setActivePos(active);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      scrollContainer.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [editor, scrollContainer, headings]);

  const jumpTo = (pos: number) => {
    if (editor.isDestroyed || !editor.view) return;
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center px-3">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold tracking-[0.03em]"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          大纲
        </button>
      </header>
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {headings.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-[11px] leading-5">
              暂无标题。输入 <code>#</code> 或用斜杠菜单插入标题。
            </p>
          ) : (
          headings.map((heading) => (
            <button
              key={heading.pos}
              onClick={() => jumpTo(heading.pos)}
              className={cn(
                "hover:bg-hover block w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-left text-xs leading-5 transition-colors",
                activePos === heading.pos
                  ? "bg-raised text-foreground ring-primary/15 font-medium ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
              style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}
              title={heading.text}
            >
              {heading.text || "无标题"}
            </button>
          ))
          )}
        </div>
      )}
    </div>
  );
}
