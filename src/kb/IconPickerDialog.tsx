import { useEffect, useMemo, useState } from "react";
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
import { TREE_ICON_GROUPS, TREE_ICONS, treeIconLabel } from "./tree-icons";

interface IconPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetName: string;
  targetIcon: string | null;
  onSelect: (icon: string | null) => void;
}

/**
 * 目录树内置图标选择器:所有分组同页展示;
 * 左侧小分组名 + 右侧 12 列紧凑网格,避免旧版 7/8 列导致的信息密度过低。
 */
export function IconPickerDialog({
  open,
  onOpenChange,
  targetName,
  targetIcon,
  onSelect,
}: IconPickerDialogProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open, targetName]);

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? TREE_ICONS.filter((icon) =>
          [icon.id, icon.label, icon.group, ...icon.keywords]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : TREE_ICONS;
    return TREE_ICON_GROUPS.map((group) => ({
      group,
      icons: matched.filter((icon) => icon.group === group),
    })).filter((g) => g.icons.length > 0);
  }, [query]);

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
          />
        </div>

        <div className="border-border-subtle max-h-[54vh] overflow-y-auto rounded-lg border p-2">
          {visibleGroups.length ? (
            visibleGroups.map(({ group, icons }) => (
              <section
                key={group}
                className="flex items-center gap-2 border-border-subtle/70 border-b py-1.5 last:border-b-0 last:pb-0 first:pt-0"
              >
                <span className="text-muted-foreground w-11 shrink-0 text-right text-[10px] leading-7">
                  {group}
                </span>
                <div className="grid min-w-0 flex-1 grid-cols-[repeat(14,minmax(0,1fr))] gap-1">
                  {icons.map(({ id, label, Icon }) => {
                    const selected = targetIcon === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-pressed={selected}
                        className={cn(
                          "hover:bg-hover text-muted-foreground hover:text-foreground flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors",
                          selected && "bg-primary/10 text-primary ring-primary/30 ring-1",
                        )}
                        onClick={() => {
                          onSelect(id);
                          onOpenChange(false);
                        }}
                      >
                        <Icon className="size-4" />
                      </button>
                    );
                  })}
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
                onSelect(null);
                onOpenChange(false);
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
