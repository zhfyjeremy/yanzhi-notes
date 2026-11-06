import { useState, type MouseEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../components/ui/context-menu";
import { copyPlainText } from "../clipboard";
import {
  applyTableStructure,
  deleteTableAt,
  insertTableAxis,
  setColumnAlignAt,
  tableContextAtPos,
  toStructureAnchor,
  type ColumnAlign,
  type TableStructureAnchor,
} from "../table-utils";
import { TableCountInsertRow } from "./TableCountInsertRow";

/**
 * 表格右键菜单:「单元格」复制内容 +「行操作」/「列操作」(数量框插入/删除)+ 对齐 + 删表。
 * 落点按鼠标所在单元格,不按打开前的光标。长表滚到下面时不用再滚回顶部点浮条。
 * 插入行/列与表工具条同款:标签 + 数量框 + 勾选确认。
 * ContextMenuTrigger 包住编辑器区域,但只在 hover 单元格时启用;
 * 非表格右键继续交给 AI 菜单或系统默认菜单。
 */

const ALIGN_ITEMS: { key: Exclude<ColumnAlign, null>; label: string }[] = [
  { key: "left", label: "左对齐" },
  { key: "center", label: "居中" },
  { key: "right", label: "右对齐" },
];

interface TableContextMenuProps {
  editor: Editor;
  children: ReactNode;
}

type TableMenuContext = {
  anchor: TableStructureAnchor;
  align: ColumnAlign;
  /** 右键落点格的纯文本;空格禁用「复制内容」 */
  cellText: string;
};

function cellFromEvent(event: { target: EventTarget | null }, root: HTMLElement): HTMLTableCellElement | null {
  const node = event.target;
  const el = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  if (!el) return null;
  const cell = el.closest("td, th");
  if (!(cell instanceof HTMLTableCellElement)) return null;
  if (!root.contains(cell)) return null;
  return cell;
}

function cellPlainText(cell: HTMLTableCellElement): string {
  return (cell.innerText || cell.textContent || "").replace(/\u00a0/g, " ").trim();
}

export function TableContextMenu({ editor, children }: TableContextMenuProps) {
  // 受控 open:数量插入确认后要立刻关掉菜单(自定义行不会触发 Radix Item select)。
  // hover 状态先解除 trigger disabled,避免非表格区域出现空菜单。
  const [open, setOpen] = useState(false);
  const [openSeq, setOpenSeq] = useState(0);
  const [overTable, setOverTable] = useState(false);
  const [context, setContext] = useState<TableMenuContext | null>(null);

  const prepareContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const cell = cellFromEvent(event.nativeEvent, editor.view.dom);
    if (!cell) {
      // hover 状态漂移时只阻止 Radix 打开空菜单;trigger 已禁用时保留系统默认菜单。
      if (overTable) event.preventDefault();
      return;
    }

    let docPos: number;
    try {
      docPos = editor.view.posAtDOM(cell, 0);
    } catch {
      event.preventDefault();
      return;
    }
    const tableContext = tableContextAtPos(editor.state, docPos);
    if (!tableContext) {
      event.preventDefault();
      return;
    }

    try {
      const caret = TextSelection.near(
        editor.state.doc.resolve(Math.min(docPos, editor.state.doc.content.size)),
      );
      editor.view.dispatch(editor.state.tr.setSelection(caret));
    } catch {
      // 选区挪不过去时仍按落点锚点改表格
    }

    setContext({
      anchor: toStructureAnchor(tableContext),
      align: tableContext.align,
      cellText: cellPlainText(cell),
    });
    setOpenSeq((seq) => seq + 1);
  };

  const closeMenu = () => setOpen(false);

  const insertAxis = (axis: "row" | "column", where: "before" | "after", count: number) => {
    if (!context) return;
    insertTableAxis(editor, context.anchor, count, axis, where);
    editor.commands.focus();
    closeMenu();
  };

  const deleteAxis = (op: "deleteRow" | "deleteColumn") => {
    if (!context) return;
    applyTableStructure(editor, context.anchor, op);
    editor.commands.focus();
  };

  const alignTo = (align: ColumnAlign) => {
    if (!context) return;
    setColumnAlignAt(editor, context.anchor.tablePos, [context.anchor.colIndex], align);
    editor.commands.focus();
  };

  const copyCell = () => {
    if (!context?.cellText) return;
    void copyPlainText(context.cellText).then(() => {
      editor.commands.focus();
    });
  };

  return (
    <ContextMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setContext(null);
      }}
    >
      <ContextMenuTrigger
        asChild
        disabled={!overTable}
        onPointerOver={(event) => {
          setOverTable(!!cellFromEvent(event.nativeEvent, editor.view.dom));
        }}
        onPointerLeave={() => setOverTable(false)}
        onContextMenu={prepareContextMenu}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="表格" className="min-w-56 gap-0.5">
        {context ? (
          <>
            <ContextMenuLabel className="px-2 py-1 text-[10px]">行操作</ContextMenuLabel>
            {/* openSeq 每次右键递增,数量框回到默认 1 */}
            <TableCountInsertRow
              key={`row-before-${openSeq}`}
              label="在上方插入行"
              onCommit={(n) => insertAxis("row", "before", n)}
            />
            <TableCountInsertRow
              key={`row-after-${openSeq}`}
              label="在下方插入行"
              onCommit={(n) => insertAxis("row", "after", n)}
            />
            <ContextMenuItem
              disabled={context.anchor.rows <= 1}
              onSelect={() => deleteAxis("deleteRow")}
            >
              删除行
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuLabel className="px-2 py-1 text-[10px]">列操作</ContextMenuLabel>
            <TableCountInsertRow
              key={`col-before-${openSeq}`}
              label="在左侧插入列"
              onCommit={(n) => insertAxis("column", "before", n)}
            />
            <TableCountInsertRow
              key={`col-after-${openSeq}`}
              label="在右侧插入列"
              onCommit={(n) => insertAxis("column", "after", n)}
            />
            <ContextMenuItem
              disabled={context.anchor.cols <= 1}
              onSelect={() => deleteAxis("deleteColumn")}
            >
              删除列
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuLabel className="px-2 py-1 text-[10px]">单元格</ContextMenuLabel>
            <ContextMenuItem disabled={!context.cellText} onSelect={copyCell}>
              复制内容
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>对齐方式</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={context.align ?? "default"}
                  onValueChange={(value) =>
                    alignTo(value === "default" ? null : (value as Exclude<ColumnAlign, null>))
                  }
                >
                  <ContextMenuRadioItem value="default">默认对齐</ContextMenuRadioItem>
                  {ALIGN_ITEMS.map((item) => (
                    <ContextMenuRadioItem key={item.key} value={item.key}>
                      {item.label}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => deleteTableAt(editor, context.anchor.tablePos)}
            >
              删除表格
            </ContextMenuItem>
          </>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
