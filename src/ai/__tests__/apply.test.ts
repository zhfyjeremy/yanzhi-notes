import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { baseExtensions } from "../../editor/extensions";
import { mdToHtml } from "../../editor/markdown/md-instance";
import { docToMarkdown } from "../../editor/markdown/serialize";
import { applyAiMarkdown } from "../apply";

function makeEditor(html: string): Editor {
  return new Editor({ extensions: baseExtensions, content: html });
}

function selectText(editor: Editor, match: string, startOffset: number, endOffset: number) {
  let pos: number | null = null;
  editor.state.doc.descendants((node, p) => {
    if (pos === null && node.isText && node.text?.includes(match)) {
      pos = p + node.text.indexOf(match) + match.length;
    }
  });
  if (pos === null) throw new Error(`text not found: ${match}`);
  const from = pos - match.length + startOffset;
  const to = pos + endOffset;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  return { from, to };
}

describe("applyAiMarkdown", () => {
  it("标题内替换不把 AI 输出的标题语法变成新块", () => {
    const editor = makeEditor(mdToHtml("# 项目说明文档"));
    const range = selectText(editor, "说明", 0, 0);
    applyAiMarkdown(editor, "# 更清晰", "replace", range);
    expect(docToMarkdown(editor.state.doc)).toBe("# 项目更清晰文档\n");
  });

  it("块内局部替换继承原有行内样式", () => {
    const editor = makeEditor(mdToHtml("<strong>Hello world</strong>"));
    const range = selectText(editor, "world", 0, 0);
    applyAiMarkdown(editor, "there", "replace", range);
    expect(docToMarkdown(editor.state.doc)).toBe("**Hello there**\n");
  });
});
