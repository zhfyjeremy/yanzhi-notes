import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { Hint } from "@/components/hint";
import { countWords } from "../editor/word-count";

/**
 * 状态栏(PRD §3):自动保存状态、当前文档名、库路径、字数统计(全文/选区)、专注模式入口。
 */

interface StatusBarProps {
  editor: Editor | null;
  kbRoot: string;
  saveLabel: string;
  focusMode: boolean;
  onToggleFocus: () => void;
  /** 失联 meta 条数(5.2.1 轻提示);0 不显示 */
  orphanCount?: number;
  onOpenOrphans?: () => void;
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
  orphanCount = 0,
  onOpenOrphans,
}: StatusBarProps) {
  return (
    <footer className="border-border-subtle bg-sidebar/80 text-muted-foreground mx-3 mb-3 flex h-9 shrink-0 items-center justify-between gap-4 rounded-xl border px-3 text-[11px] shadow-[0_6px_18px_-14px_color-mix(in_oklab,var(--foreground)_18%,transparent)]">
      <div className="flex min-w-0 items-center gap-3">
        {orphanCount > 0 && onOpenOrphans && (
          <Hint label="外部改动产生了失联的偏好记录,点击整理">
            <button className="text-primary hover:bg-selection flex items-center gap-1 rounded-md px-1.5 py-1" onClick={onOpenOrphans}>
              <CircleAlert className="size-3.5" />
              {orphanCount} 条未识别
            </button>
          </Hint>
        )}
        {editor && <span className="text-foreground/65"><WordCount editor={editor} /></span>}
        <Hint label="专注模式 (⌘/Ctrl+Shift+F)">
          <button
            className="hover:text-foreground hover:bg-hover flex items-center gap-1 rounded-md px-1.5 py-1"
            onClick={onToggleFocus}
          >
            {focusMode ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            专注
          </button>
        </Hint>
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
