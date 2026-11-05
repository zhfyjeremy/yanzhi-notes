import { useEffect, useRef, useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * 斜杠 `/` 插入面板的菜单视图(纯渲染)。
 * 键盘导航与过滤在 suggestion 扩展侧(src/editor/slash-command/index.ts),
 * 这里按 group 分组展示、高亮当前选中项,并承担二级菜单的 hover 展开。
 */

export interface SlashCommandDef {
  group: "文本" | "插入" | "卡片" | "AI";
  label: string;
  icon: LucideIcon;
  /** 模糊搜索关键词(中文 label + 拼音/英文) */
  keywords: string[];
  action: (editor: import("@tiptap/core").Editor, range: import("@tiptap/core").Range) => void;
}

export interface SlashSubmenuDef {
  id: string;
  group: SlashCommandDef["group"];
  label: string;
  icon: LucideIcon;
  children: SlashCommandDef[];
}

export type SlashMenuNode =
  | { kind: "item"; item: SlashCommandDef }
  | { kind: "submenu" } & SlashSubmenuDef;

const GROUPS = ["文本", "插入", "卡片", "AI"] as const;

/** 键盘导航顺序:菜单渲染也必须按这个扁平化结果写 data-index */
export function flattenSlashMenuNodes(nodes: SlashMenuNode[]): SlashMenuNode[] {
  return GROUPS.flatMap((group) =>
    nodes.filter((node) => (node.kind === "item" ? node.item.group : node.group) === group),
  );
}

export function SlashMenu({
  nodes,
  selectedIndex,
  selectedRootIndex,
  openCategory,
  onPick,
  onOpenCategory,
  onHoverIndex,
}: {
  nodes: SlashMenuNode[];
  /** 未开二级 = 根层当前项;已开二级 = 子菜单当前项 */
  selectedIndex: number;
  /** 二级打开时仍保留并高亮根层父项,ArrowLeft 返回到原父项 */
  selectedRootIndex: number;
  openCategory: string | null;
  /** 鼠标点击直接执行该项(键盘 Enter 走 onKeyDown) */
  onPick: (item: SlashCommandDef) => void;
  onOpenCategory: (id: string, rootIndex: number) => void;
  onHoverIndex: (index: number, scope: "root" | "child") => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenuPos, setSubmenuPos] = useState({
    top: 0,
    maxHeight: 320,
    side: "right" as "left" | "right",
  });
  const orderedNodes = flattenSlashMenuNodes(nodes);
  const openNode = orderedNodes.find(
    (node): node is { kind: "submenu" } & SlashSubmenuDef =>
      node.kind === "submenu" && node.id === openCategory,
  );

  // 键盘导航时选中项保持在可视区
  useEffect(() => {
    menuRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // 子菜单与主菜单同视觉体系,但不能放进滚动容器内,否则会被 overflow 裁掉
  useEffect(() => {
    if (!openNode) return;
    const row = menuRef.current?.querySelector(`[data-submenu-id="${openNode.id}"]`);
    const menu = menuRef.current;
    if (!(row instanceof HTMLElement) || !menu) return;
    const rowRect = row.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const side = menuRect.right + 236 <= window.innerWidth ? "right" : "left";
    const below = window.innerHeight - rowRect.top - 8;
    setSubmenuPos({
      top: rowRect.top - menuRect.top,
      maxHeight: Math.max(120, Math.min(320, below)),
      side,
    });
  }, [openNode?.id]);

  // 过滤无结果时整体隐藏(避免 URL/日期等场景弹出空框)
  if (!nodes.length) return null;

  let indexCursor = -1;

  return (
    <div ref={menuRef} className="relative">
      <div className="chrome-float text-foreground max-h-80 w-60 overflow-y-auto rounded-lg border border-border-subtle bg-raised p-1 shadow-md ring-0">
        {GROUPS.map((group) => {
          const groupNodes = orderedNodes.filter((node) => (node.kind === "item" ? node.item.group : node.group) === group);
          if (!groupNodes.length) return null;
          return (
            <div key={group} className="mb-0.5">
              <div className="text-muted-foreground px-2 py-1 text-[10px] font-medium">{group}</div>
              {groupNodes.map((node) => {
                indexCursor += 1;
                const index = indexCursor;
                const selected =
                  index === (openNode ? selectedRootIndex : selectedIndex);
                if (node.kind === "item") {
                  return (
                    <div
                      key={node.item.label}
                      data-index={index}
                      onClick={() => onPick(node.item)}
                      onMouseEnter={() => onHoverIndex(index, "root")}
                      className={
                        selected
                          ? "bg-hover text-foreground flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
                          : "hover:bg-hover flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
                      }
                      data-selected={selected}
                    >
                      <node.item.icon className="text-muted-foreground size-3.5" />
                      {node.item.label}
                    </div>
                  );
                }

                return (
                  <div
                    key={node.id}
                    data-index={index}
                    data-submenu-id={node.id}
                    onClick={() => onOpenCategory(node.id, index)}
                    onMouseEnter={() => onOpenCategory(node.id, index)}
                    className={
                      openNode?.id === node.id || selected
                        ? "bg-hover text-foreground flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
                        : "hover:bg-hover flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
                    }
                    data-selected={selected}
                  >
                    <node.icon className="text-muted-foreground size-3.5" />
                    <span className="min-w-0 flex-1">{node.label}</span>
                    <ChevronRight className="text-muted-foreground ml-auto size-3.5" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {openNode ? (
        <div
          className="chrome-float text-foreground absolute z-50 max-h-80 w-56 overflow-y-auto rounded-lg border border-border-subtle bg-raised p-1 shadow-md ring-0"
          style={{
            top: submenuPos.top,
            maxHeight: submenuPos.maxHeight,
            left: submenuPos.side === "right" ? "100%" : undefined,
            right: submenuPos.side === "left" ? "100%" : undefined,
            marginLeft: submenuPos.side === "right" ? 4 : undefined,
            marginRight: submenuPos.side === "left" ? 4 : undefined,
          }}
        >
          {openNode.children.map((item, index) => (
            <div
              key={item.label}
              data-index={index}
              onClick={() => onPick(item)}
              onMouseEnter={() => onHoverIndex(index, "child")}
              className={
                openNode && index === selectedIndex
                  ? "bg-hover text-foreground flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
                  : "hover:bg-hover flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]"
              }
              data-selected={index === selectedIndex}
            >
              <item.icon className="text-muted-foreground size-3.5" />
              {item.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
