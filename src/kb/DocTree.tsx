import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CheckSquare2,
  Copy,
  FileText,
  FoldVertical,
  FolderOpen,
  FolderPlus,
  House,
  ListChecks,
  MoreHorizontal,
  Palette,
  PenLine,
  Pin,
  Plus,
  Square,
  SquarePen,
  Trash2,
  UnfoldVertical,
} from "lucide-react";
import type { TreeNode } from "./types";
import type { SearchHit } from "./search";
import { SearchBox } from "./SearchBox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/hint";
import { DEFAULT_SIDEBAR_WIDTH } from "../settings";
import { BatchDocActions } from "./BatchDocActions";
import { IconPickerDialog } from "./IconPickerDialog";
import { treeIconComponent } from "./tree-icons";
import { foldersOf, type BatchRenameItem, type BatchResult } from "./batch";

/**
 * 左栏目录树(M3 / PRD 5.1):递归渲染、点击切换文档、当前文档高亮、拖拽排序。
 * 行操作走语雀式两级:文件夹 hover 仅一个「+」下拉(新建文档/子文件夹),
 * 重命名/移动到/删除进右键菜单(删除直接执行,移入回收站可恢复);
 * 重命名 = 行内编辑(Enter 确认 Esc 取消失焦提交);新建文件夹后自动进入重命名并全选默认名。
 * 顶层目录空白处右键 = 在库根新建文档/文件夹(与右上角 + 同口径);行上右键仍走条目菜单。
 * 排序 = meta.sortIndex(拖拽落点重写整组兄弟序);折叠状态持久化进 meta。
 */

const parentOf = (rel: string): string =>
  rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";

/** 当前父目录 / 自身及子树不可作为移动目标 */
function isInvalidMoveDest(src: string, isDir: boolean, dest: string): boolean {
  if (dest === parentOf(src)) return true;
  if (isDir && (dest === src || dest.startsWith(src + "/"))) return true;
  return false;
}

interface DocTreeProps {
  root: string;
  tree: TreeNode[];
  currentPath: string | null;
  collapsed: Set<string>;
  indexReady: boolean;
  onToggleCollapse: (folderRel: string) => void;
  onSetAllCollapsed: (collapsed: boolean) => void;
  /** 文件/文档 → 内置图标 ID;未知 ID 渲染层回退默认 */
  iconMap: Map<string, string>;
  /** 保存图标偏好(null = 恢复默认) */
  onSetEntryIcon: (rel: string, isDir: boolean, icon: string | null) => void;
  onOpenDoc: (rel: string) => void;
  onRevealEntry: (rel: string) => void;
  onCreateDoc: (folderRel: string, title: string) => void;
  /** 返回新建文件夹相对路径;失败 null —— DocTree 用其自动进入重命名 */
  onCreateFolder: (folderRel: string, name: string) => Promise<string | null>;
  onRenameEntry: (rel: string, name: string) => void;
  onRemoveEntry: (rel: string) => void;
  onReorder: (parentRel: string, orderedPaths: string[]) => void;
  /** 拖入文件夹 / 跨组 before-after = 移动(改父目录,5.1 调整层级);
   *  orderedPaths 提供时按其落位,否则目标组落尾 */
  onMoveEntry: (srcRel: string, destFolderRel: string, orderedPaths?: string[]) => void;
  onSearch: (q: string) => SearchHit[];
  onSearchSelect: (rel: string, term: string) => void;
  /** 面包屑点击后展开并滚动到目录;seq 保证重复点击同一目录也生效 */
  revealFolder?: { path: string; seq: number } | null;
  recentDocs: { path: string; name: string; dir: string }[];
  /** 目标是否可安全编码为 [[…]];标题/路径含双链语法不兼容字符时禁用菜单 */
  canCopyWikiRef: (rel: string) => boolean;
  /** 复制双链引用:只写系统剪贴板,不读正文、不插入编辑器 */
  onCopyWikiRef: (rel: string) => void | Promise<void>;
  /** 外部预置搜索词,透传 SearchBox(失效双链「搜索同名文档」) */
  searchPreset?: { term: string; seq: number } | null;
  onRebuildIndex: () => void;
  onOpenTrash: () => void;
  onOpenMarkdownFile: () => void;
  onBackHome: () => void;
  onOpenOtherKb: () => void;
  onCreateKb: () => void;
  /** 复制当前知识库完整路径(路径展示从状态栏收敛到左上角菜单) */
  onCopyRootPath: () => void;
  trashCount: number;
  /** 失联 meta 条数(5.2.1);>0 才渲染底部入口 */
  orphanCount: number;
  onOpenOrphans: () => void;
  /* ---- 置顶与标签(6.3-2/3) ---- */
  /** 置顶文档路径集合(树序在 meta 排序处已提前;此处用于图标与拖拽豁免) */
  pinnedSet: Set<string>;
  onTogglePin: (rel: string, pinned: boolean) => void;
  /** 全库标签(筛选下拉) */
  allTags: string[];
  tagCounts: Record<string, number>;
  /** 激活中的标签筛选;null = 未筛选(树已由上层过滤,过滤态禁拖) */
  tagFilter: string | null;
  onTagFilter: (tag: string | null) => void;
  /* ---- V3 批量文档操作 ---- */
  onBatchMove: (rels: string[], destFolder: string) => Promise<BatchResult>;
  onBatchSetTags: (rels: string[], add: string[], remove: string[]) => Promise<BatchResult>;
  onBatchRename: (items: BatchRenameItem[]) => Promise<BatchResult>;
  onBatchTrash: (rels: string[]) => Promise<BatchResult>;
  onToast: (message: string) => void;
  /* ---- 左栏宽度(可拖拽分隔条) ---- */
  /** 左栏宽度(px);undefined = 用默认 248 */
  width?: number;
  /** 拖动中为 true:父级据此关掉 width transition,保证跟手 */
  resizing?: boolean;
}

export type DropZone = "before" | "after" | "into";

/** 图标先用本地覆盖立即可见;随后 meta/entryIcons revision 再同步标签页等 App 级消费者。 */
interface IconOverrideState {
  base: Map<string, string>;
  values: Map<string, string | null>;
}

/** 当前展开可见的文档顺序(选择模式的范围选择与全选只作用于可见项) */
function visibleDocPaths(nodes: TreeNode[], collapsed: Set<string>): string[] {
  const out: string[] = [];
  const walk = (items: TreeNode[]) => {
    for (const node of items) {
      if (node.isDir) {
        if (!collapsed.has(node.path)) walk(node.children);
      } else {
        out.push(node.path);
      }
    }
  };
  walk(nodes);
  return out;
}

function countDocs(node: TreeNode): number {
  return node.isDir ? node.children.reduce((n, c) => n + countDocs(c), 0) : 1;
}

/** lucide 1.x 唯一垃圾桶图形(Trash=Trash2)带两根桶内竖线,小尺寸细线下轮廓碎;
 *  自绘桶形剪影(盖沿+提手+锥形桶身)辨识度更高 */
function TrashGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2.5 4.5h11" />
      <path d="M6.5 4.5V3.5c0-.55.45-1 1-1h1c.55 0 1 .45 1 1v1" />
      <path d="M4 4.5l.6 8c.04.55.5 1 1.05 1h4.7c.55 0 1.01-.45 1.05-1l.6-8" />
    </svg>
  );
}

/**
 * 树行实心文件夹:无描边外框,纯填色剪影;open 用前盖分层区分展开。
 */
function FolderGlyph({ open = false, className }: { open?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      {open ? (
        <>
          <path
            d="M1.5 4.2c0-.5.4-.9.9-.9h3.4c.28 0 .54.13.7.35l.7.95h5.9c.5 0 .9.4.9.9v1.1H1.5V4.2Z"
            opacity="0.55"
          />
          <path d="M1.5 6.55h13c.55 0 1 .4.95.95l-.7 5.1c-.08.55-.55.95-1.1.95H2.35c-.55 0-1.02-.4-1.1-.95L.55 7.5c-.05-.55.4-.95.95-.95Z" />
        </>
      ) : (
        <path d="M1.5 4.35c0-.5.4-.9.9-.9h3.55c.28 0 .55.14.7.37L7.4 5.1h6.2c.5 0 .9.4.9.9v6.55c0 .5-.4.9-.9.9H2.4c-.5 0-.9-.4-.9-.9V4.35Z" />
      )}
    </svg>
  );
}

/**
 * 树行文档:浅底 + 描边纸页(非纯实心),折角与两道文线保持可读。
 * 颜色由外层 currentColor 控制——未选 muted、当前 primary。
 */
function DocGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path
        d="M4 1.75h5.15L12.9 5.45v7.8c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V2.75c0-.55.45-1 1-1Z"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <path
        d="M4 1.75h5.15L12.9 5.45v7.8c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V2.75c0-.55.45-1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9.15 1.85v2.65c0 .45.35.8.8.8h2.7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 8.2h5.6M5.2 10.55h4.1"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

/** 某文件夹的直接子节点列表(parentRel = "" 即库根) */
function listAt(nodes: TreeNode[], parentRel: string): TreeNode[] {
  if (!parentRel) return nodes;
  for (const n of nodes) {
    if (n.path === parentRel) return n.children;
    if (parentRel.startsWith(n.path + "/")) {
      const inner = listAt(n.children, parentRel);
      if (inner.length) return inner;
    }
  }
  return [];
}

/** 拖拽预占位槽的哨兵路径(不与真实条目冲突;不落盘) */
const DROP_SLOT_PATH = "__yz-drop-slot__";
/** 预占位槽节点:携带被拖条目路径,槽按它的真实图标/标题渲染 */
type DropSlotNode = TreeNode & { slotFor: string };
function isDropSlot(node: TreeNode): node is DropSlotNode {
  return node.path === DROP_SLOT_PATH;
}
/** 拖拽期间的行几何快照(导航内容坐标,与滚动无关):落点判定只看它 */
export interface DragRowRect {
  path: string;
  top: number;
  height: number;
  isDir: boolean;
}

/**
 * 指针 y(导航内容坐标)→ 落点。rows 是拖起时的快照(调用方已排除被拖行及其子树),
 * 与当前预览布局无关 —— 这是拖拽不抖的关键:预览插入/移除的行都不参与判定。
 */
export function dropHintAt(
  rows: DragRowRect[],
  y: number,
): { path: string; zone: DropZone } | null {
  if (!rows.length) return null;
  let target = rows[rows.length - 1];
  for (const row of rows) {
    if (y < row.top + row.height) {
      target = row;
      break;
    }
  }
  const ratio = (y - target.top) / target.height;
  const zone: DropZone = target.isDir
    ? ratio < 0.25
      ? "before"
      : ratio > 0.75
        ? "after"
        : "into"
    : ratio < 0.5
      ? "before"
      : "after";
  return { path: target.path, zone };
}

/** 从树中摘除节点(沿途浅拷贝),返回新树与被摘节点 */
function removeTreeNode(
  nodes: TreeNode[],
  path: string,
): { nodes: TreeNode[]; removed: TreeNode | null } {
  const out: TreeNode[] = [];
  let removed: TreeNode | null = null;
  for (const n of nodes) {
    if (removed === null && n.path === path) {
      removed = n;
      continue;
    }
    if (removed === null && n.children.length > 0) {
      const inner = removeTreeNode(n.children, path);
      if (inner.removed) {
        removed = inner.removed;
        out.push({ ...n, children: inner.nodes });
      } else {
        out.push(n);
      }
    } else {
      out.push(n);
    }
  }
  return { nodes: out, removed };
}

/** 在 target 所在兄弟组插入占位槽(沿途浅拷贝) */
function insertSlotNode(
  nodes: TreeNode[],
  targetPath: string,
  zone: "before" | "after",
  slot: TreeNode,
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.path === targetPath) {
      if (zone === "before") out.push(slot, n);
      else out.push(n, slot);
      continue;
    }
    out.push(
      n.children.length > 0
        ? { ...n, children: insertSlotNode(n.children, targetPath, zone, slot) }
        : n,
    );
  }
  return out;
}

function findTreeNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findTreeNode(node.children, path);
    if (child) return child;
  }
  return null;
}

function TreeRow({
  node,
  depth,
  currentPath,
  collapsed,
  iconMap,
  onOpenIconPicker,
  pinnedSet,
  pinned,
  selectedPaths,
  selectionMode,
  revealedPath,
  dragLocked,
  renamingPath,
  onBeginRename,
  onEndRename,
  onToggle,
  onOpenDoc,
  onRevealEntry,
  canCopyWikiRef,
  onCopyWikiRef,
  onCreateDoc,
  onCreateFolder,
  onRenameEntry,
  onRemoveEntry,
  onMoveEntry,
  onBatchTrash,
  onBatchMove,
  moveFolders,
  onTogglePin,
  selected,
  onToggleSelect,
  onSelectSubtree,
  dragPath,
  dropHint,
  onDragStartRow,
  onDragEndRow,
}: {
  node: TreeNode;
  depth: number;
  currentPath: string | null;
  collapsed: Set<string>;
  iconMap: Map<string, string>;
  onOpenIconPicker: (node: TreeNode) => void;
  pinnedSet: Set<string>;
  pinned: boolean;
  selectedPaths: Set<string>;
  selectionMode: boolean;
  revealedPath: string | null;
  /** 标签筛选态:树是过滤视图,拖拽排序/移动会错位隐藏兄弟 → 全禁 */
  dragLocked: boolean;
  /** 正在行内重命名的路径;由 DocTree 统一持有(新建文件夹后自动切入) */
  renamingPath: string | null;
  onBeginRename: (rel: string) => void;
  onEndRename: () => void;
  onToggle: (path: string) => void;
  onOpenDoc: (rel: string) => void;
  onRevealEntry: (rel: string) => void;
  canCopyWikiRef: (rel: string) => boolean;
  onCopyWikiRef: (rel: string) => void | Promise<void>;
  onCreateDoc: (folderRel: string, title: string) => void;
  onCreateFolder: (folderRel: string, name: string) => void;
  onRenameEntry: (rel: string, name: string) => void;
  onRemoveEntry: (rel: string) => void;
  onMoveEntry: (srcRel: string, destFolderRel: string) => void;
  /** 批量模式右键:整组移入回收站 */
  onBatchTrash: (rels: string[]) => Promise<BatchResult>;
  /** 批量模式右键:整组移动 */
  onBatchMove: (rels: string[], destFolder: string) => Promise<BatchResult>;
  moveFolders: { path: string; label: string }[];
  onTogglePin: (rel: string, pinned: boolean) => void;
  selected: boolean;
  onToggleSelect: (rel: string, shift: boolean) => void;
  onSelectSubtree: (folderRel: string) => void;
  dragPath: React.MutableRefObject<string | null>;
  dropHint: { path: string; zone: DropZone } | null;
  /** 拖拽发起(驱动预览树 + 行几何快照) */
  onDragStartRow: (path: string) => void;
  /** 拖拽结束(取消/松手兜底收尾) */
  onDragEndRow: () => void;
}) {
  // 拖拽预占位槽:按被拖条目的真实样式渲染(图标 + 标题 + 行高),虚线主色框表示落位;
  // 被让位的行由 DocTree 的 FLIP 上下滑过渡。无 hooks,该分支实例恒定不换形。
  if (isDropSlot(node)) {
    const slotIconId = iconMap.get(node.slotFor);
    const SlotIcon = treeIconComponent(slotIconId);
    return (
      <div
        data-path={node.path}
        aria-hidden
        className={cn(
          "border-primary/50 bg-primary/10 flex w-full items-center gap-1.5 rounded-lg border border-dashed py-1 pr-2 text-[13px]",
          node.isDir ? "min-h-9" : "min-h-8",
        )}
        style={{ paddingLeft: 2 }}
      >
        <span className="size-5 shrink-0" aria-hidden />
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center",
            node.isDir ? "text-primary" : "text-muted-foreground",
          )}
        >
          {SlotIcon ? (
            <SlotIcon className="size-3.5" data-tree-icon={slotIconId} />
          ) : node.isDir ? (
            <FolderGlyph className="size-3.5" />
          ) : (
            <DocGlyph className="size-3.5" />
          )}
        </span>
        <span className={cn("truncate", node.isDir && "font-medium")}>{node.name}</span>
      </div>
    );
  }
  const active = !node.isDir && node.path === currentPath;
  const isCollapsed = collapsed.has(node.path);
  // 缩进由子树导轨承担,行自身保持同一安全边;深度参数仅继续传给递归组件
  const pad = { paddingLeft: 2 };
  const hint = dropHint?.path === node.path ? dropHint.zone : null;
  const iconId = iconMap.get(node.path);
  const CustomIcon = treeIconComponent(iconId);
  const renderIcon = (fallback: React.ReactNode) =>
    CustomIcon ? <CustomIcon className="size-3.5" data-tree-icon={iconId} /> : fallback;
  // 置顶行不参与拖拽(永远在组内最上,落位无意义);筛选态全禁
  const noDrag = dragLocked || (pinned && !node.isDir);
  const renaming = renamingPath === node.path;
  // 右键新建子文件夹后,菜单关闭时 Radix 会把焦点还给触发行,抢走新文件夹的行内重命名框;
  // 这个动作只对「新建子文件夹」抑制一次关闭回焦。
  const suppressMenuFocusRef = useRef(false);

  if (renaming) {
    const commit = (value: string) => {
      onEndRename();
      const v = value.trim();
      if (v && v !== node.name) onRenameEntry(node.path, v);
    };
    return (
      <div
        data-path={node.path}
        className="flex w-full items-center gap-1.5 py-1 pr-2"
        style={pad}
      >
        {node.isDir ? (
          <span className="text-primary flex size-5 shrink-0 items-center justify-center">
            {renderIcon(<FolderGlyph open className="size-3.5" />)}
          </span>
        ) : (
          <span className="text-muted-foreground flex size-5 shrink-0 items-center justify-center">
            {renderIcon(<DocGlyph className="size-3.5" />)}
          </span>
        )}
        <input
          defaultValue={node.name}
          className="border-border-subtle bg-raised focus:ring-ring h-7 min-w-0 flex-1 rounded-md border px-2 text-[13px] outline-none focus:ring-1"
          onClick={(e) => e.stopPropagation()}
          ref={(el) => {
            // 挂载即聚焦并全选默认名,方便直接覆盖输入(新建文件夹 / 右键重命名同口径)
            if (el && document.activeElement !== el) {
              el.focus();
              el.select();
            }
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(e.currentTarget.value);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onEndRename();
            }
          }}
        />
      </div>
    );
  }

  return (
    // 拦住 contextmenu 冒泡,避免顶层目录空白菜单盖掉行内菜单
    <div onContextMenu={(e) => e.stopPropagation()}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            data-path={node.path}
            aria-current={active ? "page" : undefined}
            className={cn(
              "chrome-tree-row group relative flex w-full cursor-pointer items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[13px] transition-colors",
              // 当前文档用 raised 白底+主色描边;批量选择时关掉胶囊/左色条,避免和勾选框挤成紫边残影
              // (平铺风格由 [data-ui-style=flat] .chrome-tree-row-active 改成左条选中)
              selected
                ? "bg-selection text-foreground"
                : active && !selectionMode
                  ? "chrome-tree-row-active bg-raised text-foreground ring-primary/35 shadow-[0_1px_2px_color-mix(in_oklab,var(--workspace)_45%,transparent)] ring-1"
                  : node.isDir
                    ? "hover:bg-hover text-foreground/90 font-medium"
                    : "hover:bg-hover text-foreground/80",
              active && selectionMode && !selected && "text-foreground",
              revealedPath === node.path && "ring-primary/45 ring-2",
              node.isDir ? "min-h-9" : "min-h-8",
              hint === "into" && "bg-primary/10 ring-primary/35 ring-1",
            )}
            style={{
              ...pad,
              // 常规落位的「预占位槽」在预览树里;细线只兜底置顶行(预览树排除的落位)
              ...(pinned && !node.isDir && hint === "before"
                ? { boxShadow: "inset 0 2px 0 0 color-mix(in oklab, var(--primary) 70%, transparent)" }
                : pinned && !node.isDir && hint === "after"
                  ? { boxShadow: "inset 0 -2px 0 0 color-mix(in oklab, var(--primary) 70%, transparent)" }
                  : {}),
            }}
            draggable
            onDragStart={(e) => {
              if (noDrag) {
                e.preventDefault();
                return;
              }
              dragPath.current = node.path;
              onDragStartRow(node.path);
              e.dataTransfer.effectAllowed = "move";
              // WebKit/WKWebView 必须在 dragstart 里 setData 才会发起拖拽(Chrome 不要求)
              e.dataTransfer.setData("text/plain", node.path);
              // 自定义拖影省略:整行 ghost 即语义
            }}
            onDragEnd={() => {
              dragPath.current = null;
              onDragEndRow();
            }}
            onClick={(e) => {
              if (node.isDir) onToggle(node.path);
              else if (selectionMode || e.metaKey || e.ctrlKey) onToggleSelect(node.path, e.shiftKey);
              else onOpenDoc(node.path);
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (node.isDir) onToggle(node.path);
                else onOpenDoc(node.path);
              }
            }}
          >
            {node.isDir || !selectionMode ? (
              <span className="size-5 shrink-0" aria-hidden />
            ) : (
              <button
                type="button"
                aria-label={selected ? `取消选择「${node.name}」` : `选择「${node.name}」`}
                aria-pressed={selected}
                className={cn(
                  "text-muted-foreground hover:text-primary flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md",
                  selected && "text-primary",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(node.path, false);
                }}
              >
                {selected ? (
                  <CheckSquare2 className="size-3.5" strokeWidth={2} />
                ) : (
                  <Square className="size-3.5" strokeWidth={2} />
                )}
              </button>
            )}
            {node.isDir ? (
              <>
                <span
                  className={cn(
                    "text-muted-foreground/65 group-hover:text-foreground flex size-4 shrink-0 items-center justify-center rounded-md transition-colors",
                    !isCollapsed && "bg-hover/80 text-foreground/80",
                  )}
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-3" strokeWidth={2.25} />
                  ) : (
                    <ChevronDown className="size-3" strokeWidth={2.25} />
                  )}
                </span>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center transition-colors",
                    isCollapsed ? "text-primary/85" : "text-primary",
                  )}
                >
                  {renderIcon(<FolderGlyph open={!isCollapsed} className="size-3.5" />)}
                </span>
              </>
            ) : (
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground group-hover:text-foreground/70",
                )}
              >
                {renderIcon(<DocGlyph className="size-3.5" />)}
              </span>
            )}
            <span className={cn("truncate", (active || node.isDir) && "font-medium")}>{node.name}</span>
            {pinned && !node.isDir && (
              <span className="bg-primary/10 text-primary ml-auto flex size-5 shrink-0 items-center justify-center rounded-full">
                <Pin className="size-3" aria-label="已置顶" />
              </span>
            )}
            {node.isDir && (
              /* 不能用 hidden group-hover:flex:菜单弹出覆盖鼠标会打断 :hover,
                 trigger 塌缩成零尺寸 → popper 定位到屏幕原点(左上角实录) */
              <span
                className="pointer-events-none ml-auto flex shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenu>
                  {/* Hint 必须在 DropdownMenuTrigger 外层:asChild 往里注入
                      pointerdown 处理器,中间隔一层会挡掉 → 菜单打不开 */}
                  <Hint label="新建文档或子文件夹">
                    <DropdownMenuTrigger asChild>
                      <span className="text-muted-foreground hover:text-foreground hover:bg-selection bg-raised cursor-pointer rounded-md p-1">
                        <Plus className="size-3" />
                      </span>
                    </DropdownMenuTrigger>
                  </Hint>
                  <DropdownMenuContent align="end" alignOffset={-2}>
                    <DropdownMenuItem onClick={() => onCreateDoc(node.path, "未命名文档")}>
                      <SquarePen /> 新建文档
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onCreateFolder(node.path, "新文件夹")}>
                      <FolderPlus /> 新建子文件夹
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            if (!suppressMenuFocusRef.current) return;
            event.preventDefault();
            suppressMenuFocusRef.current = false;
          }}
        >
          {node.isDir && (
            <>
              <ContextMenuItem onClick={() => onCreateDoc(node.path, "未命名文档")}>
                <SquarePen /> 新建文档
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  suppressMenuFocusRef.current = true;
                  onCreateFolder(node.path, "新文件夹");
                }}
              >
                <FolderPlus /> 新建子文件夹
              </ContextMenuItem>
              <ContextMenuItem disabled={countDocs(node) === 0} onClick={() => onSelectSubtree(node.path)}>
                <ListChecks /> 选择文件夹内全部文档
              </ContextMenuItem>
            </>
          )}
          {!node.isDir && (
            <>
              <ContextMenuItem onClick={() => onToggleSelect(node.path, false)}>
                {selectionMode ? (
                  selected ? <CheckSquare2 /> : <Square />
                ) : (
                  <ListChecks />
                )}
                {selectionMode ? (selected ? "取消选择" : "选择") : "批量选择"}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onTogglePin(node.path, !pinned)}>
                <Pin /> {pinned ? "取消置顶" : "置顶"}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={!canCopyWikiRef(node.path)}
                title={canCopyWikiRef(node.path) ? undefined : "标题或路径包含双链不兼容字符"}
                onClick={() => void onCopyWikiRef(node.path)}
              >
                <Copy /> 复制双链引用
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onOpenIconPicker(node)}>
            <Palette /> 更改图标
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onRevealEntry(node.path)}>
            <FolderOpen /> 在文件管理器中显示
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onBeginRename(node.path)}>
            <PenLine /> 重命名
          </ContextMenuItem>
          {(() => {
            // 批量选择有勾选时,这对入口整体切换为批量语义,不再出第二份重复项
            const batch = selectionMode && selectedPaths.size > 0;
            return (
              <>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <ArrowRightLeft /> {batch ? `移动到(${selectedPaths.size} 篇)` : "移动到"}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="max-h-72 min-w-40 overflow-y-auto">
                    {moveFolders.map((f) => {
                      if (batch) {
                        return (
                          <ContextMenuItem
                            key={f.path || "__root"}
                            onClick={() => void onBatchMove([...selectedPaths], f.path)}
                          >
                            {f.label}
                          </ContextMenuItem>
                        );
                      }
                      const disabled = isInvalidMoveDest(node.path, node.isDir, f.path);
                      return (
                        <ContextMenuItem
                          key={f.path || "__root"}
                          disabled={disabled}
                          title={disabled ? "已在此位置或不能移入自身子树" : undefined}
                          onClick={() => onMoveEntry(node.path, f.path)}
                        >
                          {f.label}
                        </ContextMenuItem>
                      );
                    })}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuItem
                  variant="destructive"
                  // 有内容的文件夹加原生 title 兜底(空文件夹/文档不加)
                  title={
                    batch
                      ? `移动所选 ${selectedPaths.size} 项到回收站`
                      : node.isDir && countDocs(node) > 0
                        ? `含 ${countDocs(node)} 篇文档,移入回收站`
                        : undefined
                  }
                  onClick={() =>
                    batch
                      ? void onBatchTrash([...selectedPaths])
                      : onRemoveEntry(node.path)
                  }
                >
                  <Trash2 /> {batch ? `移入回收站(${selectedPaths.size} 篇)` : "移入回收站"}
                </ContextMenuItem>
              </>
            );
          })()}
        </ContextMenuContent>
      </ContextMenu>
      {node.isDir && !isCollapsed && (
        <div className="border-border-subtle/70 ml-[13px] mt-0.5 min-w-0 border-l pl-0.5">
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              currentPath={currentPath}
              collapsed={collapsed}
              iconMap={iconMap}
              onOpenIconPicker={onOpenIconPicker}
              pinnedSet={pinnedSet}
              pinned={pinnedSet.has(child.path)}
              selectedPaths={selectedPaths}
              revealedPath={revealedPath}
              dragLocked={dragLocked}
              renamingPath={renamingPath}
              onBeginRename={onBeginRename}
              onEndRename={onEndRename}
              onToggle={onToggle}
              onTogglePin={onTogglePin}
              selected={selectedPaths.has(child.path)}
              onToggleSelect={onToggleSelect}
              selectionMode={selectionMode}
              onSelectSubtree={onSelectSubtree}
              onOpenDoc={onOpenDoc}
              onRevealEntry={onRevealEntry}
              canCopyWikiRef={canCopyWikiRef}
              onCopyWikiRef={onCopyWikiRef}
              onCreateDoc={onCreateDoc}
              onCreateFolder={onCreateFolder}
              onRenameEntry={onRenameEntry}
              onRemoveEntry={onRemoveEntry}
              onMoveEntry={onMoveEntry}
              onBatchTrash={onBatchTrash}
              onBatchMove={onBatchMove}
              moveFolders={moveFolders}
              dragPath={dragPath}
              dropHint={dropHint}
              onDragStartRow={onDragStartRow}
              onDragEndRow={onDragEndRow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DocTree({
  root,
  tree,
  currentPath,
  collapsed,
  indexReady,
  onToggleCollapse,
  onSetAllCollapsed,
  iconMap,
  onSetEntryIcon,
  onOpenDoc,
  onRevealEntry,
  onCreateDoc,
  onCreateFolder,
  onRenameEntry,
  onRemoveEntry,
  onReorder,
  onMoveEntry,
  onSearch,
  onSearchSelect,
  revealFolder,
  recentDocs,
  canCopyWikiRef,
  onCopyWikiRef,
  searchPreset,
  onRebuildIndex,
  onOpenTrash,
  onOpenMarkdownFile,
  onBackHome,
  onOpenOtherKb,
  onCreateKb,
  onCopyRootPath,
  trashCount,
  orphanCount,
  onOpenOrphans,
  pinnedSet,
  onTogglePin,
  allTags,
  tagCounts,
  tagFilter,
  onTagFilter,
  onBatchMove,
  onBatchSetTags,
  onBatchRename,
  onBatchTrash,
  onToast,
  width,
  resizing,
}: DocTreeProps) {
  const dragPath = useRef<string | null>(null);
  const [dropHint, setDropHintState] = useState<{ path: string; zone: DropZone } | null>(null);
  /** dropHint 同步镜像:nav 上松手时取当前落位(setState 异步不可靠) */
  const dropHintRef = useRef<{ path: string; zone: DropZone } | null>(null);
  const setDropHint = (next: { path: string; zone: DropZone } | null) => {
    dropHintRef.current = next;
    setDropHintState(next);
  };
  /** 正在拖拽的行(响应式):驱动预览树(移除自身 + 插入占位槽) */
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const draggingPathRef = useRef<string | null>(null);
  /**
   * 拖起时的行几何快照(导航内容坐标,与滚动无关)。落点判定只看「快照 + 指针」,
   * 不看正在动画的行 —— 否则行一动判定就变、判定一变布局又动,自激抖动甚至死循环。
   */
  const dragRowsRef = useRef<DragRowRect[]>([]);
  /**
   * 松手后预览保持到上层 tree 真正刷新再收尾,避免「行先弹回原位、刷新后再移动」两段动画;
   * tree 未变(空操作/失败)由 600ms 兜底计时器收尾。
   */
  const [pendingRelease, setPendingRelease] = useState(false);
  const treeAtDropRef = useRef(tree);
  const releaseTimerRef = useRef<number | null>(null);
  /** 目录路径集合:快照行需要 isDir 来决定 into 区间 */
  const dirPaths = useMemo(() => {
    const set = new Set<string>();
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.isDir) set.add(n.path);
        walk(n.children);
      }
    };
    walk(tree);
    return set;
  }, [tree]);

  /** 拖拽预览树:移除被拖行、在落点插入占位槽(into 拖拽仍走原有文件夹高亮,不重排) */
  const previewTree = useMemo<TreeNode[] | null>(() => {
    if (!draggingPath || !dropHint || dropHint.zone === "into") return null;
    if (dropHint.path === draggingPath || dropHint.path.startsWith(draggingPath + "/")) return null;
    if (pinnedSet.has(dropHint.path)) return null;
    const draggedNode = findTreeNode(tree, draggingPath);
    if (!draggedNode) return null;
    const pruned = removeTreeNode(tree, draggingPath);
    if (!pruned.removed) return null;
    const slot: DropSlotNode = {
      name: draggedNode.name,
      path: DROP_SLOT_PATH,
      isDir: draggedNode.isDir,
      children: [],
      slotFor: draggingPath,
    };
    return insertSlotNode(pruned.nodes, dropHint.path, dropHint.zone, slot);
  }, [tree, draggingPath, dropHint, pinnedSet]);
  const renderTree = previewTree ?? tree;

  const finalizeDrag = () => {
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = null;
    }
    setPendingRelease(false);
    draggingPathRef.current = null;
    dragRowsRef.current = [];
    setDraggingPath(null);
    setDropHint(null);
  };

  /** 拖拽发起:记下被拖行 + 此刻(仍是原始布局)的行几何快照 */
  const beginDrag = (path: string) => {
    draggingPathRef.current = path;
    setDraggingPath(path);
    const nav = navRef.current;
    if (!nav) return;
    const navTop = nav.getBoundingClientRect().top;
    const scrollTop = nav.scrollTop;
    const rows: DragRowRect[] = [];
    nav.querySelectorAll<HTMLElement>("[data-path]").forEach((el) => {
      const rowPath = el.dataset.path;
      if (!rowPath || rowPath === DROP_SLOT_PATH) return;
      const rect = el.getBoundingClientRect();
      rows.push({
        path: rowPath,
        top: rect.top - navTop + scrollTop,
        height: rect.height,
        isDir: dirPaths.has(rowPath),
      });
    });
    dragRowsRef.current = rows;
  };

  /**
   * 指针 → 落点。几何取拖起时的快照(被拖行自身与其子树排除),与当前预览布局无关,
   * 因此判定稳定、不会自激;被拖行移除 + 等高占位槽插入后,槽正好落在指针下。
   */
  const computeHint = (clientY: number): { path: string; zone: DropZone } | null => {
    const nav = navRef.current;
    const dragged = draggingPathRef.current;
    if (!nav || !dragged) return null;
    const y = clientY - nav.getBoundingClientRect().top + nav.scrollTop;
    return dropHintAt(
      dragRowsRef.current.filter(
        (row) => row.path !== dragged && !row.path.startsWith(dragged + "/"),
      ),
      y,
    );
  };

  const endDrag = () => {
    if (!pendingRelease) finalizeDrag();
  };

  /** nav 上松手(行、预占位槽、空白处统一走这里):按最近一次 dragover 的落位提交 */
  const commitNavDrop = () => {
    const hint = dropHintRef.current;
    if (hint) commitDrop(hint.path, hint.zone);
    else finalizeDrag();
  };
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [revealedPath, setRevealedPath] = useState<string | null>(null);
  const [iconPickerPath, setIconPickerPath] = useState<string | null>(null);
  const [iconOverrides, setIconOverrides] = useState<IconOverrideState | null>(null);
  // Windows 路径是 `\`,不能只按 `/` 切——否则标题会变成整段 `C:\Users\…`
  const rootName = useMemo(() => {
    const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? root;
  }, [root]);
  const rootParent = useMemo(() => {
    const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
    if (parts.length < 2) return "";
    return parts.slice(0, -1).join("/");
  }, [root]);
  const moveFolders = useMemo(() => foldersOf(tree), [tree]);
  const navRef = useRef<HTMLElement>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const selectionAnchor = useRef<string | null>(null);
  const visibleDocs = useMemo(() => visibleDocPaths(tree, collapsed), [tree, collapsed]);
  const allVisibleSelected = visibleDocs.length > 0 && visibleDocs.every((p) => selectedPaths.has(p));
  const iconPickerNode = iconPickerPath ? findTreeNode(tree, iconPickerPath) : null;
  const displayIconMap = useMemo(() => {
    if (!iconOverrides || iconOverrides.base !== iconMap) return iconMap;
    const merged = new Map(iconMap);
    iconOverrides.values.forEach((icon, path) => {
      if (icon === null) merged.delete(path);
      else merged.set(path, icon);
    });
    return merged;
  }, [iconMap, iconOverrides]);

  /** 等右键菜单先卸掉,再开弹窗;否则 Windows 上菜单退场与 100+ SVG 同帧抢渲染 */
  const openIconPicker = (node: TreeNode) => {
    window.setTimeout(() => setIconPickerPath(node.path), 0);
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedPaths(new Set());
    selectionAnchor.current = null;
  };

  /** 新建文件夹后展开父夹、切入行内重命名并全选默认名 */
  const handleCreateFolder = async (folderRel: string, name: string) => {
    if (folderRel && collapsed.has(folderRel)) onToggleCollapse(folderRel);
    const rel = await onCreateFolder(folderRel, name);
    if (!rel) return;
    setRenamingPath(rel);
    requestAnimationFrame(() => {
      const el = navRef.current?.querySelector(`[data-path="${CSS.escape(rel)}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
  };

  const enterSelection = () => {
    setSelectionMode(true);
  };

  const selectDoc = (rel: string, shift: boolean) => {
    setSelectionMode(true);
    if (shift && selectionAnchor.current) {
      const from = visibleDocs.indexOf(selectionAnchor.current);
      const to = visibleDocs.indexOf(rel);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          for (const path of visibleDocs.slice(start, end + 1)) next.add(path);
          return next;
        });
        return;
      }
    }
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
    selectionAnchor.current = rel;
  };

  const selectSubtree = (folderRel: string) => {
    const paths = visibleDocPaths(tree, new Set()).filter((p) => p.startsWith(folderRel + "/"));
    setSelectionMode(true);
    setSelectedPaths((prev) => new Set([...prev, ...paths]));
    if (paths.length) selectionAnchor.current = paths[0];
  };

  const toggleSelectAll = () => {
    setSelectionMode(true);
    setSelectedPaths(allVisibleSelected ? new Set() : new Set(visibleDocs));
    selectionAnchor.current = visibleDocs[0] ?? null;
  };

  useEffect(() => {
    if (tagFilter !== null) clearSelection();
  }, [tagFilter]);

  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
      } else if ((e.metaKey || e.ctrlKey) && e.code === "KeyA") {
        e.preventDefault();
        toggleSelectAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, allVisibleSelected, visibleDocs]);

  // 当前文档行滚进可视区(5.1 文档定位):切文档/搜索定位/后退时生效;
  // 所在文件夹被折叠时行不在 DOM,展开(collapsed 变)后再补滚
  useEffect(() => {
    if (!currentPath) return;
    navRef.current
      ?.querySelector(`[data-path="${CSS.escape(currentPath)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [currentPath, tree, collapsed]);

  useEffect(() => {
    if (!revealFolder) return;
    setRevealedPath(revealFolder.path || null);
    const id = requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      if (!revealFolder.path) {
        navRef.current?.scrollTo({ top: 0, behavior });
        return;
      }
      const row = navRef.current?.querySelector<HTMLElement>(
        `[data-path="${CSS.escape(revealFolder.path)}"]`,
      );
      row?.scrollIntoView({ block: "nearest", behavior });
      row?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => setRevealedPath(null), 1400);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(timer);
    };
  }, [revealFolder, collapsed, tree]);

  /** 拖拽落点 → 整组兄弟新顺序(交给上层写 meta.sortIndex) */
  const commitDrop = (target: string, zone: DropZone) => {
    const dragged = dragPath.current;
    dragPath.current = null;
    if (!dragged || dragged === target) return;
    if (target.startsWith(dragged + "/")) return; // 不能拖进自己的子树
    // 置顶行永远在组内最上,before/after 落位无意义(拖拽发起端已禁,此处兜底)
    if (zone !== "into" && pinnedSet.has(target)) return;
    if (zone === "into") {
      // 层级调整 = 文件系统移动(名字不变),排序由 moveEntry 落尾
      onMoveEntry(dragged, target);
    } else {
      // before/after:同组 = 改序;跨组 = 移动到目标所在文件夹并落在目标旁
      const parentRel = parentOf(target);
      const sameGroup = parentOf(dragged) === parentRel;
      const name = dragged.split("/").pop() ?? dragged; // applySiblingOrder 会补父前缀
      const siblings = listAt(tree, parentRel)
        .map((n) => n.path)
        .filter((p) => p !== dragged);
      const idx = siblings.indexOf(target);
      siblings.splice(zone === "before" ? idx : idx + 1, 0, name);
      if (sameGroup) onReorder(parentRel, siblings);
      else onMoveEntry(dragged, parentRel, siblings);
    }
    // 预览保持到 tree 刷新(见 finalizeDrag);空操作由兜底计时器收尾
    flipFirstRef.current = captureRowTops();
    treeAtDropRef.current = tree;
    setPendingRelease(true);
    releaseTimerRef.current = window.setTimeout(finalizeDrag, 600);
  };

  // tree 真正刷新(移动生效)→ 收尾:预览布局 FLIP 过渡到最终布局
  useEffect(() => {
    if (pendingRelease && tree !== treeAtDropRef.current) finalizeDrag();
  }, [tree, pendingRelease]);

  /**
   * FLIP 行位移:渲染前记录各行 top(First),渲染后按差值反向位移再过渡回 0。
   * 占位让位、落位、取消拖拽都走同一条通道;只在拖拽会话内播(含收尾那一帧),
   * 其余布局变化只刷新基线,不误触发动画。
   */
  const rowRectsRef = useRef(new Map<string, number>());
  const dragAnimActiveRef = useRef(false);
  const flipAnimationsRef = useRef<Animation[]>([]);
  /**
   * 提交新落点前记录的「当前视觉位置」(含未播完的动画位移)。
   * FLIP 的 First 必须在 React 改 DOM 之前取:否则连续拖动时动画被反复打断成
   * 「瞬移到上一轮终点 + 重新起步」,看起来一顿一顿。
   */
  const flipFirstRef = useRef<Map<string, number> | null>(null);
  const captureRowTops = () => {
    const nav = navRef.current;
    if (!nav) return null;
    const map = new Map<string, number>();
    nav.querySelectorAll<HTMLElement>("[data-path]").forEach((el) => {
      const path = el.dataset.path;
      if (path) map.set(path, el.getBoundingClientRect().top);
    });
    return map;
  };
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const first = flipFirstRef.current;
    flipFirstRef.current = null;
    // 取消上一轮未播完的动画,让 Last 是真实布局位置(First 已在渲染前捕获)
    for (const animation of flipAnimationsRef.current) animation.cancel();
    flipAnimationsRef.current = [];
    const rows = nav.querySelectorAll<HTMLElement>("[data-path]");
    const prev = rowRectsRef.current;
    const next = new Map<string, number>();
    rows.forEach((el) => {
      const path = el.dataset.path;
      if (path) next.set(path, el.getBoundingClientRect().top);
    });
    const dragActive = draggingPath !== null || pendingRelease;
    // jsdom 无 matchMedia / element.animate:守卫后再播动画
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && (dragActive || dragAnimActiveRef.current)) {
      rows.forEach((el) => {
        const path = el.dataset.path;
        if (!path || typeof el.animate !== "function") return;
        // First 优先用渲染前捕获的视觉位置;没有捕获(如折叠/外部刷新)才退回基线
        const oldTop = first ? first.get(path) : prev.get(path);
        const newTop = next.get(path)!;
        if (oldTop !== undefined && Math.abs(oldTop - newTop) > 1) {
          flipAnimationsRef.current.push(
            el.animate(
              [{ transform: `translateY(${oldTop - newTop}px)` }, { transform: "translateY(0)" }],
              { duration: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
            ),
          );
        }
      });
    }
    dragAnimActiveRef.current = dragActive;
    rowRectsRef.current = next;
  }, [previewTree, tree, collapsed, draggingPath, pendingRelease]);

  // 卸载时清掉兜底计时器与未播完的动画
  useEffect(
    () => () => {
      if (releaseTimerRef.current !== null) window.clearTimeout(releaseTimerRef.current);
      for (const animation of flipAnimationsRef.current) animation.cancel();
    },
    [],
  );

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const refresh = () => {
      const map = new Map<string, number>();
      nav.querySelectorAll<HTMLElement>("[data-path]").forEach((el) => {
        const path = el.dataset.path;
        if (path) map.set(path, el.getBoundingClientRect().top);
      });
      rowRectsRef.current = map;
    };
    nav.addEventListener("scroll", refresh, { passive: true });
    return () => nav.removeEventListener("scroll", refresh);
  }, []);

  return (
    <aside
      style={{
        width: `${width ?? DEFAULT_SIDEBAR_WIDTH}px`,
        minWidth: `${width ?? DEFAULT_SIDEBAR_WIDTH}px`,
        // 拖动中关掉 transition:否则宽度变化被缓动拖住,出现"跟不上鼠标"的滞后感。
        // 松手后恢复,双击复位/布局变化时右侧正文区平滑收缩。
        transition: resizing ? "none" : "width 180ms ease, min-width 180ms ease",
      }}
      className="shell-panel bg-sidebar border-border-subtle flex flex-col overflow-hidden rounded-2xl border shadow-[0_10px_28px_-20px_color-mix(in_oklab,var(--foreground)_18%,transparent)]"
    >
      <div className="shrink-0 px-2.5 pt-2.5">
        {selectionMode ? (
          <BatchDocActions
            selected={[...selectedPaths]}
            tree={tree}
            allTags={allTags}
            allSelected={allVisibleSelected}
            onClear={clearSelection}
            onSelectAll={toggleSelectAll}
            onMove={onBatchMove}
            onSetTags={onBatchSetTags}
            onRename={onBatchRename}
            onTrash={onBatchTrash}
            onToast={onToast}
          />
        ) : (
          <>
            <div className="flex items-start gap-1 px-0.5 pt-0.5 pb-1">
              {/* 身份 = 文件夹名 + 上级目录;完整路径收进 title 与菜单,状态栏不再重复展示。 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="hover:bg-hover/70 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition-colors outline-none"
                    title={root}
                  >
                    <span className="text-primary flex size-8 shrink-0 items-center justify-center">
                      <FolderGlyph open className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground flex min-w-0 items-center gap-0.5">
                        <span className="truncate text-[13px] leading-4 font-semibold">{rootName}</span>
                        <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                      </span>
                      <span className="text-muted-foreground/75 mt-0.5 block truncate text-[10px] leading-3">
                        {rootParent ? `知识库 · ${rootParent}` : "知识库"}
                      </span>
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" alignOffset={-4} className="w-52">
                  <DropdownMenuItem onClick={onBackHome}>
                    <House /> 返回欢迎页
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onOpenMarkdownFile}>
                    <FileText /> 打开 Markdown 文件…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onOpenOtherKb}>
                    <FolderOpen /> 打开其它知识库…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onCreateKb}>
                    <FolderPlus /> 新建知识库…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onCopyRootPath}>
                    <Copy /> 复制知识库路径
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onRevealEntry("")}>
                    <FolderOpen /> 在文件管理器中显示
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="mt-1 flex shrink-0 gap-0.5">
                <DropdownMenu>
                  <Hint label="更多目录操作">
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="更多目录操作"
                        className="text-muted-foreground hover:text-foreground hover:bg-hover flex cursor-pointer rounded-md p-1.5"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                  </Hint>
                  <DropdownMenuContent align="end" alignOffset={-4}>
                    <DropdownMenuItem
                      disabled={moveFolders.length <= 1}
                      onClick={() => onSetAllCollapsed(false)}
                    >
                      <UnfoldVertical /> 全部展开
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={moveFolders.length <= 1}
                      onClick={() => onSetAllCollapsed(true)}
                    >
                      <FoldVertical /> 全部折叠
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={enterSelection}>
                      <ListChecks /> 进入批量选择
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <Hint label="新建">
                    <DropdownMenuTrigger asChild>
                      <span className="text-muted-foreground hover:text-foreground hover:bg-hover cursor-pointer rounded-md p-1.5">
                        <Plus className="size-4" />
                      </span>
                    </DropdownMenuTrigger>
                  </Hint>
                  <DropdownMenuContent align="end" alignOffset={-4}>
                    <DropdownMenuItem onClick={() => onCreateDoc("", "未命名文档")}>
                      <SquarePen /> 新建文档
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleCreateFolder("", "新文件夹")}>
                      <FolderPlus /> 新建文件夹
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </div>
          </>
        )}
      </div>
      <SearchBox
        indexReady={indexReady}
        onSearch={onSearch}
        onSelect={onSearchSelect}
        onRebuild={onRebuildIndex}
        preset={searchPreset}
        tags={allTags}
        tagCounts={tagCounts}
        activeTag={tagFilter}
        onTagFilter={onTagFilter}
        recentDocs={recentDocs}
      />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <nav
            ref={navRef}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pt-1 pb-2"
            onDragOver={(e) => {
              // 统一在 nav 上判定落点:几何来自拖起时的快照,与正在动画的行无关
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const next = computeHint(e.clientY);
              const prevHint = dropHintRef.current;
              // 落点没变就别 setState:否则每次 mousemove 都重渲染 + cancel 上一轮动画,
              // 动画永远播不完(看起来就是瞬移)。要变时先把当前视觉位置记下来,
              // FLIP 才能从「此刻」平滑起步。
              if (prevHint?.path !== next?.path || prevHint?.zone !== next?.zone) {
                flipFirstRef.current = captureRowTops();
                setDropHint(next);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              commitNavDrop();
            }}
          >
            {tree.length === 0 ? (
              <div className="text-muted-foreground border-border-subtle mx-1 rounded-xl border border-dashed px-3 py-6 text-center">
                <FolderGlyph open className="mx-auto mb-2 size-5 opacity-45" />
                <p className="text-xs">
                  {tagFilter ? `没有带「#${tagFilter}」标签的文档` : "空知识库"}
                </p>
                {!tagFilter && (
                  <p className="mt-1 text-[10px]">右键或点右上角 + 新建文档</p>
                )}
              </div>
            ) : (
              renderTree.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  currentPath={currentPath}
                  collapsed={collapsed}
                  iconMap={displayIconMap}
                  onOpenIconPicker={openIconPicker}
                  pinnedSet={pinnedSet}
                  pinned={pinnedSet.has(node.path)}
                  selectedPaths={selectedPaths}
                  revealedPath={revealedPath}
                  dragLocked={tagFilter !== null}
                  renamingPath={renamingPath}
                  onBeginRename={setRenamingPath}
                  onEndRename={() => setRenamingPath(null)}
                  onToggle={onToggleCollapse}
                  onTogglePin={onTogglePin}
                  selected={selectedPaths.has(node.path)}
                  onToggleSelect={selectDoc}
                  selectionMode={selectionMode}
                  onSelectSubtree={selectSubtree}
                  onOpenDoc={onOpenDoc}
                  onRevealEntry={onRevealEntry}
                  canCopyWikiRef={canCopyWikiRef}
                  onCopyWikiRef={onCopyWikiRef}
                  onCreateDoc={onCreateDoc}
                  onCreateFolder={(folder, name) => void handleCreateFolder(folder, name)}
                  onRenameEntry={onRenameEntry}
                  onRemoveEntry={onRemoveEntry}
                  onMoveEntry={(src, dest) => onMoveEntry(src, dest)}
                  onBatchTrash={onBatchTrash}
                  onBatchMove={onBatchMove}
                  moveFolders={moveFolders}
                  dragPath={dragPath}
                  dropHint={dropHint}
                  onDragStartRow={beginDrag}
                  onDragEndRow={endDrag}
                />
              ))
            )}
            {/* 撑满剩余空白,顶层目录空白处也能右键 */}
            <div className="min-h-8 flex-1" aria-hidden />
          </nav>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onCreateDoc("", "未命名文档")}>
            <SquarePen /> 新建文档
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void handleCreateFolder("", "新文件夹")}>
            <FolderPlus /> 新建文件夹
          </ContextMenuItem>
          {moveFolders.length > 1 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onSetAllCollapsed(false)}>
                <UnfoldVertical /> 全部展开
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onSetAllCollapsed(true)}>
                <FoldVertical /> 全部折叠
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {/* 左栏底部只保留知识库工具;工作区切换在顶部库身份卡,避免和回收站混层 */}
      <div className="border-border-subtle flex shrink-0 flex-col gap-1 border-t p-2">
        {orphanCount > 0 && (
          <button
            className="text-primary hover:bg-hover flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs"
            onClick={onOpenOrphans}
          >
            <CircleAlert className="size-3.5 shrink-0" />
            未识别条目
            <span className="bg-primary/10 rounded-full px-1.5 text-[10px] leading-4">
              {orphanCount}
            </span>
          </button>
        )}
        <button
          aria-label={trashCount > 0 ? `回收站,${trashCount} 项` : "回收站"}
          className={cn(
            "chrome-trash hover:bg-hover hover:text-foreground flex h-8 w-full cursor-pointer items-center justify-between rounded-lg border px-2.5 text-xs transition-colors",
            trashCount > 0
              ? "chrome-trash-filled border-border-subtle bg-raised/65 text-foreground/75 shadow-sm"
              : "text-muted-foreground/80 border-transparent",
          )}
          onClick={onOpenTrash}
        >
          <span className="flex items-center gap-2">
            <TrashGlyph className="size-3.5" />
            回收站
          </span>
          {trashCount > 0 && (
            <span className="bg-hover text-muted-foreground rounded-full px-1.5 text-[10px] leading-4 tabular-nums">
              {trashCount}
            </span>
          )}
        </button>
      </div>
      <IconPickerDialog
        open={!!iconPickerNode}
        onOpenChange={(open) => {
          if (!open) setIconPickerPath(null);
        }}
        targetName={iconPickerNode?.name ?? ""}
        targetIcon={iconPickerNode ? (displayIconMap.get(iconPickerNode.path) ?? null) : null}
        onSelect={(icon) => {
          const node = iconPickerNode;
          setIconPickerPath(null);
          if (!node) return;
          setIconOverrides((prev) => {
            const base = prev?.base === iconMap ? prev.base : iconMap;
            const values = new Map(prev?.base === iconMap ? prev.values : []);
            values.set(node.path, icon);
            return { base, values };
          });
          // 先等关窗动画结束再写 meta/触发 entryIcons revision,避免关窗、目录树和标签页同帧重渲。
          window.setTimeout(() => onSetEntryIcon(node.path, node.isDir, icon), 120);
        }}
      />
    </aside>
  );
}
