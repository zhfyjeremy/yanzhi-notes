import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Search } from "lucide-react";
import type { SearchHit } from "./search";
import { cn } from "@/lib/utils";

/**
 * 顶部全局搜索(PRD 5.5):左栏树上方搜索框,输入即搜(标题+正文+路径,标题加权),
 * 结果面板展示路径与命中片段(关键词高亮);点击打开文档并定位到首个命中。
 * 无结果提示换关键词或重建索引(索引损坏的自救入口)。
 */

interface SearchBoxProps {
  indexReady: boolean;
  onSearch: (q: string) => SearchHit[];
  onSelect: (rel: string, term: string) => void;
  onRebuild: () => void;
  /** 外部预置搜索词(失效双链「搜索同名文档」等入口);seq 变化触发 */
  preset?: { term: string; seq: number } | null;
}

const DEBOUNCE_MS = 160;

export function SearchBox({ indexReady, onSearch, onSelect, onRebuild, preset }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPresetSeq = useRef(0);

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

  const open = focused && query.trim().length > 0;
  const openHit = (hit: SearchHit) => {
    onSelect(hit.path, query.trim());
    setQuery("");
    setFocused(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  return (
    <div className="relative px-2 pt-1 pb-1.5">
      <div className="focus-within:border-ring flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2">
        {indexReady ? (
          <Search className="text-muted-foreground size-3.5 shrink-0" />
        ) : (
          <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
        )}
        <input
          ref={inputRef}
          className="placeholder:text-muted-foreground/70 h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
          placeholder="搜索文档…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (!open || !hits.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              openHit(hits[Math.min(active, hits.length - 1)]);
            }
          }}
        />
      </div>
      {open && (
        <div className="bg-popover text-popover-foreground absolute inset-x-2 top-[calc(100%-2px)] z-40 max-h-80 overflow-y-auto rounded-md border border-border shadow-lg">
          {!indexReady ? (
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
                      i === active ? "bg-accent/70" : "hover:bg-accent/50",
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
