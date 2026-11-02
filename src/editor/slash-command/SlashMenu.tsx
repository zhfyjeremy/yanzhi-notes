import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * 斜杠 `/` 插入面板的菜单视图(纯渲染)。
 * 键盘导航与过滤在 suggestion 扩展侧(src/editor/slash-command/index.ts),
 * 这里只按 group 分组展示 + 高亮当前选中项。
 */

export interface SlashCommandDef {
  group: "文本" | "卡片" | "AI";
  label: string;
  icon: LucideIcon;
  /** 模糊搜索关键词(中文 label + 拼音/英文) */
  keywords: string[];
  action: (editor: import("@tiptap/core").Editor, range: import("@tiptap/core").Range) => void;
}

const GROUPS = ["文本", "卡片", "AI"] as const;

/** 菜单展示顺序(分组渲染):键盘导航与点击必须共用同一顺序 */
export function flattenSlashItems(items: SlashCommandDef[]): SlashCommandDef[] {
  return GROUPS.flatMap((group) => items.filter((item) => item.group === group));
}

export function SlashMenu({
  items,
  selectedIndex,
  onPick,
}: {
  items: SlashCommandDef[];
  selectedIndex: number;
  /** 鼠标点击直接执行该项(键盘 Enter 走 onKeyDown) */
  onPick: (item: SlashCommandDef) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 键盘导航时选中项保持在可视区
  useEffect(() => {
    menuRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // 过滤无结果时整体隐藏(避免 URL/日期等场景弹出空框)
  if (!items.length) return null;

  let indexCursor = -1;

  return (
    <div
      ref={menuRef}
      className="bg-popover text-popover-foreground max-h-80 w-60 overflow-y-auto rounded-lg p-1 shadow-md ring-1 ring-foreground/10"
    >
      {GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (!groupItems.length) return null;
        return (
          <div key={group} className="mb-0.5">
            <div className="text-muted-foreground px-2 py-1 text-xs font-medium">
              {group}
            </div>
            {groupItems.map((item) => {
              indexCursor += 1;
              const index = indexCursor;
              return (
                <div
                  key={item.label}
                  data-index={index}
                  onClick={() => onPick(item)}
                  className={
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                      : "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  }
                  data-selected={index === selectedIndex}
                >
                  <item.icon className="text-muted-foreground size-4" />
                  {item.label}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
