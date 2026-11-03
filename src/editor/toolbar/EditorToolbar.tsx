import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { Selection } from "@tiptap/pm/state";
import {
  Bold,
  Check,
  ChevronDown,
  ClipboardCopy,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Palette,
  Redo2,
  Strikethrough,
  Table,
  TextQuote,
  Underline,
  Undo2,
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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FONT_COLORS } from "../extensions/font-color";
import { copyPlainText, copyRichText } from "../clipboard";
import { cn } from "@/lib/utils";

/**
 * M1 顶部格式工具栏(语雀式):标题下拉 + 行内格式 + 链接 + 块类型 + 撤销重做。
 * 操作后必须回焦编辑器并保留选区:
 * - 普通按钮:onMouseDown preventDefault 防抢焦 + chain().focus()
 * - radix 下拉:打开时快照选区;Content onCloseAutoFocus 拦回焦到触发器,改回编辑器
 * - 链接弹层需输入,关闭/确定后再回焦
 */

/** 只用中文层级名;不用 H1/H2 图标(字形与「标题 N」重复) */
const HEADING_ITEMS = [
  { level: 0, label: "正文", className: "text-sm font-normal" },
  { level: 1, label: "标题 1", className: "text-[15px] font-semibold" },
  { level: 2, label: "标题 2", className: "text-sm font-semibold" },
  { level: 3, label: "标题 3", className: "text-[13px] font-semibold" },
  { level: 4, label: "标题 4", className: "text-xs font-semibold" },
  { level: 5, label: "标题 5", className: "text-xs font-medium" },
  { level: 6, label: "标题 6", className: "text-[11px] font-medium" },
] as const;

function Divider() {
  return <div className="bg-border-subtle mx-0.5 h-4 w-px shrink-0" />;
}

interface ToolButtonProps {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}

function ToolButton({
  title,
  active,
  disabled,
  onClick,
  className,
  children,
}: ToolButtonProps) {
  return (
    <Hint label={title}>
      <Button
        variant="ghost"
        size="icon"
        disabled={disabled}
        className={cn(
          "text-muted-foreground hover:text-foreground size-7 rounded-md",
          className,
          active && "bg-selection text-foreground ring-primary/20 hover:text-foreground ring-1",
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        {children}
      </Button>
    </Hint>
  );
}

export function EditorToolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // 下拉打开瞬间的选区快照:radix 会挪走焦点,PM 失焦期间不同步 DOM 选区;
  // 命令前显式恢复,关闭时再拦 onCloseAutoFocus 以免焦点落回触发按钮
  const [menuSelection, setMenuSelection] = useState<Selection | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      heading:
        [1, 2, 3, 4, 5, 6].find((l) => editor.isActive("heading", { level: l }))
        ?? 0,
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      highlight: editor.isActive("highlight"),
      fontColor: editor.getAttributes("fontColor").color as string | null,
      link: editor.isActive("link"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      taskList: editor.isActive("taskList"),
      blockquote: editor.isActive("blockquote"),
      table: editor.isActive("table"),
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  const snapshotMenuSelection = (open: boolean) => {
    if (open) setMenuSelection(editor.state.selection);
  };

  const restoreEditorFocus = (e: Event) => {
    e.preventDefault();
    editor.commands.focus();
  };

  const withMenuSelection = () =>
    editor
      .chain()
      .focus()
      .setTextSelection(menuSelection ?? editor.state.selection);

  const applyHeading = (level: number) => {
    const chain = withMenuSelection();
    if (level === 0) {
      chain.setParagraph().run();
    } else {
      chain.toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    }
  };

  const openLinkPopover = (open: boolean) => {
    if (open) {
      setMenuSelection(editor.state.selection);
      setLinkUrl((editor.getAttributes("link").href as string) ?? "");
    }
    setLinkOpen(open);
  };

  const applyLink = () => {
    const href = linkUrl.trim();
    const chain = withMenuSelection().extendMarkRange("link");
    if (href) {
      chain.setLink({ href }).run();
    } else {
      chain.unsetLink().run();
    }
    setLinkOpen(false);
  };

  const currentHeading =
    HEADING_ITEMS.find((item) => item.level === state.heading) ?? HEADING_ITEMS[0];

  return (
    <div role="toolbar" aria-label="格式工具栏" className="yz-toolbar bg-editor flex h-14 shrink-0 items-center justify-center px-4">
      {/* 胶囊跟内容收缩、居中;不随正文列拉长。窄纸张时 max-w-full + 内滚,容器查询仍按外层纸宽收纳低频按钮 */}
      <div className="border-border-subtle bg-raised flex h-9 w-fit max-w-full min-w-0 items-center gap-0.5 overflow-x-auto rounded-[10px] border px-1.5 shadow-sm">
      {/* 标题下拉 */}
      <DropdownMenu onOpenChange={snapshotMenuSelection}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-7 min-w-[4.5rem] justify-between gap-1 rounded-md px-2 font-normal"
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className="truncate">{currentHeading.label}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-36"
          onCloseAutoFocus={restoreEditorFocus}
        >
          {HEADING_ITEMS.map((item) => (
            <DropdownMenuItem key={item.level} onClick={() => applyHeading(item.level)}>
              <span className={cn("flex-1", item.className)}>{item.label}</span>
              {state.heading === item.level && (
                <Check className="ml-auto size-3.5 shrink-0" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      {/* 行内格式 */}
      <ToolButton title="加粗" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton title="斜体" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton title="下划线" className="yz-toolbar-hide-narrow" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton title="删除线" className="yz-toolbar-hide-cozy" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </ToolButton>
      <ToolButton title="行内代码" className="yz-toolbar-hide-narrow" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="size-4" />
      </ToolButton>
      <ToolButton title="高亮" className="yz-toolbar-hide-compact" active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter className="size-4" />
      </ToolButton>

      {/* 文字颜色(色卡下拉,§10 方言预设色) */}
      <DropdownMenu onOpenChange={snapshotMenuSelection}>
        <Hint label="文字颜色">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground hover:text-foreground size-7 rounded-md yz-toolbar-hide-compact",
                state.fontColor && "bg-selection text-foreground ring-primary/20 hover:text-foreground ring-1",
              )}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Palette className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent
          align="start"
          className="w-40 p-2"
          onCloseAutoFocus={restoreEditorFocus}
        >
          <div className="grid grid-cols-4 gap-1">
            {FONT_COLORS.map((c) => (
              <DropdownMenuItem
                key={c.value}
                title={c.label}
                className="justify-center px-1"
                onClick={() =>
                  withMenuSelection()
                    .setMark("fontColor", { color: c.value })
                    .run()
                }
              >
                <span
                  className="flex size-6 items-center justify-center rounded-md"
                  style={{ backgroundColor: c.value }}
                >
                  {state.fontColor === c.value && (
                    <Check className="size-3.5 text-white" />
                  )}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
          <DropdownMenuSeparator className="my-1.5" />
          <DropdownMenuItem
            onClick={() => withMenuSelection().unsetMark("fontColor").run()}
          >
            <span className="flex size-6 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              A
            </span>
            默认
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      {/* 链接(需输入,打开时允许抢焦;关闭回编辑器) */}
      <Popover open={linkOpen} onOpenChange={openLinkPopover}>
        <Hint label="链接">
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "text-muted-foreground hover:text-foreground size-7 rounded-md",
                state.link && "bg-selection text-foreground ring-primary/20 hover:text-foreground ring-1",
              )}
            >
              <Link2 className="size-4" />
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent
          align="start"
          className="w-72 p-2.5"
          onCloseAutoFocus={restoreEditorFocus}
        >
          <Input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyLink();
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https:// 或文件路径"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            {editor.isActive("link") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  withMenuSelection().extendMarkRange("link").unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                移除
              </Button>
            )}
            <Button size="sm" disabled={!linkUrl.trim()} onClick={applyLink}>
              确定
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Divider />

      {/* 块类型 */}
      <ToolButton title="无序列表" active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="size-4" />
      </ToolButton>
      <ToolButton title="有序列表" active={state.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="size-4" />
      </ToolButton>
      <ToolButton title="待办列表" className="yz-toolbar-hide-compact" active={state.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListTodo className="size-4" />
      </ToolButton>
      <ToolButton title="引用" className="yz-toolbar-hide-compact" active={state.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <TextQuote className="size-4" />
      </ToolButton>
      <ToolButton title="分割线" className="yz-toolbar-hide-cozy" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </ToolButton>
      <ToolButton
        title="表格"
        className="yz-toolbar-hide-compact"
        active={state.table}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table className="size-4" />
      </ToolButton>

      <Divider />

      {/* 复制为(纯文本 / 富文本 HTML,贴微信邮件等) */}
      <DropdownMenu modal={false}>
        <Hint label="复制为">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground size-7 rounded-md yz-toolbar-hide-cozy"
              onMouseDown={(e) => e.preventDefault()}
            >
              <ClipboardCopy className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent
          align="start"
          className="w-36"
          onCloseAutoFocus={restoreEditorFocus}
        >
          <DropdownMenuItem
            onClick={() => void copyPlainText(editor.state.doc.textContent)}
          >
            复制为纯文本
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              void copyRichText(
                editor.getHTML(),
                editor.state.doc.textContent,
              )
            }
          >
            复制为 HTML
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ToolButton title="撤销" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton title="重做" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className="size-4" />
      </ToolButton>
      </div>
    </div>
  );
}
