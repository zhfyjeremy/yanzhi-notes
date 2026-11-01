import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";

/**
 * 当前文档标签(6.3-2):标签只存 meta,不进正文。
 * 添加入口收进浮层:可搜索/复用全库标签、查看使用次数、新建或批量输入;
 * 常驻区只展示当前文档 chips,避免右栏被表单化输入框挤占。
 */

interface TagsPanelProps {
  tags: string[];
  /** 全库标签,供添加浮层复用,减少同义/大小写碎片 */
  allTags: string[];
  tagCounts: Record<string, number>;
  /** 点击标签 = 筛选目录树;null = 清除筛选 */
  onFilter: (tag: string | null) => void;
  activeFilter: string | null;
  /** 一次一批追加(逗号/分号分隔拆好;批量单调用,避免多次追加互相覆盖) */
  onAdd: (tags: string[]) => void;
  onRemove: (tag: string) => void;
}

const splitTags = (raw: string): string[] => {
  const out: string[] = [];
  for (const part of raw.split(/[,，;；]/)) {
    const tag = part.trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
};

export function TagsPanel({
  tags,
  allTags,
  tagCounts,
  onFilter,
  activeFilter,
  onAdd,
  onRemove,
}: TagsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => new Set(tags), [tags]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = useMemo(
    () =>
      allTags.filter((tag) => !normalizedQuery || tag.toLocaleLowerCase().includes(normalizedQuery)),
    [allTags, normalizedQuery],
  );
  const exactExists = allTags.some((tag) => tag.toLocaleLowerCase() === normalizedQuery);
  const canCreate = query.trim().length > 0 && !exactExists;
  const optionCount = matches.length + Number(canCreate);

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery, open]);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const toggle = (tag: string) => {
    if (selected.has(tag)) onRemove(tag);
    else onAdd([tag]);
  };

  const create = () => {
    const value = query.trim();
    if (!value) return;
    onAdd([value]);
    setQuery("");
  };

  const commitQuery = () => {
    const values = splitTags(query);
    if (values.length > 1) {
      onAdd(values.filter((tag) => !selected.has(tag)));
      setQuery("");
      return;
    }

    const index = Math.min(activeIndex, Math.max(optionCount - 1, 0));
    if (index < matches.length) {
      toggle(matches[index]);
      return;
    }
    if (canCreate) create();
  };

  const addTrigger = (className?: string) => (
    <button
      type="button"
      aria-label="添加标签"
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-hover flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md",
        className,
      )}
      onClick={() => setOpen(true)}
    >
      <Plus className="size-3.5" />
    </button>
  );

  return (
    <section className="border-border-subtle flex shrink-0 flex-col border-b">
      <Popover open={open} onOpenChange={setOpen}>
        <header className="flex h-10 shrink-0 items-center gap-1 px-3">
          <button
            className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold tracking-[0.03em]"
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? (
              <ChevronRight className="size-3.5 shrink-0" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
            标签
          </button>
          {tags.length > 0 && (
            <span className="bg-selection text-primary ring-primary/15 rounded-full px-1.5 text-[10px] leading-4 ring-1">
              {tags.length}
            </span>
          )}
        </header>

        {!collapsed && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
            {tags.length === 0 && (
              <span className="text-muted-foreground py-0.5 text-xs">暂无标签</span>
            )}
            {tags.map((tag) => {
              const active = activeFilter === tag;
              return (
                <span
                  key={tag}
                  className={cn(
                    "inline-flex max-w-full items-center rounded-full border py-0.5 pr-0.5 pl-2 text-[11px] leading-4",
                    active
                      ? "border-primary/35 bg-selection text-primary"
                      : "border-border-subtle bg-raised/60 text-foreground/80 hover:border-primary/30",
                  )}
                >
                  <button
                    className="cursor-pointer truncate py-0.5"
                    title={active ? "清除筛选" : "按此标签筛选目录树"}
                    onClick={() => onFilter(active ? null : tag)}
                  >
                    #{tag}
                  </button>
                  <button
                    aria-label={`移除标签 ${tag}`}
                    className="text-muted-foreground hover:bg-hover hover:text-foreground ml-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full"
                    title="移除标签"
                    onClick={() => onRemove(tag)}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            <PopoverAnchor asChild>
              {addTrigger(
                "size-6 rounded-full border border-dashed border-border-subtle hover:border-primary/30",
              )}
            </PopoverAnchor>
          </div>
        )}

        <PopoverContent align="end" sideOffset={6} className="w-64 gap-0 p-2">
          <div className="text-muted-foreground mb-1.5 px-1 text-[11px] font-semibold tracking-[0.03em]">
            添加标签
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, Math.max(optionCount - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                commitQuery();
              }
            }}
            placeholder="搜索或新建标签…"
            className="border-border-subtle bg-raised mb-1 h-8 w-full rounded-md border px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring"
          />
          <div className="max-h-56 overflow-y-auto">
            {optionCount === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-center text-xs">没有匹配的标签</p>
            ) : (
              <>
                {matches.map((tag, i) => {
                  const isSelected = selected.has(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={cn(
                        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-xs",
                        i === activeIndex ? "bg-selection" : "hover:bg-hover",
                      )}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => toggle(tag)}
                    >
                      <Tag className="text-muted-foreground size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">#{tag}</span>
                      <span className="text-muted-foreground text-[10px] tabular-nums">
                        {tagCounts[tag] ?? 0}
                      </span>
                      {isSelected && <Check className="text-primary size-3.5 shrink-0" />}
                    </button>
                  );
                })}
                {canCreate && (
                  <button
                    type="button"
                    className={cn(
                      "border-border-subtle mt-1 flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-dashed px-2 text-left text-xs",
                      activeIndex === matches.length ? "bg-selection" : "hover:bg-hover",
                    )}
                    onMouseEnter={() => setActiveIndex(matches.length)}
                    onClick={create}
                  >
                    <Plus className="text-primary size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">创建「{query.trim()}」</span>
                    <kbd className="text-muted-foreground text-[10px]">↩</kbd>
                  </button>
                )}
              </>
            )}
          </div>
          <p className="text-muted-foreground/70 mt-1.5 px-1 text-[10px]">
            支持逗号或分号批量添加;点击已选标签可移除
          </p>
        </PopoverContent>
      </Popover>
    </section>
  );
}
