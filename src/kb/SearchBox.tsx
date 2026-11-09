import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock3, Loader2, RotateCcw, Search, Tag, X } from "lucide-react";
import type { SearchHit } from "./search";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setSearchFocusHandler } from "./search-focus";

/**
 * 顶部全局搜索(PRD 5.5):左栏树上方搜索框,输入即搜(标题+正文+路径,标题加权),
 * 结果面板展示路径与命中片段(关键词高亮);点击打开文档;正文有关键词时再定位到首个命中。
 * 无结果提示换关键词或重建索引(索引损坏的自救入口)。
 */

interface SearchBoxProps {
  indexReady: boolean;
  onSearch: (q: string) => SearchHit[];
  onSelect: (rel: string, term: string) => void;
  onRebuild: () => void;
  /** 外部预置搜索词(失效双链「搜索同名文档」等入口);seq 变化触发 */
  preset?: { term: string; seq: number } | null;
  /** 全库标签筛选 */
  tags: string[];
  tagCounts: Record<string, number>;
  activeTag: string | null;
  onTagFilter: (tag: string | null) => void;
  /** ⌘/Ctrl+P 空搜索态展示的最近打开文档(当前知识库) */
  recentDocs: { path: string; name: string; dir: string }[];
}

const DEBOUNCE_MS = 160;

export function SearchBox({
  indexReady,
  onSearch,
  onSelect,
  onRebuild,
  preset,
  tags,
  tagCounts,
  activeTag,
  onTagFilter,
  recentDocs,
}: SearchBoxProps) {
  const [query, setQuery] = useState("");

  // ⌘/Ctrl+P 聚焦搜索框(快捷键在 App 层,信号走模块级 handler 跨层)
  useEffect(() => {
    setSearchFocusHandler(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => setSearchFocusHandler(null);
  }, []);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [tagActive, setTagActive] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const lastPresetSeq = useRef(0);

  const tagOptions = useMemo(() => {
    const q = tagQuery.trim().toLocaleLowerCase();
    const matches = tags.filter((tag) => !q || tag.toLocaleLowerCase().includes(q));
    return [
      ...(!q ? [{ tag: null as string | null }] : []),
      ...matches.map((tag) => ({ tag })),
    ];
  }, [tags, tagQuery]);

  useEffect(() => {
    if (!tagOpen) return;
    setTagActive(0);
  }, [tagOpen, tagQuery]);

  useEffect(() => {
    if (!preset || preset.seq === lastPresetSeq.current) return;
    lastPresetSeq.current = preset.seq;
    setQuery(preset.term);
    setFocused(true);
    inputRef.current?.focus();
  }, [preset]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    timer.current = window.setTimeout(() => {
      setHits(onSearch(q));
      setActive(0);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [query, onSearch]);

  const hasQuery = query.trim().length > 0;
  const open = focused && (hasQuery || recentDocs.length > 0);
  const visibleItems = hasQuery ? hits : recentDocs;

  useEffect(() => {
    if (focused) setActive(0);
  }, [focused, query, recentDocs]);

  const openHit = (hit: SearchHit) => {
    // 标题/路径命中但正文未命中:只打开文档,不把关键词传给文档内查找。
    onSelect(hit.path, hit.contentMatched ? query.trim() : "");
    setQuery("");
    setFocused(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const openRecent = (item: { path: string }) => {
    onSelect(item.path, "");
    setQuery("");
    setFocused(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const selectTag = (tag: string | null) => {
    onTagFilter(tag);
    setTagOpen(false);
  };

  return (
    <div className="relative px-2.5 pt-0.5 pb-2">
      <div className="flex items-center gap-1.5">
        <div className="chrome-search focus-within:border-ring border-border-subtle bg-raised flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_5%,transparent)]">
          {indexReady ? (
            <Search className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
          )}
          <input
            ref={inputRef}
            aria-label="全库搜索"
            className="placeholder:text-muted-foreground/70 h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
            placeholder="搜索文档…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setQuery("");
                setHits([]);
                setFocused(false);
                e.currentTarget.blur();
                return;
              }
              if (!open || !visibleItems.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (i + 1) % visibleItems.length);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => (i - 1 + visibleItems.length) % visibleItems.length);
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (hasQuery) openHit(hits[Math.min(active, hits.length - 1)]);
                else openRecent(recentDocs[Math.min(active, recentDocs.length - 1)]);
              }
            }}
          />
          {query && (
            <Hint label="清除搜索 (Esc)">
              <button
                type="button"
                aria-label="清除搜索"
                className="text-muted-foreground hover:text-foreground hover:bg-hover -mr-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setHits([]);
                  inputRef.current?.focus();
                }}
              >
                <X className="size-3" />
              </button>
            </Hint>
          )}
        </div>
        {(tags.length > 0 || activeTag) && (
          <Popover
            open={tagOpen}
            onOpenChange={(open) => {
              setTagOpen(open);
              if (open) {
                setTagQuery("");
                window.setTimeout(() => tagInputRef.current?.focus(), 0);
              }
            }}
          >
            <Hint label={activeTag ? `筛选标签:#${activeTag}` : "筛选标签"}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="筛选标签"
                  aria-pressed={activeTag !== null}
                  className={cn(
                    "border-border-subtle bg-raised flex h-8 w-9 shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-lg border transition-colors",
                    activeTag
                      ? "bg-selection text-primary border-primary/25"
                      : "text-muted-foreground hover:text-foreground hover:bg-hover",
                  )}
                >
                  <Tag className="size-3.5" />
                  <ChevronDown className="size-2.5 opacity-55" />
                </button>
              </PopoverTrigger>
            </Hint>
            <PopoverContent align="end" sideOffset={6} className="w-56 p-1.5">
              <div className="px-1.5 pt-0.5 pb-1.5 text-[11px] font-semibold tracking-[0.03em]">
                筛选标签
              </div>
              <input
                ref={tagInputRef}
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setTagActive((i) => Math.min(i + 1, tagOptions.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setTagActive((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && tagOptions[tagActive]) {
                    e.preventDefault();
                    selectTag(tagOptions[tagActive].tag);
                  }
                }}
                placeholder="搜索标签…"
                className="border-border-subtle bg-raised mb-1 h-7 w-full rounded-md border px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring"
              />
              <div className="max-h-56 overflow-y-auto">
                {tagOptions.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-3 text-center text-xs">没有匹配的标签</p>
                ) : (
                  tagOptions.map((option, i) => {
                    const isActive = option.tag === activeTag;
                    return (
                      <button
                        key={option.tag ?? "__all__"}
                        type="button"
                        className={cn(
                          "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs",
                          i === tagActive ? "bg-selection" : "hover:bg-hover",
                        )}
                        onMouseEnter={() => setTagActive(i)}
                        onClick={() => selectTag(option.tag)}
                      >
                        <Tag className="text-muted-foreground size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {option.tag === null ? "全部文档" : `#${option.tag}`}
                        </span>
                        {option.tag !== null && (
                          <span className="text-muted-foreground text-[10px] tabular-nums">
                            {tagCounts[option.tag] ?? 0}
                          </span>
                        )}
                        {isActive && <Check className="text-primary size-3.5 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {activeTag && (
        <div className="mt-1.5 flex">
          <span className="border-primary/25 bg-selection text-primary inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4">
            <Tag className="size-3 shrink-0" />
            <span className="truncate">#{activeTag}</span>
            <span className="text-primary/65 text-[10px] tabular-nums">
              {tagCounts[activeTag] ?? 0}
            </span>
            <button
              type="button"
              aria-label="清除标签筛选"
              className="hover:text-foreground ml-0.5 shrink-0 cursor-pointer"
              onClick={() => onTagFilter(null)}
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      )}
      {open && (
        <div className="bg-popover text-popover-foreground border-border-subtle absolute inset-x-2.5 top-[calc(100%-2px)] z-40 max-h-80 overflow-y-auto rounded-lg border shadow-xl">
          {!hasQuery ? (
            <div>
              <div className="text-muted-foreground flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] font-medium tracking-[0.03em]">
                <Clock3 className="size-3" />
                最近打开
              </div>
              <ul className="pb-1">
                {recentDocs.map((item, i) => (
                  <li key={item.path}>
                    <button
                      type="button"
                      className={cn(
                        "block w-full px-2.5 py-1.5 text-left",
                        i === active ? "bg-selection" : "hover:bg-hover",
                      )}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => openRecent(item)}
                    >
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate text-xs font-medium">{item.name}</span>
                        {item.dir && (
                          <span className="text-muted-foreground shrink-0 text-[10px]">
                            {item.dir}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : !indexReady ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-xs">索引构建中,稍候再搜…</p>
          ) : hits.length === 0 ? (
            <div className="px-3 py-4 text-center">
              <p className="text-muted-foreground text-xs">没有找到相关文档,换个关键词试试</p>
              <button
                className="text-foreground/80 hover:bg-accent mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onRebuild}
              >
                <RotateCcw className="size-3" /> 重建索引
              </button>
            </div>
          ) : (
            <ul className="py-1">
              {hits.map((hit, i) => (
                <li key={hit.path}>
                  <button
                    className={cn(
                      "block w-full px-2.5 py-1.5 text-left",
                      i === active ? "bg-selection" : "hover:bg-hover",
                    )}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => openHit(hit)}
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-xs font-medium">{hit.name}</span>
                      {hit.dir && (
                        <span className="text-muted-foreground shrink-0 text-[10px]">{hit.dir}</span>
                      )}
                    </span>
                    {hit.snippet.length > 0 && (
                      <span className="text-muted-foreground mt-0.5 block truncate text-[11px] leading-4">
                        {hit.snippet.map((seg, j) =>
                          seg.hit ? (
                            <mark key={j} className="bg-primary/15 text-foreground rounded-[2px] px-px">
                              {seg.text.replace(/\s+/g, " ")}
                            </mark>
                          ) : (
                            <span key={j}>{seg.text.replace(/\s+/g, " ")}</span>
                          ),
                        )}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
