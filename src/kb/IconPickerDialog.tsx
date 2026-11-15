import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  TREE_ICON_GROUPS,
  TREE_ICONS,
  TREE_ICON_GLYPHS,
  TreeIconSprite,
  treeIconLabel,
  type TreeIconDef,
  type TreeIconGlyph,
} from "./tree-icons";

interface IconPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetName: string;
  targetIcon: string | null;
  onSelect: (icon: string | null) => void;
}

type IconEntry = TreeIconDef & { haystack: string };
type PickerRow =
  | { kind: "header"; group: string }
  | { kind: "icons"; group: string; icons: IconEntry[] };

/** Windows WebView2 不适合一次挂 100+ SVG;虚拟列表只保留视口附近两行。 */
const ICONS_PER_ROW = 7;
const HEADER_HEIGHT = 30;
const ROW_HEIGHT = 48;
const VIEWPORT_HEIGHT = 420;
const OVERSCAN_ROWS = 1;

/** 预拼搜索串,避免每次过滤都 join/toLowerCase 一百多次 */
const ICON_ENTRIES: IconEntry[] = TREE_ICONS.map((icon) => ({
  ...icon,
  haystack: [icon.id, icon.label, icon.group, ...icon.keywords].join(" ").toLowerCase(),
}));

const IconCell = memo(function IconCell({
  id,
  label,
  glyph,
  selected,
  onPick,
}: {
  id: string;
  label: string;
  glyph: TreeIconGlyph;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "hover:bg-hover text-muted-foreground hover:text-foreground flex size-10 cursor-pointer items-center justify-center rounded-lg",
        selected && "bg-primary/10 text-primary ring-primary/40 ring-1",
      )}
      onClick={() => onPick(id)}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className={cn("size-5", glyph.colorClass)}
        fill={glyph.solid ? "currentColor" : "none"}
        strokeWidth={glyph.solid ? 1.5 : glyph.colorClass ? 2.35 : 2}
      >
        <use href={`#yz-tree-icon-${glyph.shape}`} />
      </svg>
    </button>
  );
});

/**
 * 目录树内置图标选择器。
 *
 * Windows WebView2 滚动时同屏维护过多 SVG 会掉帧。这里改为:
 * - 7 列大图标,减少每行 DOM 数量;
 * - 组头 + 图标行统一固定行高;
 * - 只渲染滚动视口附近 ±1 行,外侧行用上下 spacer 占位。
 */
export function IconPickerDialog({
  open,
  onOpenChange,
  targetName,
  targetIcon,
  onSelect,
}: IconPickerDialogProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);
  const spriteMountedRef = useRef(false);
  if (open) spriteMountedRef.current = true;

  useEffect(() => {
    if (open) return;
    setQuery("");
    setScrollTop(0);
  }, [open]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  const visibleGroups = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matched = q ? ICON_ENTRIES.filter((icon) => icon.haystack.includes(q)) : ICON_ENTRIES;
    return TREE_ICON_GROUPS.map((group) => ({
      group,
      icons: matched.filter((icon) => icon.group === group),
    })).filter((g) => g.icons.length > 0);
  }, [deferredQuery]);

  const rows = useMemo<PickerRow[]>(() => {
    const out: PickerRow[] = [];
    for (const { group, icons } of visibleGroups) {
      out.push({ kind: "header", group });
      for (let i = 0; i < icons.length; i += ICONS_PER_ROW) {
        out.push({ kind: "icons", group, icons: icons.slice(i, i + ICONS_PER_ROW) });
      }
    }
    return out;
  }, [visibleGroups]);

  /** offsets[i] = 第 i 行顶部位置;额外一项用于总高度和切片右边界。 */
  const rowOffsets = useMemo(() => {
    const offsets = new Array<number>(rows.length + 1);
    offsets[0] = 0;
    rows.forEach((row, i) => {
      offsets[i + 1] = offsets[i] + (row.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT);
    });
    return offsets;
  }, [rows]);

  // 搜索结果变化后回到顶部,避免旧 scrollTop 落在新内容的空白 spacer。
  useEffect(() => {
    setScrollTop(0);
  }, [deferredQuery]);

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollTop(target.scrollTop);
    });
  }, []);

  const { startIndex, endIndex, totalHeight } = useMemo(() => {
    let first = 0;
    while (first + 1 < rows.length && rowOffsets[first + 1] <= scrollTop) first++;
    const bottom = scrollTop + VIEWPORT_HEIGHT;
    let last = first;
    while (last < rows.length && rowOffsets[last] < bottom) last++;
    return {
      startIndex: Math.max(0, first - OVERSCAN_ROWS),
      endIndex: Math.min(rows.length, last + OVERSCAN_ROWS),
      totalHeight: rowOffsets[rows.length],
    };
  }, [rowOffsets, rows.length, scrollTop]);

  const pickIcon = useCallback(
    (id: string) => {
      onOpenChange(false);
      onSelect(id);
    },
    [onOpenChange, onSelect],
  );

  return (
    <>
      {/* 只缓存基础形状 sprite,不缓存 Dialog/overlay;关闭弹窗仍会完整卸载遮罩。 */}
      {spriteMountedRef.current ? <TreeIconSprite /> : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="gap-3 p-4 sm:max-w-[520px]"
          overlayClassName="supports-backdrop-filter:backdrop-blur-none"
        >
        <DialogHeader className="gap-1">
          <DialogTitle>更改图标</DialogTitle>
          <DialogDescription className="line-clamp-1">
            为「{targetName}」选择一个内置图标
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索图标"
            className="h-8 pl-8 text-[13px]"
            aria-label="搜索内置图标"
          />
        </div>

        <div
          className="border-border-subtle h-[420px] overflow-y-auto rounded-lg border p-2"
          onScroll={handleScroll}
        >
          {rows.length ? (
            <div className="relative" style={{ height: totalHeight }}>
              {rows.slice(startIndex, endIndex).map((row, visibleIndex) => {
                const rowIndex = startIndex + visibleIndex;
                const top = rowOffsets[rowIndex];
                return row.kind === "header" ? (
                  <div
                    key={`${row.group}-header`}
                    className="text-muted-foreground absolute inset-x-0 flex h-[30px] items-center px-1 text-[11px]"
                    style={{ transform: `translateY(${top}px)`, contain: "layout style paint" }}
                  >
                    {row.group}
                  </div>
                ) : (
                  <div
                    key={`${row.group}-${row.icons[0]?.id}`}
                    className="absolute inset-x-0 grid h-12 grid-cols-[repeat(7,minmax(0,1fr))] gap-x-3 gap-y-0 px-1"
                    style={{ transform: `translateY(${top}px)`, contain: "layout style paint" }}
                  >
                    {row.icons.map(({ id, label }) => (
                      <IconCell
                        key={id}
                        id={id}
                        label={label}
                        glyph={TREE_ICON_GLYPHS.get(id)!}
                        selected={targetIcon === id}
                        onPick={pickIcon}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground flex h-40 items-center justify-center text-xs">
              没有匹配的图标
            </p>
          )}
        </div>

        <DialogFooter className="mt-0 flex-wrap justify-between gap-2 py-2 sm:justify-between">
          <span className="text-muted-foreground min-w-0 truncate text-[11px]">
            当前:{treeIconLabel(targetIcon)}
          </span>
          <span className="flex shrink-0 gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                onOpenChange(false);
                onSelect(null);
              }}
            >
              恢复默认
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          </span>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
