import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { baseExtensions } from "../extensions";
import { HeadingBadge } from "../extensions/heading-badge";
import { docToMarkdown } from "../markdown/serialize";
import { mdToHtml } from "../markdown/md-instance";

describe("empty heading", () => {
  it("空标题可往返保存,输入首个字符后仍是标题", () => {
    const editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.setHeading({ level: 1 });
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(docToMarkdown(editor.state.doc)).toBe("#\n");

    editor.commands.setContent(mdToHtml("#"), { emitUpdate: false });
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");

    editor.commands.insertContent("标");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.textContent).toBe("标");
    editor.destroy();
  });
});

describe("空标题徽标边界", () => {
  it("空标题不插入不可编辑 widget,有内容后恢复显示", () => {
    const editor = new Editor({ extensions: [...baseExtensions, HeadingBadge], content: "<p></p>" });
    editor.commands.setHeading({ level: 1 });
    editor.commands.setTextSelection(1);

    expect(editor.view.dom.querySelector(".yz-heading-badge")).toBeNull();

    editor.commands.insertContent("标题");
    expect(editor.view.dom.querySelector(".yz-heading-badge")?.textContent).toBe("H1");
    editor.destroy();
  });
});
