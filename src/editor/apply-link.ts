import type { Editor } from "@tiptap/core";
import type { Selection } from "@tiptap/pm/state";

/**
 * 工具栏 / 选区条「链接」确定:
 * - 有选区 → 给选中文字加/改 link mark
 * - 光标在已有链接内 → 扩选后改 href(显示文案不变)
 * - 空选区且不在链接上 → 插入可点击的链接文本(否则 setLink 无内容可套,看起来像没插入)
 */
export function applyLinkAtSelection(
  editor: Editor,
  href: string,
  selection: Selection | null = null,
): void {
  const sel = selection ?? editor.state.selection;
  const trimmed = href.trim();

  const withSel = () =>
    editor.chain().focus().command(({ tr }) => {
      tr.setSelection(sel);
      return true;
    });

  if (!trimmed) {
    withSel().extendMarkRange("link").unsetLink().run();
    return;
  }

  const inLink = sel.$from.marks().some((m) => m.type.name === "link");
  if (sel.empty && !inLink) {
    withSel()
      .insertContent({
        type: "text",
        text: trimmed,
        marks: [{ type: "link", attrs: { href: trimmed } }],
      })
      .run();
    return;
  }

  withSel().extendMarkRange("link").setLink({ href: trimmed }).run();
}
