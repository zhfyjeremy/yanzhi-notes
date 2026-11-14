import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Search, type LucideIcon } from "lucide-react";
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
import { TREE_ICON_GROUPS, TREE_ICONS, treeIconLabel } from "./tree-icons";

interface IconPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetName: string;
  targetIcon: string | null;
  onSelect: (icon: string | null) => void;
}

/** 预拼搜索串,避免每次过滤再 join/toLowerCase 一百多次 */
const ICON_ENTRIES = TREE_ICONS.map((icon) => ({
  ...icon,
  haystack: [icon.id, icon.label, icon.group, ...icon.keywords].join(" ").toLowerCase(),
}));

const IconCell = memo(function IconCell({
  id,
  label,
  Icon,
  selected,
  onPick,
}: {
  id: string;
  label: string;
  Icon: LucideIcon;
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
        "hover:bg-hover text-muted-foreground hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-md",
        selected && "bg-primary/10 text-primary ring-primary/30 ring-1",
      )}
      onClick={() => onPick(id)}
    >
      <Icon className="size-4" />
    </button>
  );
});

/**
 * 目录树内置图标选择器:所有分组同页展示;
 * 左侧小分组名 + 右侧 14 列紧凑网格。
 * Windows WebView2 上一次挂 100+ Lucide SVG 很贵,所以先画空壳再延后挂网格;
 * 网格区用固定高度,避免矮壳居中后再被内容撑高、看起来像从下面挪到中间。
 * 选中后由外层先关弹窗再写 meta,避免关窗与整棵树重渲抢同一帧。
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
  const [gridReady, setGridReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setGridReady(false);
      return;
    }
    // 等右键菜单退场 + Dialog 壳先上屏,再挂图标网格
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setGridReady(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, targetName]);

  const visibleGroups = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matched = q ? ICON_ENTRIES.filter((icon) => icon.haystack.includes(q)) : ICON_ENTRIES;
    return TREE_ICON_GROUPS.map((group) => ({
      group,
      icons: matched.filter((icon) => icon.group === group),
    })).filter((g) => g.icons.length > 0);
  }, [deferredQuery]);

  const pickIcon = useCallback(
    (id: string) => {
      onOpenChange(false);
      onSelect(id);
    },
    [onOpenChange, onSelect],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 p-4 sm:max-w-[600px]">
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
            disabled={!gridReady}
          />
        </div>

        <div className="border-border-subtle h-[min(54vh,420px)] overflow-y-auto rounded-lg border p-2 [content-visibility:auto]">
          {!gridReady ? (
            <p className="text-muted-foreground flex h-full min-h-full items-center justify-center text-xs">
              加载图标…
            </p>
          ) : visibleGroups.length ? (
            visibleGroups.map(({ group, icons }) => (
              <section
                key={group}
                className="flex items-center gap-2 border-border-subtle/70 border-b py-1.5 last:border-b-0 last:pb-0 first:pt-0 [content-visibility:auto] [contain-intrinsic-size:auto_40px]"
              >
                <span className="text-muted-foreground w-11 shrink-0 text-right text-[10px] leading-7">
                  {group}
                </span>
                <div className="grid min-w-0 flex-1 grid-cols-[repeat(14,minmax(0,1fr))] gap-1">
                  {icons.map(({ id, label, Icon }) => (
                    <IconCell
                      key={id}
                      id={id}
                      label={label}
                      Icon={Icon}
                      selected={targetIcon === id}
                      onPick={pickIcon}
                    />
                  ))}
                </div>
              </section>
            ))
          ) : (
            <p className="text-muted-foreground flex h-28 items-center justify-center text-xs">
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
  );
}
