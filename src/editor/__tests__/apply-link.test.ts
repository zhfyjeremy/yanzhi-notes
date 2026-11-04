import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { applyLinkAtSelection } from "../apply-link";
import { baseExtensions } from "../extensions";
import { docToMarkdown } from "../markdown/serialize";

function makeEditor(html = "<p>hello</p>"): Editor {
  return new Editor({ extensions: baseExtensions, content: html });
}

describe("applyLinkAtSelection", () => {
  it("空选区:插入可点击的链接文本", () => {
    const editor = makeEditor("<p></p>");
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
    );
    applyLinkAtSelection(editor, "https://example.com");
    expect(docToMarkdown(editor.state.doc)).toContain("[https://example.com](https://example.com)");
    editor.destroy();
  });

  it("有选区:给选中文字加链接", () => {
    const editor = makeEditor("<p>VPN</p>");
    // 选中 VPN
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 4)),
    );
    applyLinkAtSelection(editor, "https://vpn.example");
    expect(docToMarkdown(editor.state.doc)).toContain("[VPN](https://vpn.example)");
    editor.destroy();
  });

  it("空 href:移除链接", () => {
    const editor = makeEditor('<p><a href="https://a.com">VPN</a></p>');
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 2)),
    );
    applyLinkAtSelection(editor, "");
    expect(docToMarkdown(editor.state.doc)).not.toContain("https://a.com");
    expect(docToMarkdown(editor.state.doc)).toContain("VPN");
    editor.destroy();
  });
});
