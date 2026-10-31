import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CheckSquare2,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Hash,
  ListChecks,
  PenLine,
  Pin,
  Plus,
  Settings,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import type { TreeNode } from "./types";
import type { SearchHit } from "./search";
import { SearchBox } from "./SearchBox";
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
import { cn } from "@/lib/utils";
import { Hint } from "@/components/hint";
import { BatchDocActions } from "./BatchDocActions";
import type { BatchRenameItem, BatchResult } from "./batch";

/**
 * 左栏目录树(M3 / PRD 5.1):递归渲染、点击切换文档、当前文档高亮、拖拽排序。
 * 行操作走语雀式两级:文件夹 hover 仅一个「+」下拉(新建文档/子文件夹),
 * 重命名/删除进右键菜单(删除直接执行,移入回收站可恢复);
 * 重命名 = 行内编辑(Enter 确认 Esc 取消失焦提交)。
 * 排序 = meta.sortIndex(拖拽落点重写整组兄弟序);折叠状态持久化进 meta。
 */

interface DocTreeProps {
  root: string;
  tree: TreeNode[];
  currentPath: string | null;
  collapsed: Set<string>;
  indexReady: boolean;
  onToggleCollapse: (folderRel: string) => void;
  onOpenDoc: (rel: string) => void;
  onCreateDoc: (folderRel: string, title: string) => void;
  onCreateFolder: (folderRel: string, name: string) => void;
  onRenameEntry: (rel: string, name: string) => void;
  onRemoveEntry: (rel: string) => void;
  onReorder: (parentRel: string, orderedPaths: string[]) => void;
  /** 拖入文件夹 / 跨组 before-after = 移动(改父目录,5.1 调整层级);
   *  orderedPaths 提供时按其落位,否则目标组落尾 */
  onMoveEntry: (srcRel: string, destFolderRel: string, orderedPaths?: string[]) => void;
  onSearch: (q: string) => SearchHit[];
  onSearchSelect: (rel: string, term: string) => void;
  /** 外部预置搜索词,透传 SearchBox(失效双链「搜索同名文档」) */
  searchPreset?: { term: string; seq: number } | null;
  onRebuildIndex: () => void;
  onOpenSettings: () => void;
  onOpenTrash: () => void;
  /** 失联 meta 条数(5.2.1);>0 才渲染底部入口 */
  orphanCount: number;
  onOpenOrphans: () => void;
  /* ---- 置顶与标签(6.3-2/3) ---- */
  /** 置顶文档路径集合(树序在 meta 排序处已提前;此处用于图标与拖拽豁免) */
  pinnedSet: Set<string>;
  onTogglePin: (rel: string, pinned: boolean) => void;
  /** 全库标签(筛选下拉) */
  allTags: string[];
  /** 激活中的标签筛选;null = 未筛选(树已由上层过滤,过滤态禁拖) */
  tagFilter: string | null;
  onTagFilter: (tag: string | null) => void;
  /* ---- V3 批量文档操作 ---- */
  onBatchMove: (rels: string[], destFolder: string) => Promise<BatchResult>;
  onBatchSetTags: (rels: string[], add: string[], remove: string[]) => Promise<BatchResult>;
  onBatchRename: (items: BatchRenameItem[]) => Promise<BatchResult>;
  onToast: (message: string) => void;
}

type DropZone = "before" | "after" | "into";

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

const parentOf = (rel: string): string => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

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
    >
      <path d="M2.5 4.5h11" />
      <path d="M6.5 4.5V3.5c0-.55.45-1 1-1h1c.55 0 1 .45 1 1v1" />
      <path d="M4 4.5l.6 8c.04.55.5 1 1.05 1h4.7c.55 0 1.01-.45 1.05-1l.6-8" />
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

function TreeRow({
  node,
  depth,
  currentPath,
  collapsed,
  pinnedSet,
  pinned,
  selectedPaths,
  selectionMode,
  dragLocked,
  onToggle,
  onOpenDoc,
  onCreateDoc,
  onCreateFolder,
  onRenameEntry,
  onRemoveEntry,
  onTogglePin,
  selected,
  onToggleSelect,
  onSelectSubtree,
  dragPath,
  dropHint,
  onDragOverRow,
  onDropRow,
}: {
  node: TreeNode;
  depth: number;
  currentPath: string | null;
  collapsed: Set<string>;
  pinnedSet: Set<string>;
  pinned: boolean;
  selectedPaths: Set<string>;
  selectionMode: boolean;
  /** 标签筛选态:树是过滤视图,拖拽排序/移动会错位隐藏兄弟 → 全禁 */
  dragLocked: boolean;
  onToggle: (path: string) => void;
  onOpenDoc: (rel: string) => void;
  onCreateDoc: (folderRel: string, title: string) => void;
  onCreateFolder: (folderRel: string, name: string) => void;
  onRenameEntry: (rel: string, name: string) => void;
  onRemoveEntry: (rel: string) => void;
  onTogglePin: (rel: string, pinned: boolean) => void;
  selected: boolean;
  onToggleSelect: (rel: string, shift: boolean) => void;
  onSelectSubtree: (folderRel: string) => void;
  dragPath: React.MutableRefObject<string | null>;
  dropHint: { path: string; zone: DropZone } | null;
  onDragOverRow: (path: string, zone: DropZone | null) => void;
  onDropRow: (target: string, zone: DropZone) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const active = !node.isDir && node.path === currentPath;
  const isCollapsed = collapsed.has(node.path);
  const pad = { paddingLeft: 8 + depth * 14 };
  const hint = dropHint?.path === node.path ? dropHint.zone : null;
  // 置顶行不参与拖拽(永远在组内最上,落位无意义);筛选态全禁
  const noDrag = dragLocked || (pinned && !node.isDir);

  if (renaming) {
    const commit = (value: string) => {
      setRenaming(false);
      const v = value.trim();
      if (v && v !== node.name) onRenameEntry(node.path, v);
    };
    return (
      <div className="flex w-full items-center gap-1 py-1 pr-2" style={pad}>
        {node.isDir ? (
          <FolderOpen className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <FileText className="text-muted-foreground ml-[18px] size-4 shrink-0" />
        )}
        <input
          autoFocus
          defaultValue={node.name}
          className="border-input bg-background h-6 min-w-0 flex-1 rounded px-1 text-sm outline-none focus:ring-1 focus:ring-ring"
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value);
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            data-path={node.path}
            className={cn(
              "group flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm",
              active
                ? "bg-accent text-accent-foreground"
                : selected
                  ? "bg-primary/10 text-foreground"
                  : "hover:bg-accent/50 text-foreground/90",
              hint === "into" && "bg-primary/10 ring-primary/40 ring-1",
            )}
            style={{
              ...pad,
              ...(hint === "before"
                ? { boxShadow: "inset 0 2px 0 0 var(--primary)" }
                : hint === "after"
                  ? { boxShadow: "inset 0 -2px 0 0 var(--primary)" }
                  : {}),
            }}
            draggable
            onDragStart={(e) => {
              if (noDrag) {
                e.preventDefault();
                return;
              }
              dragPath.current = node.path;
              e.dataTransfer.effectAllowed = "move";
              // WebKit/WKWebView 必须在 dragstart 里 setData 才会发起拖拽(Chrome 不要求)
              e.dataTransfer.setData("text/plain", node.path);
              // 自定义拖影省略:整行 ghost 即语义
            }}
            onDragEnd={() => {
              dragPath.current = null;
              onDragOverRow(node.path, null);
            }}
            onDragOver={(e) => {
              const dragged = dragPath.current;
              if (dragLocked || !dragged || dragged === node.path || node.path.startsWith(dragged + "/")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientY - rect.top) / rect.height;
              const zone: DropZone = node.isDir
                ? ratio < 0.25
                  ? "before"
                  : ratio > 0.75
                    ? "after"
                    : "into"
                : ratio < 0.5
                  ? "before"
                  : "after";
              onDragOverRow(node.path, zone);
            }}
            onDragLeave={() => onDragOverRow(node.path, null)}
            onDrop={(e) => {
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientY - rect.top) / rect.height;
              const zone: DropZone = node.isDir
                ? ratio < 0.25
                  ? "before"
                  : ratio > 0.75
                    ? "after"
                    : "into"
                : ratio < 0.5
                  ? "before"
                  : "after";
              onDropRow(node.path, zone);
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
              <span className="size-3.5 shrink-0" />
            ) : (
              <button
                type="button"
                aria-label={selected ? `取消选择「${node.name}」` : `选择「${node.name}」`}
                aria-pressed={selected}
                className={cn(
                  "text-muted-foreground hover:text-primary flex size-3.5 shrink-0 cursor-pointer items-center justify-center",
                  selected && "text-primary",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(node.path, false);
                }}
              >
                {selected ? <CheckSquare2 className="size-3.5" /> : <Square className="size-3.5" />}
              </button>
            )}
            {node.isDir ? (
              <>
                {isCollapsed ? (
                  <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                )}
                {isCollapsed ? (
                  <FolderClosed className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                )}
              </>
            ) : (
              <FileText className="text-muted-foreground size-4 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
            {pinned && !node.isDir && (
              <Pin className="text-primary/70 ml-auto size-3 shrink-0" aria-label="已置顶" />
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
                      <span className="text-muted-foreground hover:text-foreground cursor-pointer rounded p-0.5">
                        <Plus className="size-3.5" />
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
        <ContextMenuContent>
          {node.isDir && (
            <>
              <ContextMenuItem onClick={() => onCreateDoc(node.path, "未命名文档")}>
                <SquarePen /> 新建文档
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onCreateFolder(node.path, "新文件夹")}>
                <FolderPlus /> 新建子文件夹
              </ContextMenuItem>
              <ContextMenuItem disabled={countDocs(node) === 0} onClick={() => onSelectSubtree(node.path)}>
                <ListChecks /> 选择文件夹内全部文档
              </ContextMenuItem>
              <ContextMenuSeparator />
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
            </>
          )}
          <ContextMenuItem onClick={() => setRenaming(true)}>
            <PenLine /> 重命名
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            // 有内容的文件夹加原生 title 兜底(空文件夹/文档不加)
            title={
              node.isDir && countDocs(node) > 0
                ? `含 ${countDocs(node)} 篇文档,移入回收站`
                : undefined
            }
            onClick={() => onRemoveEntry(node.path)}
          >
            <Trash2 /> 移入回收站
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {node.isDir && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              currentPath={currentPath}
              collapsed={collapsed}
              pinnedSet={pinnedSet}
              pinned={pinnedSet.has(child.path)}
              selectedPaths={selectedPaths}
              dragLocked={dragLocked}
              onToggle={onToggle}
              onTogglePin={onTogglePin}
              selected={selectedPaths.has(child.path)}
              onToggleSelect={onToggleSelect}
              selectionMode={selectionMode}
              onSelectSubtree={onSelectSubtree}
              onOpenDoc={onOpenDoc}
              onCreateDoc={onCreateDoc}
              onCreateFolder={onCreateFolder}
              onRenameEntry={onRenameEntry}
              onRemoveEntry={onRemoveEntry}
              dragPath={dragPath}
              dropHint={dropHint}
              onDragOverRow={onDragOverRow}
              onDropRow={onDropRow}
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
  onOpenDoc,
  onCreateDoc,
  onCreateFolder,
  onRenameEntry,
  onRemoveEntry,
  onReorder,
  onMoveEntry,
  onSearch,
  onSearchSelect,
  searchPreset,
  onRebuildIndex,
  onOpenSettings,
  onOpenTrash,
  orphanCount,
  onOpenOrphans,
  pinnedSet,
  onTogglePin,
  allTags,
  tagFilter,
  onTagFilter,
  onBatchMove,
  onBatchSetTags,
  onBatchRename,
  onToast,
}: DocTreeProps) {
  const dragPath = useRef<string | null>(null);
  const [dropHint, setDropHint] = useState<{ path: string; zone: DropZone } | null>(null);
  const rootName = useMemo(() => root.split("/").filter(Boolean).pop() ?? root, [root]);
  const navRef = useRef<HTMLElement>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const selectionAnchor = useRef<string | null>(null);
  const visibleDocs = useMemo(() => visibleDocPaths(tree, collapsed), [tree, collapsed]);
  const allVisibleSelected = visibleDocs.length > 0 && visibleDocs.every((p) => selectedPaths.has(p));

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedPaths(new Set());
    selectionAnchor.current = null;
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

  /** 拖拽落点 → 整组兄弟新顺序(交给上层写 meta.sortIndex) */
  const commitDrop = (target: string, zone: DropZone) => {
    const dragged = dragPath.current;
    dragPath.current = null;
    setDropHint(null);
    if (!dragged || dragged === target) return;
    if (target.startsWith(dragged + "/")) return; // 不能拖进自己的子树
    // 置顶行永远在组内最上,before/after 落位无意义(拖拽发起端已禁,此处兜底)
    if (zone !== "into" && pinnedSet.has(target)) return;
    if (zone === "into") {
      // 层级调整 = 文件系统移动(名字不变),排序由 moveEntry 落尾
      onMoveEntry(dragged, target);
      return;
    }
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
  };

  return (
    <aside className="bg-background flex w-60 min-w-60 flex-col border-r border-border">
      <div className="flex h-10 shrink-0 items-center gap-1 px-3">
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
            onToast={onToast}
          />
        ) : (
          <>
            <span className="truncate text-xs font-medium" title={root}>
              {rootName}
            </span>
            <span className="ml-auto flex gap-0.5">
              <Hint label="进入批量选择">
                <button
                  type="button"
                  aria-label="进入批量选择"
                  className="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-pointer rounded p-1"
                  onClick={enterSelection}
                >
                  <ListChecks className="size-4" />
                </button>
              </Hint>
              <DropdownMenu>
                <Hint label="新建">
                  <DropdownMenuTrigger asChild>
                    <span className="text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer rounded p-1">
                      <Plus className="size-4" />
                    </span>
                  </DropdownMenuTrigger>
                </Hint>
                <DropdownMenuContent align="end" alignOffset={-4}>
                  <DropdownMenuItem onClick={() => onCreateDoc("", "未命名文档")}>
                    <SquarePen /> 新建文档
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onCreateFolder("", "新文件夹")}>
                    <FolderPlus /> 新建文件夹
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </>
        )}
      </div>
      <SearchBox
        indexReady={indexReady}
        onSearch={onSearch}
        onSelect={onSearchSelect}
        onRebuild={onRebuildIndex}
        preset={searchPreset}
      />
      {(allTags.length > 0 || tagFilter) && (
        /* 标签筛选条(6.3-2):下拉选全库标签;激活时显示当前标签 + 清除 */
        <div className="flex h-7 shrink-0 items-center gap-1.5 px-2 text-xs">
          <DropdownMenu>
            <Hint label="按标签筛选文档">
              <DropdownMenuTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-0.5 rounded px-1 py-0.5">
                  <Hash className="size-3" />
                  标签
                </button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="start" alignOffset={-4}>
              {allTags.length === 0 ? (
                <div className="text-muted-foreground px-2 py-1 text-xs">暂无标签</div>
              ) : (
                allTags.map((t) => (
                  <DropdownMenuItem key={t} onClick={() => onTagFilter(t === tagFilter ? null : t)}>
                    <Hash /> {t}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {tagFilter && (
            <span className="border-primary/45 bg-primary/10 text-primary inline-flex max-w-32 items-center gap-0.5 truncate rounded-full border px-1.5 py-0.5 text-[11px] leading-4">
              <span className="truncate">#{tagFilter}</span>
              <button
                className="hover:text-foreground shrink-0 cursor-pointer"
                title="清除筛选"
                onClick={() => onTagFilter(null)}
              >
                <X className="size-3" />
              </button>
            </span>
          )}
        </div>
      )}
      <nav
        ref={navRef}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1"
        onDragOver={(e) => e.preventDefault()} /* 允许拖到空白处松手(仅清除提示) */
      >
        {tree.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs">
            {tagFilter ? `没有带「#${tagFilter}」标签的文档` : "空知识库:点击上方按钮新建第一篇文档"}
          </p>
        ) : (
          tree.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              currentPath={currentPath}
              collapsed={collapsed}
              pinnedSet={pinnedSet}
              pinned={pinnedSet.has(node.path)}
              selectedPaths={selectedPaths}
              dragLocked={tagFilter !== null}
              onToggle={onToggleCollapse}
              onTogglePin={onTogglePin}
              selected={selectedPaths.has(node.path)}
              onToggleSelect={selectDoc}
              selectionMode={selectionMode}
              onSelectSubtree={selectSubtree}
              onOpenDoc={onOpenDoc}
              onCreateDoc={onCreateDoc}
              onCreateFolder={onCreateFolder}
              onRenameEntry={onRenameEntry}
              onRemoveEntry={onRemoveEntry}
              dragPath={dragPath}
              dropHint={dropHint}
              onDragOverRow={(path, zone) => {
                setDropHint((prev) => {
                  if (zone) return prev?.path === path && prev.zone === zone ? prev : { path, zone };
                  return prev?.path === path ? null : prev;
                });
              }}
              onDropRow={commitDrop}
            />
          ))
        )}
      </nav>
      {/* 语雀式:低频入口放左栏底部;未识别条目有失联时才出现(5.2.1),主色轻提示 */}
      <div className="flex shrink-0 flex-col border-t border-border">
        {orphanCount > 0 && (
          <button
            className="text-primary hover:bg-accent/50 flex h-8 cursor-pointer items-center gap-2 px-3 text-xs"
            onClick={onOpenOrphans}
          >
            <CircleAlert className="size-3.5 shrink-0" />
            未识别条目
            <span className="bg-primary/10 rounded-full px-1.5 text-[10px] leading-4">
              {orphanCount}
            </span>
          </button>
        )}
        <div className="flex h-8 items-center">
          <button
            className="text-muted-foreground hover:bg-accent/50 hover:text-foreground flex flex-1 cursor-pointer items-center gap-2 px-3 text-xs"
            onClick={onOpenTrash}
          >
            <TrashGlyph className="size-3.5" />
            回收站
          </button>
          {/* 常驻齿轮:设置是中频操作,只藏 ⋯ 菜单里不够显眼(语雀/Notion 同款左栏底部) */}
          <Hint label="设置">
            <button
              className="text-muted-foreground hover:bg-accent/50 hover:text-foreground mr-1.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded"
              onClick={onOpenSettings}
            >
              <Settings className="size-3.5" />
            </button>
          </Hint>
        </div>
      </div>
    </aside>
  );
}
