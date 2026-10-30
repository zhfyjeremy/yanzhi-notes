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
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
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
  Text,
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
 * 全部命令 chain().focus() 回焦编辑器;除链接弹层外按钮 onMouseDown preventDefault 防闪失焦。
 */

const HEADING_ITEMS = [
  { level: 0, label: "正文", icon: Text },
  { level: 1, label: "标题 1", icon: Heading1 },
  { level: 2, label: "标题 2", icon: Heading2 },
  { level: 3, label: "标题 3", icon: Heading3 },
  { level: 4, label: "标题 4", icon: Heading4 },
  { level: 5, label: "标题 5", icon: Heading5 },
  { level: 6, label: "标题 6", icon: Heading6 },
] as const;

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

interface ToolButtonProps {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <Hint label={title}>
      <Button
        variant="ghost"
        size="icon"
        disabled={disabled}
        className={cn("text-muted-foreground hover:text-foreground", active && "bg-accent text-accent-foreground hover:text-accent-foreground")}
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
  // 色卡打开瞬间的选区快照:radix 菜单会移动焦点,PM 失焦期间不同步 DOM 选区,
  // chain().focus() 会用旧选区覆盖;命令前显式恢复快照,不依赖焦点时序
  const [colorSelection, setColorSelection] = useState<Selection | null>(null);

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

  const applyHeading = (level: number) => {
    if (level === 0) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().toggleHeading({ level: level as 1|2|3|4|5|6 }).run();
    }
  };

  const openLinkPopover = (open: boolean) => {
    if (open) {
      setLinkUrl((editor.getAttributes("link").href as string) ?? "");
    }
    setLinkOpen(open);
  };

  const applyLink = () => {
    const href = linkUrl.trim();
    if (href) {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setLinkOpen(false);
  };

  const currentHeading =
    HEADING_ITEMS.find((item) => item.level === state.heading) ?? HEADING_ITEMS[0];

  return (
    <div className="bg-background flex h-12 shrink-0 items-center gap-0.5 px-3">
      {/* 标题下拉 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground h-8 w-24 justify-between px-2.5 font-normal">
            <span className="flex items-center gap-1.5">
              <currentHeading.icon className="size-4" />
              {currentHeading.label}
            </span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-32">
          {HEADING_ITEMS.map((item) => (
            <DropdownMenuItem key={item.level} onClick={() => applyHeading(item.level)}>
              <item.icon className="size-4" />
              {item.label}
              {state.heading === item.level && (
                <Check className="ml-auto size-3.5" />
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
      <ToolButton title="下划线" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline className="size-4" />
      </ToolButton>
      <ToolButton title="删除线" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </ToolButton>
      <ToolButton title="行内代码" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="size-4" />
      </ToolButton>
      <ToolButton title="高亮" active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter className="size-4" />
      </ToolButton>

      {/* 文字颜色(色卡下拉,§10 方言预设色) */}
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setColorSelection(editor.state.selection);
        }}
      >
        <Hint label="文字颜色">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("text-muted-foreground hover:text-foreground", state.fontColor && "bg-accent text-accent-foreground hover:text-accent-foreground")}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Palette className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="start" className="w-40 p-2">
          <div className="grid grid-cols-4 gap-1">
            {FONT_COLORS.map((c) => (
              <DropdownMenuItem
                key={c.value}
                title={c.label}
                className="justify-center px-1"
                onClick={() =>
                  editor.chain()
                    .focus()
                    .setTextSelection(colorSelection ?? editor.state.selection)
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
            onClick={() =>
              editor.chain()
                .focus()
                .setTextSelection(colorSelection ?? editor.state.selection)
                .unsetMark("fontColor")
                .run()
            }
          >
            <span className="flex size-6 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              A
            </span>
            默认
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      {/* 链接(需输入,不 preventDefault) */}
      <Popover open={linkOpen} onOpenChange={openLinkPopover}>
        <Hint label="链接">
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn("text-muted-foreground hover:text-foreground", state.link && "bg-accent text-accent-foreground hover:text-accent-foreground")}
            >
              <Link2 className="size-4" />
            </Button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent align="start" className="w-72 p-2.5">
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
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
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
      <ToolButton title="待办列表" active={state.taskList} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListTodo className="size-4" />
      </ToolButton>
      <ToolButton title="引用" active={state.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <TextQuote className="size-4" />
      </ToolButton>
      <ToolButton title="分割线" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="size-4" />
      </ToolButton>
      <ToolButton
        title="表格"
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
              className="text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
            >
              <ClipboardCopy className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="start" className="w-36">
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
  );
}
