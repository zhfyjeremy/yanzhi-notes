import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { underscorePasteRegex } from "@tiptap/extension-italic";
import { baseExtensions } from "../extensions";
import { docToMarkdown } from "../markdown/serialize";

/** jsdom 无 DataTransfer:自造 clipboardData 触发 TipTap PasteRule */
function pastePlain(editor: Editor, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (fmt: string) => (fmt === "text/plain" ? text : ""),
      types: ["text/plain"],
      files: [],
      items: [],
    },
  });
  editor.view.dom.dispatchEvent(event);
}

/**
 * 回归:默认 Italic 的 _…_ 粘贴规则会把 `_SPECIAL_LABEL` 吃成斜体 SPECIAL。
 * 砚知只用 *…* 做斜体(与 serialize 一致)。
 */
describe("斜体不吞标识符下划线", () => {
  it("默认 underscorePasteRegex 会误伤 _SPECIAL_LABEL(对照)", () => {
    const re = new RegExp(underscorePasteRegex.source, underscorePasteRegex.flags);
    expect("_SPECIAL_LABEL".match(re)?.[0]).toBe("_SPECIAL_");
  });

  it("粘贴 _SPECIAL_LABEL 保留原文下划线", () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: "<p></p>",
    });
    editor.commands.focus("start");
    pastePlain(editor, "_SPECIAL_LABEL");

    const md = docToMarkdown(editor.state.doc);
    expect(md.replace(/\\_/g, "_")).toContain("_SPECIAL_LABEL");
    expect(md).not.toContain("*SPECIAL*");
    editor.destroy();
  });

  it("表格单元格内粘贴同样保留", () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: `<table><tbody><tr><td><p></p></td></tr></tbody></table>`,
    });
    editor.commands.focus("start");
    pastePlain(editor, "_SPECIAL_LABEL");
    const md = docToMarkdown(editor.state.doc);
    expect(md.replace(/\\_/g, "_")).toContain("_SPECIAL_LABEL");
    expect(md).not.toContain("*SPECIAL*");
    editor.destroy();
  });
});
