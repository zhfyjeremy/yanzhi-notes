import { useState, type MouseEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
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
  cellCopy?: boolean;
  onToggleCellCopy?: () => void;
  children: ReactNode;
}

type TableMenuContext = {
  anchor: TableStructureAnchor;
  align: ColumnAlign;
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

export function TableContextMenu({
  editor,
  cellCopy = false,
  onToggleCellCopy,
  children,
}: TableContextMenuProps) {
  // 不用受控 open:让 Radix 在真实 contextmenu 上取鼠标坐标定位。
  // hover 状态先解除 trigger disabled,避免非表格区域出现空菜单。
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
    });
  };

  const run = (op: TableStructureOp) => {
    if (!context) return;
    applyTableStructure(editor, context.anchor, op);
    editor.commands.focus();
  };

  const alignTo = (align: ColumnAlign) => {
    if (!context) return;
    setColumnAlignAt(editor, context.anchor.tablePos, [context.anchor.colIndex], align);
    editor.commands.focus();
  };

  return (
    <ContextMenu>
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
      <ContextMenuContent aria-label="表格" className="min-w-40 gap-0.5">
        <ContextMenuLabel className="px-2 py-1 text-[10px]">表格</ContextMenuLabel>
        {context ? (
          <>
            <ContextMenuSub>
              <ContextMenuSubTrigger>插入行</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => run("addRowBefore")}>在上方插入行</ContextMenuItem>
                <ContextMenuItem onSelect={() => run("addRowAfter")}>在下方插入行</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem
              disabled={context.anchor.rows <= 1}
              onSelect={() => run("deleteRow")}
            >
              删除行
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>插入列</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => run("addColumnBefore")}>
                  在左侧插入列
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => run("addColumnAfter")}>
                  在右侧插入列
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem
              disabled={context.anchor.cols <= 1}
              onSelect={() => run("deleteColumn")}
            >
              删除列
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
            {onToggleCellCopy ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuCheckboxItem
                  checked={cellCopy}
                  onSelect={() => {
                    onToggleCellCopy();
                    editor.commands.focus();
                  }}
                >
                  单元格复制
                </ContextMenuCheckboxItem>
              </>
            ) : null}
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
