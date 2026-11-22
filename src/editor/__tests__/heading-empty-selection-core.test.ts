import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/react";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";

describe("空标题基础行为", () => {
  it("setHeading 后光标留在标题,输入首个字符仍是标题", () => {
    const editor = new Editor({ extensions: baseExtensions, content: mdToHtml("") });
    editor.commands.focus();
    editor.chain().focus().setHeading({ level: 1 }).run();

    expect(editor.state.selection.$from.parent.type.name).toBe("heading");
    editor.commands.insertContent("标");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.textContent).toBe("标");
    editor.destroy();
  });
});
