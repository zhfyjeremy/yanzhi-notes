import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Fragment } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { Hint } from "@/components/hint";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { countDocStats, countWords } from "../editor/word-count";

/**
 * 状态栏(PRD §3):自动保存状态、当前文档名、库路径、字数统计(全文/选区)、专注模式入口。
 */

interface StatusBarProps {
  editor: Editor | null;
  kbRoot: string;
  saveLabel: string;
  focusMode: boolean;
  onToggleFocus: () => void;
  /** 打字机偏好(专注子项);专注态下显示快捷开关 */
  typewriterMode?: boolean;
  onToggleTypewriter?: () => void;
  /** 失联 meta 条数(5.2.1 轻提示);0 不显示 */
  orphanCount?: number;
  onOpenOrphans?: () => void;
  /** AI 请求中显示目标 host(§7.8);null = 无请求 */
  aiHost?: string | null;
  onCancelAi?: () => void;
}

/** 文档统计弹窗内容(字数/字符/段落/图片/表格/预计阅读) */
function DocStatsRows({ editor }: { editor: Editor }) {
  const stats = useEditorState({
    editor,
    selector: ({ editor }) => countDocStats(editor.state.doc),
  });
  const rows: [string, string][] = [
    ["字数", `${stats.words}`],
    ["字符(不含空格)", `${stats.chars}`],
    ["段落", `${stats.paragraphs}`],
    ["图片", `${stats.images}`],
    ["表格", `${stats.tables}`],
    ["预计阅读", `${stats.readMinutes} 分钟`],
  ];
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums text-right">{value}</span>
        </Fragment>
      ))}
    </div>
  );
}

function WordCount({ editor }: { editor: Editor }) {
  const { total, selected } = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { from, to, empty } = editor.state.selection;
      return {
        total: countWords(editor.state.doc.textContent),
        selected: empty
          ? null
          : countWords(editor.state.doc.textBetween(from, to, " ")),
      };
    },
  });
  return (
    <span className="tabular-nums">
      {selected != null ? `${selected}/` : ""}
      {total} 字
    </span>
  );
}

export function StatusBar({
  editor,
  kbRoot,
  saveLabel,
  focusMode,
  onToggleFocus,
  typewriterMode = false,
  onToggleTypewriter,
  orphanCount = 0,
  onOpenOrphans,
  aiHost = null,
  onCancelAi,
}: StatusBarProps) {
  return (
    <footer className="shell-status border-border-subtle bg-sidebar/80 text-muted-foreground mx-3 mb-3 flex h-9 shrink-0 items-center justify-between gap-4 rounded-xl border px-3 text-[11px] shadow-[0_6px_18px_-14px_color-mix(in_oklab,var(--foreground)_18%,transparent)]">
      <div className="flex min-w-0 items-center gap-3">
        {orphanCount > 0 && onOpenOrphans && (
          <Hint label="外部改动产生了失联的偏好记录,点击整理">
            <button className="text-primary hover:bg-selection flex items-center gap-1 rounded-md px-1.5 py-1" onClick={onOpenOrphans}>
              <CircleAlert className="size-3.5" />
              {orphanCount} 条未识别
            </button>
          </Hint>
        )}
        {editor && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="text-foreground/65 hover:text-foreground hover:bg-hover rounded-md px-1 py-0.5"
                title="点击查看文档统计"
              >
                <WordCount editor={editor} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-2.5">
              <DocStatsRows editor={editor} />
            </PopoverContent>
          </Popover>
        )}
        <Hint label="专注模式 (⌘/Ctrl+Shift+F)">
          <button
            className="hover:text-foreground hover:bg-hover flex items-center gap-1 rounded-md px-1.5 py-1"
            onClick={onToggleFocus}
          >
            {focusMode ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            专注
          </button>
        </Hint>
        {focusMode && onToggleTypewriter && (
          <Hint label="打字机滚动：输入时保持光标在视口中线附近">
            <button
              className={`hover:bg-hover flex items-center gap-1 rounded-md px-1.5 py-1 ${
                typewriterMode ? "text-primary" : "hover:text-foreground"
              }`}
              onClick={onToggleTypewriter}
              aria-pressed={typewriterMode}
            >
              打字机
            </button>
          </Hint>
        )}
        {aiHost && (
          <span className="text-primary flex items-center gap-1.5">
            正在请求：{aiHost}
            {onCancelAi && (
              <button type="button" className="hover:bg-hover rounded px-1 text-[11px]" onClick={onCancelAi}>
                取消
              </button>
            )}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="text-foreground/60 flex shrink-0 items-center gap-1.5 tabular-nums">
          <span className="bg-primary/70 size-1.5 rounded-full" />
          {saveLabel}
        </span>
        <span className="bg-border-subtle h-3 w-px shrink-0" />
        <span className="text-muted-foreground/60 max-w-56 truncate" title={kbRoot}>
          {kbRoot}
        </span>
      </div>
    </footer>
  );
}
