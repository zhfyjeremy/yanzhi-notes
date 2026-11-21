import { describe, expect, it, beforeEach } from "vitest";
import { Editor } from "@tiptap/react";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";

describe("DeleteEmptyFirstBlock", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p><h1>Heading</h1><p>body</p>" });
    editor.commands.focus("start");
  });

  it("deletes an empty first block and places the caret at the next block", () => {
    expect(editor.state.doc.firstChild?.textContent).toBe("");
    expect(editor.commands.keyboardShortcut("Backspace")).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe("Heading");
    expect(editor.state.selection.from).toBe(1);
  });

  it("keeps the only block in an empty document", () => {
    editor.commands.setContent(mdToHtml(""), { emitUpdate: false });
    editor.commands.focus("start");
        const event = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.state.doc.childCount).toBe(1);
  });
});
