import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 右栏文档大纲 TOC(PRD §5.4):自动抓取 H1~H6、点击跳转、滚动高亮当前标题、可折叠。
 * 滚动监听挂在编辑区滚动容器(YanzhiEditor 的 scrollContainerRef 透传)。
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
    editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        title="展开大纲"
        className="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex w-8 shrink-0 cursor-pointer flex-col items-center gap-2 py-3 transition-colors"
      >
        <PanelRightOpen className="size-4" />
        <span className="text-[11px]" style={{ writingMode: "vertical-rl" }}>
          大纲
        </span>
      </button>
    );
  }

  return (
    <aside className="bg-muted/40 flex w-60 shrink-0 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-muted-foreground text-xs font-medium">大纲</span>
        <button
          onClick={() => setCollapsed(true)}
          title="收起大纲"
          className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1 transition-colors"
        >
          <PanelRightClose className="size-4" />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-1.5">
        {headings.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-xs">
            暂无标题。输入 <code>#</code> 或用斜杠菜单插入标题。
          </p>
        ) : (
          headings.map((heading) => (
            <button
              key={heading.pos}
              onClick={() => jumpTo(heading.pos)}
              className={cn(
                "hover:bg-accent block w-full cursor-pointer truncate rounded px-2 py-1 text-left text-xs leading-5 transition-colors",
                activePos === heading.pos
                  ? "bg-accent text-accent-foreground font-medium"
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
    </aside>
  );
}
