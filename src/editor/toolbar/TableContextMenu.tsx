import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Check } from "lucide-react";
import { placeFloatMenu, type FloatMenuPos } from "../../ai/float-menu";
import {
  applyTableStructure,
  deleteTableAt,
  setColumnAlignAt,
  tableContextAtPos,
  toStructureAnchor,
  type ColumnAlign,
  type TableStructureAnchor,
  type TableStructureOp,
} from "../table-utils";

/**
 * 表格右键菜单:工具条上的行列增删、整列对齐、单元格复制、删除表格。
 * 落点按鼠标所在单元格,不按打开前的光标。长表滚到下面时不用再滚回顶部点浮条。
 * 捕获阶段拦住 contextmenu,避免和 AI 右键菜单叠在一起。
 */

const ALIGN_ITEMS: { key: Exclude<ColumnAlign, null>; label: string }[] = [
  { key: "left", label: "左对齐" },
  { key: "center", label: "居中" },
  { key: "right", label: "右对齐" },
];

interface TableContextMenuProps {
  editor: Editor;
  cellCopy?: boolean;
  onToggleCellCopy?: () => void;
}

type OpenMenu = FloatMenuPos & {
  anchor: TableStructureAnchor;
  align: ColumnAlign;
};

function cellFromEvent(event: MouseEvent, root: HTMLElement): HTMLTableCellElement | null {
  const node = event.target;
  const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (!el) return null;
  const cell = el.closest("td, th");
  if (!(cell instanceof HTMLTableCellElement)) return null;
  if (!root.contains(cell)) return null;
  return cell;
}

export function TableContextMenu({
  editor,
  cellCopy = false,
  onToggleCellCopy,
}: TableContextMenuProps) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = !!menu;

  useEffect(() => {
    const dom = editor.view.dom;
    const onCtx = (event: MouseEvent) => {
      const cell = cellFromEvent(event, dom);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      let docPos: number;
      try {
        docPos = editor.view.posAtDOM(cell, 0);
      } catch {
        return;
      }
      const ctx = tableContextAtPos(editor.state, docPos);
      if (!ctx) return;

      try {
        const caret = TextSelection.near(
          editor.state.doc.resolve(Math.min(docPos, editor.state.doc.content.size)),
        );
        editor.view.dispatch(editor.state.tr.setSelection(caret));
      } catch {
        // 选区挪不过去时仍按落点锚点改表格
      }

      const placed = placeFloatMenu(
        { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY },
        { estimatedHeight: 360, width: 188, preferBelow: true },
      );
      setMenu({ ...placed, anchor: toStructureAnchor(ctx), align: ctx.align });
    };

    const close = () => setMenu(null);
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      if (openRef.current) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !openRef.current) return;
      event.preventDefault();
      close();
    };

    dom.addEventListener("contextmenu", onCtx, true);
    window.addEventListener("click", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("contextmenu", onCtx, true);
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [editor]);

  if (!menu) return null;

  const { anchor } = menu;

  const run = (op: TableStructureOp) => {
    applyTableStructure(editor, anchor, op);
    setMenu(null);
    editor.commands.focus();
  };

  const alignTo = (key: Exclude<ColumnAlign, null>) => {
    setColumnAlignAt(editor, anchor.tablePos, [anchor.colIndex], menu.align === key ? null : key);
    setMenu(null);
    editor.commands.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="表格"
      className="chrome-float pointer-events-auto fixed z-50 flex min-w-40 flex-col overflow-hidden rounded-lg border border-border-subtle bg-raised p-1 shadow-md"
      style={{
        top: menu.y,
        left: menu.x,
        maxHeight: menu.maxHeight,
        transform: menu.placement === "top" ? "translateY(-100%)" : undefined,
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="text-muted-foreground px-2 py-1 text-[10px] font-medium">表格</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MenuItem label="在上方插入行" onSelect={() => run("addRowBefore")} />
        <MenuItem label="在下方插入行" onSelect={() => run("addRowAfter")} />
        <MenuItem label="删除行" disabled={anchor.rows <= 1} onSelect={() => run("deleteRow")} />
        <Sep />
        <MenuItem label="在左侧插入列" onSelect={() => run("addColumnBefore")} />
        <MenuItem label="在右侧插入列" onSelect={() => run("addColumnAfter")} />
        <MenuItem label="删除列" disabled={anchor.cols <= 1} onSelect={() => run("deleteColumn")} />
        <Sep />
        {ALIGN_ITEMS.map((item) => (
          <MenuItem
            key={item.key}
            label={item.label}
            checked={menu.align === item.key}
            onSelect={() => alignTo(item.key)}
          />
        ))}
        {onToggleCellCopy ? (
          <>
            <Sep />
            <MenuItem
              label={cellCopy ? "关闭单元格复制" : "开启单元格复制"}
              checked={cellCopy}
              onSelect={() => {
                onToggleCellCopy();
                setMenu(null);
              }}
            />
          </>
        ) : null}
        <Sep />
        <MenuItem
          label="删除表格"
          danger
          onSelect={() => {
            deleteTableAt(editor, anchor.tablePos);
            setMenu(null);
            editor.commands.focus();
          }}
        />
      </div>
    </div>
  );
}

function Sep() {
  return <div className="bg-border-subtle my-1 h-px" />;
}

function MenuItem({
  label,
  disabled,
  checked,
  danger,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={`hover:bg-hover flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] disabled:cursor-default disabled:opacity-40 ${
        danger ? "text-destructive" : ""
      }`}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1">{label}</span>
      {checked ? <Check className="text-muted-foreground size-3.5 shrink-0" /> : null}
    </button>
  );
}
