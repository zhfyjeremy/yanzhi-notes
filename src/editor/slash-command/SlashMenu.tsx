import { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 斜杠 `/` 插入面板的菜单视图。
 * 键盘导航与过滤在 suggestion 扩展侧;展示用 DropdownMenu,
 * 二级菜单的贴边翻转和悬停桥交给 Radix,不再自绘绝对定位。
 * 编辑器必须保住焦点,`/` 后的过滤字符才能继续输入,所以菜单非模态且不抢焦点。
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

/** Radix 悬停会把焦点送进菜单项。嵌套在 focus 事件里立刻还焦点会被浏览器丢掉,放到下一帧 */
function keepEditorFocus() {
  requestAnimationFrame(() => {
    const editor = document.querySelector(".ProseMirror");
    if (editor instanceof HTMLElement && document.activeElement !== editor) {
      editor.focus({ preventScroll: true });
    }
  });
}

/** 键盘导航顺序:菜单渲染也必须按这个扁平化结果编号 */
export function flattenSlashMenuNodes(nodes: SlashMenuNode[]): SlashMenuNode[] {
  return GROUPS.flatMap((group) =>
    nodes.filter((node) => (node.kind === "item" ? node.item.group : node.group) === group),
  );
}

export function SlashMenu({
  nodes,
  anchor,
  selectedIndex,
  selectedRootIndex,
  openCategory,
  onPick,
  onOpenCategory,
  onCloseCategory,
  onHoverIndex,
  onMenuKeyDown,
  onDismiss,
}: {
  nodes: SlashMenuNode[];
  /** 光标所在行,DropdownMenu 以此为锚点 */
  anchor: { left: number; top: number; height: number };
  /** 未开二级 = 根层当前项;已开二级 = 子菜单当前项 */
  selectedIndex: number;
  /** 二级打开时仍保留并高亮根层父项,ArrowLeft 返回到原父项 */
  selectedRootIndex: number;
  openCategory: string | null;
  /** 鼠标点击直接执行该项(键盘 Enter 走 onMenuKeyDown) */
  onPick: (item: SlashCommandDef) => void;
  onOpenCategory: (id: string, rootIndex: number) => void;
  /** 只关仍打开的那个二级;id 对不上说明已经切到别的分类 */
  onCloseCategory: (id: string) => void;
  onHoverIndex: (index: number, scope: "root" | "child") => void;
  /** 焦点偶尔进菜单时,方向键仍走和编辑器同一套导航 */
  onMenuKeyDown: (event: KeyboardEvent) => boolean;
  onDismiss: () => void;
}) {
  const orderedNodes = flattenSlashMenuNodes(nodes);

  // 键盘导航时选中项保持在可视区。二级在 Portal 里,不能在主菜单里 query
  useEffect(() => {
    if (!nodes.length) return;
    const frame = requestAnimationFrame(() => {
      const scope = openCategory
        ? document.querySelector(`[data-slash-scope="child"][data-slash-category="${openCategory}"]`)
        : document.querySelector('[data-slash-scope="root"]');
      const row = scope?.querySelector(`[data-nav-index="${selectedIndex}"]`);
      if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodes.length, openCategory, selectedIndex]);

  // 过滤无结果时整体隐藏(避免 URL/日期等场景弹出空框)
  if (!nodes.length) return null;

  let indexCursor = -1;
  const rootSelected = (index: number) =>
    index === (openCategory ? selectedRootIndex : selectedIndex);

  return (
    <DropdownMenu open modal={false} onOpenChange={() => {}}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed w-px"
          style={{ left: anchor.left, top: anchor.top, height: anchor.height }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        data-slash-scope="root"
        side="bottom"
        align="start"
        sideOffset={10}
        collisionPadding={8}
        className="!w-60"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onFocus={keepEditorFocus}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!onMenuKeyDown(event.nativeEvent)) onDismiss();
            return;
          }
          if (onMenuKeyDown(event.nativeEvent)) event.preventDefault();
        }}
      >
        {GROUPS.map((group) => {
          const groupNodes = orderedNodes.filter(
            (node) => (node.kind === "item" ? node.item.group : node.group) === group,
          );
          if (!groupNodes.length) return null;
          return (
            <DropdownMenuGroup key={group}>
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              {groupNodes.map((node) => {
                indexCursor += 1;
                const index = indexCursor;
                const selected = rootSelected(index);
                if (node.kind === "item") {
                  return (
                    <DropdownMenuItem
                      key={node.item.label}
                      data-nav-index={index}
                      data-selected={selected}
                      className={selected ? "bg-hover text-foreground" : undefined}
                      onPointerEnter={() => onHoverIndex(index, "root")}
                      onPointerMove={(event) => event.preventDefault()}
                      onSelect={(event) => {
                        event.preventDefault();
                        onPick(node.item);
                      }}
                    >
                      <node.item.icon className="text-muted-foreground" />
                      {node.item.label}
                    </DropdownMenuItem>
                  );
                }

                return (
                  <DropdownMenuSub
                    key={node.id}
                    open={openCategory === node.id}
                    onOpenChange={(next) => {
                      if (next) onOpenCategory(node.id, index);
                      else onCloseCategory(node.id);
                    }}
                  >
                    <DropdownMenuSubTrigger
                      data-nav-index={index}
                      data-selected={selected}
                      className={selected ? "bg-hover text-foreground" : undefined}
                      onPointerEnter={() => onOpenCategory(node.id, index)}
                      onPointerMove={(event) => event.preventDefault()}
                    >
                      <node.icon className="text-muted-foreground" />
                      {node.label}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      data-slash-scope="child"
                      data-slash-category={node.id}
                      collisionPadding={8}
                      // 按最长标签撑开宽度,避免「中文日期和时间…」这类文案折行
                      className="!max-h-80 !w-max !min-w-56 !overflow-y-auto"
                      onInteractOutside={(event) => event.preventDefault()}
                      onPointerDownOutside={(event) => event.preventDefault()}
                      onFocusOutside={(event) => event.preventDefault()}
                      onEscapeKeyDown={(event) => event.preventDefault()}
                      onMouseDown={(event) => event.preventDefault()}
                      onFocus={keepEditorFocus}
                    >
                      {node.children.map((item, childIndex) => {
                        const childSelected = openCategory === node.id && childIndex === selectedIndex;
                        return (
                          <DropdownMenuItem
                            key={item.label}
                            data-nav-index={childIndex}
                            data-selected={childSelected}
                            className={
                              childSelected
                                ? "bg-hover text-foreground whitespace-nowrap"
                                : "whitespace-nowrap"
                            }
                            onPointerEnter={() => onHoverIndex(childIndex, "child")}
                            onPointerMove={(event) => event.preventDefault()}
                            onSelect={(event) => {
                              event.preventDefault();
                              onPick(item);
                            }}
                          >
                            <item.icon className="text-muted-foreground" />
                            {item.label}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              })}
            </DropdownMenuGroup>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
