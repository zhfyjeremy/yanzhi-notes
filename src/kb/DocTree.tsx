import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  PenLine,
  Plus,
  Settings,
  SquarePen,
  Trash2,
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
}

type DropZone = "before" | "after" | "into";

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
  onToggle,
  onOpenDoc,
  onCreateDoc,
  onCreateFolder,
  onRenameEntry,
  onRemoveEntry,
  dragPath,
  dropHint,
  onDragOverRow,
  onDropRow,
}: {
  node: TreeNode;
  depth: number;
  currentPath: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpenDoc: (rel: string) => void;
  onCreateDoc: (folderRel: string, title: string) => void;
  onCreateFolder: (folderRel: string, name: string) => void;
  onRenameEntry: (rel: string, name: string) => void;
  onRemoveEntry: (rel: string) => void;
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
          <button
            data-path={node.path}
            className={cn(
              "group flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-sm",
              active
                ? "bg-accent text-accent-foreground"
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
              if (!dragged || dragged === node.path || node.path.startsWith(dragged + "/")) return;
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
            onClick={() => (node.isDir ? onToggle(node.path) : onOpenDoc(node.path))}
          >
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
              <FileText className="text-muted-foreground ml-[18px] size-4 shrink-0" />
            )}
            <span className="truncate">{node.name}</span>
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
          </button>
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
              <ContextMenuSeparator />
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
              onToggle={onToggle}
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
}: DocTreeProps) {
  const dragPath = useRef<string | null>(null);
  const [dropHint, setDropHint] = useState<{ path: string; zone: DropZone } | null>(null);
  const rootName = useMemo(() => root.split("/").filter(Boolean).pop() ?? root, [root]);
  const navRef = useRef<HTMLElement>(null);

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
        <span className="truncate text-xs font-medium" title={root}>
          {rootName}
        </span>
        <span className="ml-auto flex gap-0.5">
          {/* 语雀式:新建收敛为单个「+」下拉(文档/文件夹),头部只留 +;
              导入导出在原生菜单「文件」里,重建索引在设置/搜索空态,设置 = 左栏底部齿轮 */}
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
      </div>
      <SearchBox
        indexReady={indexReady}
        onSearch={onSearch}
        onSelect={onSearchSelect}
        onRebuild={onRebuildIndex}
        preset={searchPreset}
      />
      <nav
        ref={navRef}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1"
        onDragOver={(e) => e.preventDefault()} /* 允许拖到空白处松手(仅清除提示) */
      >
        {tree.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-xs">
            空知识库:点击上方按钮新建第一篇文档
          </p>
        ) : (
          tree.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              currentPath={currentPath}
              collapsed={collapsed}
              onToggle={onToggleCollapse}
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
