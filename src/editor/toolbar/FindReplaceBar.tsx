import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { ChevronDown, ChevronUp, Replace, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import {
  closeFind,
  findStateOf,
  replaceAll,
  replaceCurrent,
  setSearch,
  stepFind,
} from "../find-replace";

/**
 * 查找/替换浮条(PRD §5.3.13):查找词即时高亮,Enter/Shift+Enter 步进,
 * 可展开替换行(替换当前/全部)。状态源在 PM plugin(findReplaceKey),React 侧只持输入框值。
 */

interface FindReplaceBarProps {
  editor: Editor;
  /** 替换行展开态(受控:⌥⌘F 在浮条已开时也能展开) */
  showReplace: boolean;
  onToggleReplace: () => void;
  onClose: () => void;
}

export function FindReplaceBar({
  editor,
  showReplace,
  onToggleReplace,
  onClose,
}: FindReplaceBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { total, active, term } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = findStateOf(e);
      return { total: s.matches.length, active: s.active, term: s.query };
    },
  });

  // 外部 setSearch(搜索定位/后续 findBar 打开)写的是插件状态,本地输入框跟随同步;
  // 自身输入时两者已相等,不会循环
  useEffect(() => {
    setQuery((q) => (q === term ? q : term));
  }, [term]);

  const close = () => {
    closeFind(editor);
    onClose();
  };

  // Esc 关闭:不限焦点位置(焦点在正文/按钮上也应能收起,Typora 同)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, onClose]);

  const label = !query
    ? ""
    : total
      ? `${active + 1}/${total}`
      : "无结果";

  return (
    <div className="bg-background flex shrink-0 items-start justify-end gap-1 px-3 py-1.5">
      <div className="bg-popover text-popover-foreground flex flex-col rounded-lg p-1 shadow-md ring-1 ring-foreground/10">
        <div className="flex items-center gap-1">
          <Search className="text-muted-foreground mx-1 size-3.5 shrink-0" />
          <input
            ref={inputRef}
            className="placeholder:text-muted-foreground h-7 w-52 bg-transparent text-sm outline-none"
            value={query}
            placeholder="查找"
            onChange={(e) => {
              setQuery(e.target.value);
              setSearch(editor, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepFind(editor, e.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className="text-muted-foreground w-14 text-center text-xs tabular-nums">
            {label}
          </span>
          <Hint label="上一个 (Shift+Enter)">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => stepFind(editor, -1)}
            >
              <ChevronUp className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="下一个 (Enter)">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => stepFind(editor, 1)}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="替换 (⌥⌘F)">
            <Button
              variant="ghost"
              size="icon"
              className={showReplace ? "bg-accent size-6" : "size-6"}
              onClick={onToggleReplace}
            >
              <Replace className="size-3.5" />
            </Button>
          </Hint>
          <Hint label="关闭 (Esc)">
            <Button variant="ghost" size="icon" className="size-6" onClick={close}>
              <X className="size-3.5" />
            </Button>
          </Hint>
        </div>
        {showReplace && (
          <div className="mt-1 flex items-center gap-1 pl-6">
            <input
              className="placeholder:text-muted-foreground h-7 w-52 bg-transparent text-sm outline-none"
              value={replacement}
              placeholder="替换为"
              onChange={(e) => setReplacement(e.target.value)}
            />
            <span className="w-14" />
            <Button
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={!total}
              onClick={() => replaceCurrent(editor, replacement)}
            >
              替换
            </Button>
            <Button
              variant="ghost"
              className="h-6 px-2 text-xs"
              disabled={!total}
              onClick={() => replaceAll(editor, replacement)}
            >
              全部
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
