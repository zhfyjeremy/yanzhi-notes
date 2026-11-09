import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/hint";

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchActive, setSearchActive] = useState(0);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const visibleHeadings = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return q
      ? headings.filter((heading) =>
          (heading.text || "无标题").toLocaleLowerCase().includes(q),
        )
      : headings;
  }, [headings, query]);

  useEffect(() => {
    setSearchActive((i) => Math.min(i, Math.max(visibleHeadings.length - 1, 0)));
  }, [visibleHeadings.length]);

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

  // 长文档滚动时让当前标题始终留在右栏可视区,避免高亮项滚出面板
  useEffect(() => {
    if (activePos === null) return;
    itemRefs.current.get(activePos)?.scrollIntoView({ block: "nearest" });
  }, [activePos]);

  const jumpTo = (pos: number) => {
    if (editor.isDestroyed || !editor.view) return;
    editor.chain().focus().setTextSelection(pos + 1).run();
    if (!scrollContainer) return;
    const dom = editor.view.domAtPos(pos + 1);
    const el = dom.node.nodeType === 1 ? (dom.node as HTMLElement) : dom.node.parentElement;
    if (!el) return;
    window.requestAnimationFrame(() => {
      const top =
        scrollContainer.scrollTop +
        el.getBoundingClientRect().top -
        scrollContainer.getBoundingClientRect().top -
        16;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      scrollContainer.scrollTo({ top: Math.max(0, top), behavior });
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    setSearchActive(0);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center justify-between px-3">
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
        {headings.length > 0 && (
          <Hint label={searchOpen ? "关闭大纲搜索" : "搜索大纲"}>
            <button
              type="button"
              aria-label={searchOpen ? "关闭大纲搜索" : "搜索大纲"}
              aria-pressed={searchOpen}
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-hover flex size-6 cursor-pointer items-center justify-center rounded-md",
                searchOpen && "bg-selection text-foreground",
              )}
              onClick={() => {
                if (searchOpen) closeSearch();
                else {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }
              }}
            >
              <Search className="size-3.5" />
            </button>
          </Hint>
        )}
      </header>
      {!collapsed && (
        <>
        {searchOpen && (
          <div className="px-2 pb-1.5">
            <div className="border-border-subtle bg-raised focus-within:border-ring flex h-7 items-center gap-1.5 rounded-md border px-2">
              <Search className="text-muted-foreground size-3 shrink-0" />
              <input
                ref={searchInputRef}
                aria-label="搜索大纲"
                className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
                placeholder="筛选标题…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (query) setQuery("");
                    else closeSearch();
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSearchActive((i) => (i + 1) % Math.max(visibleHeadings.length, 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSearchActive(
                      (i) =>
                        (i - 1 + Math.max(visibleHeadings.length, 1)) %
                        Math.max(visibleHeadings.length, 1),
                    );
                  } else if (e.key === "Enter" && visibleHeadings[searchActive]) {
                    e.preventDefault();
                    jumpTo(visibleHeadings[searchActive].pos);
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="清除大纲搜索"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {headings.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-[11px] leading-5">
              暂无标题。输入 <code>#</code> 或用斜杠菜单插入标题。
            </p>
          ) : visibleHeadings.length === 0 ? (
            <p className="text-muted-foreground px-2 py-4 text-[11px] leading-5">
              没有匹配的标题。
            </p>
          ) : (
          visibleHeadings.map((heading, i) => (
            <button
              key={heading.pos}
              ref={(el) => {
                if (el) itemRefs.current.set(heading.pos, el);
                else itemRefs.current.delete(heading.pos);
              }}
              aria-current={activePos === heading.pos ? "location" : undefined}
              onClick={() => jumpTo(heading.pos)}
              className={cn(
                "hover:bg-hover block w-full cursor-pointer truncate rounded-md px-2 py-1.5 text-left text-xs leading-5 transition-colors",
                activePos === heading.pos
                  ? "bg-raised text-foreground ring-primary/15 font-medium ring-1"
                  : searchOpen && searchActive === i
                    ? "bg-selection text-foreground"
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
        </>
      )}
    </div>
  );
}
