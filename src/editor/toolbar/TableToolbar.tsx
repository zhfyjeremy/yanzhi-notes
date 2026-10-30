import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Columns3,
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
import { getTableContext, setColumnAlign, type ColumnAlign } from "../table-utils";

/**
 * 表格编辑工具条(PRD §5.3.9):光标进入表格时浮在表格上方。
 * 行列增删走 @tiptap/extension-table 内置命令(含 Tab 切换单元格);对齐走 table-utils 整列设置。
 * 绝对定位于正文容器(YanzhiEditor 里挂了 relative 的包裹层),随内容滚动,容器宽度变化由 ResizeObserver 兜底重算。
 */

const TOOLBAR_HEIGHT = 34;

const ALIGN_ITEMS = [
  { key: "left", label: "左对齐", icon: AlignLeft },
  { key: "center", label: "居中", icon: AlignCenter },
  { key: "right", label: "右对齐", icon: AlignRight },
] as const;

interface TableToolbarProps {
  editor: Editor;
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const ctx = getTableContext(editor.state);
      return {
        inTable: !!ctx,
        // tablePos/行列数任一变化都触发重算定位(表格在 doc 里的位置变了)
        tablePos: ctx?.tablePos ?? -1,
        rows: ctx?.rows ?? 0,
        cols: ctx?.cols ?? 0,
        align: ctx?.align ?? null,
      };
    },
  });

  // 定位:锚在表格左上方。单元格内编辑不会移动表格左上角,无需逐键重算
  useLayoutEffect(() => {
    if (!state.inTable || state.tablePos < 0) {
      setPos(null);
      return;
    }
    const host = ref.current?.parentElement;
    // TableView 会包一层 .tableWrapper,锚点要取里面的真实 table
    const dom = editor.view.nodeDOM(state.tablePos) as HTMLElement | null;
    const tableEl =
      dom?.tagName === "TABLE"
        ? dom
        : ((dom?.querySelector("table") as HTMLElement | null) ?? dom);
    if (!host || !tableEl) {
      setPos(null);
      return;
    }
    const t = tableEl.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    setPos({
      top: Math.max(0, t.top - h.top - TOOLBAR_HEIGHT - 6),
      left: t.left - h.left,
    });
  }, [editor, state.inTable, state.tablePos, state.rows, state.cols, layoutTick]);

  // 容器宽度变化(窗口缩放/TOC 面板开合)时重算定位
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  if (!state.inTable || !pos) {
    // 保持挂载:hidden 态也占位,确保 parentElement/ResizeObserver 稳定
    return <div ref={ref} className="hidden" aria-hidden="true" />;
  }

  const rowItems = [
    { label: "在上方插入行", disabled: false, fn: () => editor.chain().focus().addRowBefore().run() },
    { label: "在下方插入行", disabled: false, fn: () => editor.chain().focus().addRowAfter().run() },
    {
      label: "删除行",
      disabled: state.rows <= 1,
      fn: () => editor.chain().focus().deleteRow().run(),
    },
  ];

  const colItems = [
    { label: "在左侧插入列", disabled: false, fn: () => editor.chain().focus().addColumnBefore().run() },
    { label: "在右侧插入列", disabled: false, fn: () => editor.chain().focus().addColumnAfter().run() },
    {
      label: "删除列",
      disabled: state.cols <= 1,
      fn: () => editor.chain().focus().deleteColumn().run(),
    },
  ];

  return (
    <div
      ref={ref}
      className="bg-background/95 absolute z-20 flex items-center gap-0.5 rounded-lg p-0.5 shadow-md backdrop-blur"
      style={{ top: pos.top, left: pos.left, height: TOOLBAR_HEIGHT }}
    >
      {/* 行操作 */}
      <MenuButton icon={Rows3} label="行" items={rowItems} />
      {/* 列操作 */}
      <MenuButton icon={Columns3} label="列" items={colItems} />

      <div className="mx-1 h-5 w-px shrink-0 bg-border" />

      {/* 对齐:整列设置;点击已生效项还原默认 */}
      {ALIGN_ITEMS.map(({ key, label, icon: Icon }) => (
        <Hint key={key} label={label}>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "text-muted-foreground hover:text-foreground",
              state.align === key && "bg-accent text-accent-foreground hover:text-accent-foreground",
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

      <div className="mx-1 h-5 w-px shrink-0 bg-border" />

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

interface MenuItem {
  label: string;
  disabled?: boolean;
  fn: () => void;
}

function MenuButton({
  icon: Icon,
  label,
  items,
}: {
  icon: typeof Rows3;
  label: string;
  items: MenuItem[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground px-2"
          onMouseDown={(e) => e.preventDefault()}
        >
          <Icon className="size-3.5" />
          {label}
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        {items.map((item, i) => (
          <div key={item.label}>
            {i === items.length - 1 && <DropdownMenuSeparator className="my-1" />}
            <DropdownMenuItem disabled={item.disabled} onClick={item.fn}>
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
