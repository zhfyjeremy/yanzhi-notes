import { useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { baseExtensions } from "./extensions";
import { mdToHtml } from "./markdown/md-instance";
import { docToMarkdown } from "./markdown/serialize";
import { SlashMenuExtension } from "./slash-command";
import { EditorToolbar } from "./toolbar/EditorToolbar";
import "./editor.css";

/**
 * M1 正式编辑器组件:markdown 进(md → HTML → 编辑器 DOMParser)、markdown 出(单路径序列化)。
 * onUpdate 去抖 300ms 回调 onMarkdownChange;自动保存落盘在 M3 接入。
 */

const CHANGE_DEBOUNCE_MS = 300;

interface YanzhiEditorProps {
  markdown: string;
  onMarkdownChange?: (markdown: string) => void;
}

export function YanzhiEditor({ markdown, onMarkdownChange }: YanzhiEditorProps) {
  // 回调走 ref:onUpdate 闭包不随父组件重渲染重建
  const onChangeRef = useRef(onMarkdownChange);
  onChangeRef.current = onMarkdownChange;
  const timerRef = useRef<number | undefined>(undefined);

  const editor = useEditor({
    // SlashMenu 是 UI 交互插件不贡献 Schema,单独挂载(baseExtensions 保持纯 Schema 集合)
    extensions: [...baseExtensions, SlashMenuExtension],
    // HTML 字符串:编辑器内部 DOMParser 与 markdownToDoc 同一条路径(parse.ts)
    content: mdToHtml(markdown),
    editorProps: {
      attributes: { class: "yz-editor-doc" },
    },
    onUpdate: ({ editor }) => {
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        onChangeRef.current?.(docToMarkdown(editor.state.doc));
      }, CHANGE_DEBOUNCE_MS);
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editor && <EditorToolbar editor={editor} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-16 py-12">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
