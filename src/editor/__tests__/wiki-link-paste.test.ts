import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";
import { handleWikiLinkPaste } from "../wiki-link-paste";

function clipboardEvent(text: string): ClipboardEvent {
  const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  return event;
}

describe("纯文本双链粘贴", () => {
  it("整段 [[目标]] 粘贴后立即成为 wikiLink mark", () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: mdToHtml("前文"),
    });
    editor.commands.setTextSelection(editor.state.doc.content.size);
    const handled = handleWikiLinkPaste(
      editor.view,
      clipboardEvent("[[砚知入门教程与功能示例]]"),
    );

    expect(handled).toBe(true);
    const text = editor.state.doc.textContent;
    expect(text).toBe("前文砚知入门教程与功能示例");
    let mark: Mark | undefined;
    editor.state.doc.descendants((child) => {
      if (child.marks.some((m) => m.type.name === "wikiLink")) {
        mark = child.marks.find((m) => m.type.name === "wikiLink") ?? mark;
        return false;
      }
      return true;
    });
    expect(mark?.type.name).toBe("wikiLink");
    expect(mark?.attrs.target).toBe("砚知入门教程与功能示例");
    editor.destroy();
  });

  it("混合文本不接管,保持原生粘贴语义", () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: mdToHtml("前文"),
    });
    const handled = handleWikiLinkPaste(
      editor.view,
      clipboardEvent("看 [[砚知入门教程与功能示例]] 这篇"),
    );
    expect(handled).toBe(false);
    editor.destroy();
  });
});
