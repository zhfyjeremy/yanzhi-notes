import { EditorContent, useEditor } from "@tiptap/react";
import { baseExtensions } from "./extensions";
import "./editor.css";

/**
 * 阶段 0 spike 页。
 * 结论:S3 md 往返 ✅ 通过;S2 中文输入无异常。
 * 块编辑模式已移除(PRD v1.5),编辑器只保留流畅文档模式。
 */

const SAMPLE = `
  <h1>砚知阶段 0:编辑器 spike</h1>
  <p>统一 Schema + markdown-it 往返管道已就绪,S3 fixtures 全绿。块编辑模式已移除(PRD v1.5),本页为流畅文档模式。</p>
  <h2>基础能力</h2>
  <ul>
    <li>文字格式:粗体、斜体、<u>下划线</u>、删除线、行内代码、==高亮==</li>
    <li>列表:无序、有序、待办(嵌套升降级 Tab / Shift+Tab)</li>
    <li>双链 [[文档A]] 与表格、代码块、引用</li>
  </ul>
  <blockquote><p>同一套 Schema、同一条序列化路径,数据始终是标准 Markdown。</p></blockquote>
  <pre><code class="language-ts">const yanzhi = { local: true, offline: "by default" };</code></pre>
  <p>试着在这里输入一段中文长句,验证 IME 组合输入无跳字丢字(S2)。</p>
`;

export function EditorSpike() {
  const editor = useEditor({
    extensions: baseExtensions,
    content: SAMPLE,
    editorProps: {
      attributes: { class: "yz-editor-doc" },
    },
  });

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex items-center gap-4 border-b px-4 py-2">
        <span className="text-sm font-semibold">砚知 · 阶段 0 spike</span>
        <span className="text-muted-foreground text-xs">流畅文档模式</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-16 py-12">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
