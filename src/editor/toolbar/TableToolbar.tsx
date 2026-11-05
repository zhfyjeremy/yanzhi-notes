import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  ChevronDown,
  Columns3,
  Copy,
  Rows3,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  applyTableStructure,
  getTableContext,
  insertTableAxis,
  setColumnAlign,
  toStructureAnchor,
  type ColumnAlign,
  type TableStructureAnchor,
  type TableStructureOp,
} from "../table-utils";

/**
 * 表格编辑工具条(PRD §5.3.9):光标进入表格时浮在表格上方。
 * 对齐走 table-utils 整列设置;行列增删按打开菜单时冻结的 tablePos/行列下标改结构。
 * 「行/列」菜单里上下(左右)插入带数量框 + 勾选确认(借鉴常见表格软件交互)。
 */

const TOOLBAR_HEIGHT = 34;
const BATCH_MAX = 50;

const ALIGN_ITEMS = [
  { key: "left", label: "左对齐", icon: AlignLeft },
  { key: "center", label: "居中", icon: AlignCenter },
  { key: "right", label: "右对齐", icon: AlignRight },
] as const;

interface TableToolbarProps {
  editor: Editor;
  /** 单元格悬停复制(与设置 tableCellCopy 同源) */
  cellCopy?: boolean;
  onToggleCellCopy?: () => void;
}

export function TableToolbar({ editor, cellCopy = false, onToggleCellCopy }: TableToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const structureAnchorRef = useRef<TableStructureAnchor | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const ctx = getTableContext(editor.state);
      return {
        inTable: !!ctx,
        tablePos: ctx?.tablePos ?? -1,
        rows: ctx?.rows ?? 0,
        cols: ctx?.cols ?? 0,
        colKey: ctx?.colIndexes.join(",") ?? "",
        align: ctx?.align ?? null,
        anchor: ctx ? toStructureAnchor(ctx) : null,
      };
    },
  });

  useLayoutEffect(() => {
    if ((!state.inTable && !menuOpen) || (state.tablePos < 0 && !menuOpen)) {
      if (!menuOpen) setPos(null);
      return;
    }
    const host = ref.current?.parentElement;
    const tablePos =
      menuOpen && structureAnchorRef.current
        ? structureAnchorRef.current.tablePos
        : state.tablePos;
    if (tablePos < 0) {
      if (!menuOpen) setPos(null);
      return;
    }
    const dom = editor.view.nodeDOM(tablePos) as HTMLElement | null;
    const tableEl =
      dom?.tagName === "TABLE"
        ? dom
        : ((dom?.querySelector("table") as HTMLElement | null) ?? dom);
    if (!host || !tableEl) {
      if (!menuOpen) setPos(null);
      return;
    }
    const t = tableEl.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setPos({
      top: Math.max(0, t.top - h.top - TOOLBAR_HEIGHT - 6),
      left: t.left - h.left,
    });
  }, [editor, state.inTable, state.tablePos, state.rows, state.cols, layoutTick, menuOpen]);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const visible = (state.inTable || menuOpen) && pos;
  if (!visible) {
    return <div ref={ref} className="hidden" aria-hidden="true" />;
  }

  const rows = (menuOpen && structureAnchorRef.current?.rows) || state.rows;
  const cols = (menuOpen && structureAnchorRef.current?.cols) || state.cols;

  const snapshotStructureAnchor = () => {
    const ctx = getTableContext(editor.state);
    if (ctx) structureAnchorRef.current = toStructureAnchor(ctx);
  };

  const resolveAnchor = () => structureAnchorRef.current ?? state.anchor;

  const runStructure = (op: TableStructureOp) => {
    const anchor = resolveAnchor();
    if (!anchor) return;
    applyTableStructure(editor, anchor, op);
    editor.commands.focus();
  };

  const runBatch = (
    axis: "row" | "column",
    where: "before" | "after",
    count: number,
  ) => {
    const anchor = resolveAnchor();
    if (!anchor) return;
    if (insertTableAxis(editor, anchor, count, axis, where)) editor.commands.focus();
  };

  const onStructureMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) snapshotStructureAnchor();
    else structureAnchorRef.current = null;
  };

  return (
    <div
      ref={ref}
      className="chrome-float bg-popover border-border-subtle absolute z-20 flex items-center gap-0.5 rounded-lg border p-0.5 shadow-lg"
      style={{ top: pos.top, left: pos.left, height: TOOLBAR_HEIGHT }}
    >
      <span className="text-muted-foreground px-1.5 text-[10px] font-semibold tracking-wide">表格</span>
      <div className="bg-border-subtle mx-0.5 h-4 w-px shrink-0" />
      <AxisMenu
        icon={Rows3}
        label="行"
        deleteLabel="删除行"
        deleteDisabled={rows <= 1}
        beforeLabel="在上方插入行"
        afterLabel="在下方插入行"
        onPrepare={snapshotStructureAnchor}
        onOpenChange={onStructureMenuOpenChange}
        onDelete={() => runStructure("deleteRow")}
        onInsert={(where, count) => runBatch("row", where, count)}
      />
      <AxisMenu
        icon={Columns3}
        label="列"
        deleteLabel="删除列"
        deleteDisabled={cols <= 1}
        beforeLabel="在左侧插入列"
        afterLabel="在右侧插入列"
        onPrepare={snapshotStructureAnchor}
        onOpenChange={onStructureMenuOpenChange}
        onDelete={() => runStructure("deleteColumn")}
        onInsert={(where, count) => runBatch("column", where, count)}
      />

      <div className="bg-border-subtle mx-1 h-4 w-px shrink-0" />

      {ALIGN_ITEMS.map(({ key, label, icon: Icon }) => (
        <Hint key={key} label={label}>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              state.align === key && "bg-selection text-foreground ring-primary/20 hover:text-foreground ring-1",
            )}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setColumnAlign(editor, state.align === key ? null : (key as ColumnAlign))
            }
          >
            <Icon className="size-3.5" />
          </Button>
        </Hint>
      ))}

      {onToggleCellCopy && (
        <>
          <div className="bg-border-subtle mx-1 h-4 w-px shrink-0" />
          <Hint label={cellCopy ? "关闭单元格复制" : "开启单元格复制"}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-pressed={cellCopy}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                cellCopy && "bg-selection text-foreground ring-primary/20 hover:text-foreground ring-1",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleCellCopy}
            >
              <Copy className="size-3.5" />
            </Button>
          </Hint>
        </>
      )}

      <div className="bg-border-subtle mx-1 h-4 w-px shrink-0" />

      <Hint label="删除表格">
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </Hint>
    </div>
  );
}

function AxisMenu({
  icon: Icon,
  label,
  beforeLabel,
  afterLabel,
  deleteLabel,
  deleteDisabled,
  onPrepare,
  onOpenChange,
  onDelete,
  onInsert,
}: {
  icon: typeof Rows3;
  label: string;
  beforeLabel: string;
  afterLabel: string;
  deleteLabel: string;
  deleteDisabled: boolean;
  onPrepare: () => void;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onInsert: (where: "before" | "after", count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openSeq, setOpenSeq] = useState(0);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next) setOpenSeq((s) => s + 1);
        setOpen(next);
        onOpenChange(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground px-2"
          onMouseDown={(e) => {
            e.preventDefault();
            onPrepare();
          }}
        >
          <Icon className="size-3.5" />
          {label}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-52 p-1"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* openSeq 每次打开递增,数量框回到默认 1 */}
        <CountInsertRow
          key={`before-${openSeq}`}
          label={beforeLabel}
          onCommit={(n) => {
            onInsert("before", n);
            setOpen(false);
            onOpenChange(false);
          }}
        />
        <CountInsertRow
          key={`after-${openSeq}`}
          label={afterLabel}
          onCommit={(n) => {
            onInsert("after", n);
            setOpen(false);
            onOpenChange(false);
          }}
        />
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuItem
          disabled={deleteDisabled}
          onMouseDown={(e) => e.preventDefault()}
          onSelect={(e) => {
            e.preventDefault();
            onDelete();
          }}
        >
          {deleteLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 把草稿规范到 1–50;空/非法 → 1 */
function clampBatchCount(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(BATCH_MAX, Math.max(1, n));
}

/** 借鉴常见表格软件:标签 + 数量框(默认可手输 1–50) + 勾选确认 */
function CountInsertRow({
  label,
  onCommit,
}: {
  label: string;
  onCommit: (count: number) => void;
}) {
  const [count, setCount] = useState("1");

  const commit = () => {
    const n = clampBatchCount(count);
    setCount(String(n));
    onCommit(n);
  };

  const step = (delta: number) => {
    setCount(String(clampBatchCount(String(clampBatchCount(count) + delta))));
  };

  return (
    <div
      className="hover:bg-accent focus-within:bg-accent flex items-center gap-1.5 rounded-md px-2 py-1.5"
      onPointerDown={(e) => {
        // 输入框必须能聚焦才能手输;对其它区域 preventDefault 防止 radix 菜单抢焦点关掉
        if ((e.target as HTMLElement).closest("input")) return;
        e.preventDefault();
      }}
    >
      <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">{label}</span>
      <div className="border-border-subtle bg-raised focus-within:border-foreground relative flex h-6 w-12 shrink-0 overflow-hidden rounded border">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          aria-label={`${label}数量,1 到 ${BATCH_MAX}`}
          title={`1–${BATCH_MAX}`}
          value={count}
          onPointerDown={(e) => {
            // 阻断冒泡到 DropdownMenu,同时保留默认聚焦
            e.stopPropagation();
          }}
          onChange={(e) => {
            // 允许清空再手输;只留数字
            const next = e.target.value.replace(/\D/g, "").slice(0, 2);
            setCount(next);
          }}
          onBlur={() => setCount(String(clampBatchCount(count)))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className="h-full w-full bg-transparent pr-3 pl-1 text-center text-[12px] outline-none"
        />
        <div className="border-border-subtle absolute top-0 right-0 flex h-full w-3 flex-col border-l">
          <button
            type="button"
            tabIndex={-1}
            aria-label="增加"
            className="text-muted-foreground hover:text-foreground hover:bg-hover flex flex-1 items-center justify-center"
            onClick={() => step(1)}
          >
            <ChevronDown className="size-2.5 rotate-180" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="减少"
            className="text-muted-foreground hover:text-foreground hover:bg-hover border-border-subtle flex flex-1 items-center justify-center border-t"
            onClick={() => step(-1)}
          >
            <ChevronDown className="size-2.5" />
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="确认插入"
        className="text-muted-foreground hover:text-foreground hover:bg-hover flex size-6 shrink-0 items-center justify-center rounded"
        onClick={commit}
      >
        <Check className="size-3.5" />
      </button>
    </div>
  );
}
