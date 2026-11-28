import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  FilePlus2,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import type { DocTab } from "./doc-tabs";
import { treeIconComponent } from "./tree-icons";
import type { SaveState } from "./useKb";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 浏览器式文档标签页。tab 只是路径引用;唯一编辑器实例仍由 App/YanzhiEditor 持有,
 * 切换时由 useKb 先保存再加载,因此非 active tab 不需要独立 dirty 状态。
 */

const baseName = (rel: string) => rel.split("/").pop()?.replace(/\.md$/i, "") ?? rel;
const parentName = (rel: string) =>
  rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";

function SaveGlyph({ state }: { state: SaveState }) {
  if (state === "saving")
    return <Loader2 className="text-primary size-3 shrink-0 animate-spin" aria-label="保存中" />;
  if (state === "error")
    return <CircleAlert className="text-destructive size-3 shrink-0" aria-label="保存失败" />;
  if (state === "dirty") return <span className="bg-primary size-1.5 rounded-full" aria-label="未保存" />;
  return null;
}
function TabIcon({
  iconId,
  active,
  className = "size-3.5",
}: {
  iconId: string | undefined;
  active: boolean;
  className?: string;
}) {
  const CustomIcon = treeIconComponent(iconId);
  const iconClass = `${className} shrink-0`;
  if (CustomIcon) return <CustomIcon className={iconClass} aria-hidden />;
  return (
    <FileText
      className={active ? `text-primary ${iconClass}` : `${iconClass} opacity-70`}
      aria-hidden
    />
  );
}

export interface DocTabsProps {
  tabs: DocTab[];
  activeId: string | null;
  names: Map<string, string>;
  /** 文件/文档 → 目录树自定义图标 ID;未知/无偏好回退文档图标 */
  icons: Map<string, string>;
  saveState: SaveState;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseLeft: (id: string) => void;
  onCloseRight: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onReveal: (rel: string) => void;
}

export function DocTabs({
  tabs,
  activeId,
  names,
  icons,
  saveState,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseLeft,
  onCloseRight,
  onReorder,
  onReveal,
}: DocTabsProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // tab 被下拉列表/目录树/快捷键激活,或开库恢复标签页时,横向滚到完全可见。
  // 手动算边界而不是 scrollIntoView:inline nearest,避免意外带动页面纵向滚动。
  // 初始恢复要等一轮布局/字体加载后再补滚,否则 scrollWidth 仍旧会裁掉当前 tab。
  const scrollActiveTabIntoView = useCallback(() => {
    const strip = stripRef.current;
    const tab = activeTabRef.current;
    if (!strip || !tab) return;
    const stripRect = strip.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const hiddenLeft = tabRect.left < stripRect.left - 1;
    const hiddenRight = tabRect.right > stripRect.right + 1;
    if (!hiddenLeft && !hiddenRight) return;
    const delta = hiddenLeft
      ? tabRect.left - stripRect.left
      : tabRect.right - stripRect.right;
    strip.scrollTo({ left: strip.scrollLeft + delta, behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollActiveTabIntoView();
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      scrollActiveTabIntoView();
      secondFrame = window.requestAnimationFrame(scrollActiveTabIntoView);
    });
    const timer = window.setTimeout(scrollActiveTabIntoView, 120);
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(timer);
    };
  }, [activeId, tabs, scrollActiveTabIntoView]);

  const wheelToHorizontal = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    el.scrollLeft += event.deltaY;
  };

  return (
    <div className="border-border-subtle bg-workspace/35 flex h-10 shrink-0 items-stretch gap-1 border-b px-2 pt-1.5">
      <div
        ref={stripRef}
        className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={wheelToHorizontal}
        role="tablist"
        aria-label="打开的文档"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const label = names.get(tab.path) ?? baseName(tab.path);
          const dir = parentName(tab.path);
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  ref={active ? activeTabRef : undefined}
                  aria-selected={active}
                  draggable
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", tab.path);
                  }}
                  onDragOver={(event) => {
                    if (dragIndex == null || dragIndex === index) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setOverIndex(index);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragIndex != null && dragIndex !== index) onReorder(dragIndex, index);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onClick={() => onActivate(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      onClose(tab.id);
                    }
                  }}
                  title={tab.path}
                  className={cn(
                    "group/tab relative flex h-8 min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-lg border border-b-0 px-2 text-left text-xs transition-colors outline-none",
                    active
                      ? "border-transparent bg-selection text-foreground shadow-sm after:absolute after:inset-x-3 after:-bottom-[4px] after:h-[2px] after:rounded-full after:bg-primary after:content-['']"
                      : "border-transparent text-muted-foreground hover:bg-hover/65 hover:text-foreground",
                    dragIndex === index && "opacity-55",
                    overIndex === index && dragIndex !== index && "border-primary/40",
                  )}
                >
                  <TabIcon iconId={icons.get(tab.path)} active={active} />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {active && <SaveGlyph state={saveState} />}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`关闭 ${label}`}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover/tab:opacity-100 focus-visible:opacity-100",
                      active && "opacity-70",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      onClose(tab.id);
                    }}
                  >
                    <X className="size-3" />
                  </span>
                  {dir && (
                    <span className="text-muted-foreground/65 sr-only">{dir}</span>
                  )}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => onClose(tab.id)}>
                  <X /> 关闭标签页
                </ContextMenuItem>
                <ContextMenuItem disabled={tabs.length <= 1} onClick={() => onCloseOthers(tab.id)}>
                  <X /> 关闭其他标签页
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={index <= 0}
                  onClick={() => onCloseLeft(tab.id)}
                >
                  <X /> 关闭左侧标签页
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={index >= tabs.length - 1}
                  onClick={() => onCloseRight(tab.id)}
                >
                  <X /> 关闭右侧标签页
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => void navigator.clipboard?.writeText(tab.path)}>
                  <FileText /> 复制文档路径
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onReveal(tab.path)}>
                  <FileText /> 在文件管理器中显示
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="列出所有标签页"
            disabled={tabs.length < 2}
            className="text-muted-foreground hover:text-foreground hover:bg-hover mb-1 size-7 shrink-0 rounded-md"
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <DropdownMenuItem key={tab.id} onClick={() => onActivate(tab.id)}>
                {active ? (
                  <Check className="text-primary size-4" />
                ) : (
                  <TabIcon iconId={icons.get(tab.path)} active={false} className="size-4" />
                )}
                <span className="min-w-0 flex-1 truncate">{names.get(tab.path) ?? baseName(tab.path)}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function DocTabsEmptyState({
  recentDocs,
  onCreateDoc,
  onOpenDoc,
}: {
  recentDocs: { path: string; name: string; dir: string }[];
  onCreateDoc: () => void;
  onOpenDoc: (rel: string) => void;
}) {
  // 过渡态而非落地页:用户最可能「接着写最近那篇」,最近文档升为主内容,
  // 去掉图标方块 + 居中英雄段的通用空状态壳子,只留「新建文档」一处主色。
  const recents = recentDocs.slice(0, 5);
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto p-8">
      <div className="m-auto w-full max-w-md">
        <h2 className="text-foreground text-xl font-medium">没有打开的文档</h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-5">
          新建一篇,或从最近打开的文档继续。
        </p>
        <Button size="sm" className="mt-4" onClick={onCreateDoc}>
          <FilePlus2 className="size-4" />
          新建文档
        </Button>

        {recents.length > 0 && (
          <ul
            aria-label="最近打开的文档"
            className="divide-border-subtle border-border-subtle -mx-2 mt-6 divide-y border-t"
          >
            {recents.map((doc) => (
              <li key={doc.path}>
                <button
                  type="button"
                  title={doc.name}
                  className="hover:bg-hover focus-visible:bg-hover flex w-full cursor-pointer items-center gap-2.5 px-2 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => onOpenDoc(doc.path)}
                >
                  <FileText className="text-muted-foreground/80 size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{doc.name}</span>
                  <span className="text-muted-foreground/70 max-w-[38%] shrink-0 truncate text-[11px]">
                    {doc.dir || "根目录"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
