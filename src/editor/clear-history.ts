import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

/**
 * 清空 ProseMirror history。
 *
 * Tiptap v3 的 UndoRedo 扩展没有公开 clearHistory 命令;换文档使用 setContent
 * 只替换 doc,不会重置 plugin state。这里保留 schema/plugins/doc,重建
 * EditorState 来重置 undo/redo 栈,避免新文档 Ctrl/Cmd+Z 回退到上一篇文档。
 */
export function clearEditorHistory(editor: Editor): boolean {
  if (editor.isDestroyed) return false;
  const { doc, selection, plugins } = editor.state;
  // 重建 EditorState 会重新初始化 plugin state,包括 ProseMirror history 的
  // undo/redo 栈;schema/plugins 不变,只保留当前 doc 与选区。
  editor.view.updateState(
    EditorState.create({ doc, selection, plugins }),
  );
  return true;
}
