import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";

function headingLevel(editor: Editor): number | null {
  let level: number | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") {
      level = Number(node.attrs.level ?? 0) || level;
      return false;
    }
    return true;
  });
  return level;
}

function press(editor: Editor, key: string, init: KeyboardEventInit): void {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
  editor.view.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

describe("标题快捷键", () => {
  it("Ctrl+1–6 把正文切换为对应标题", () => {
    for (let level = 1; level <= 6; level++) {
      const editor = new Editor({
        extensions: baseExtensions,
        content: mdToHtml("正文"),
      });
      press(editor, String(level), {
        code: `Digit${level}`,
        ctrlKey: true,
      });

      expect(headingLevel(editor)).toBe(level);
      editor.destroy();
    }
  });

  it("平台主键快捷键(macOS ⌘/Windows Ctrl)同样生效", () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: mdToHtml("正文"),
    });
    press(editor, "3", { code: "Digit3", metaKey: true });

    expect(headingLevel(editor)).toBe(3);
    editor.destroy();
  });

  it("重复按当前层级快捷键回到正文", () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: mdToHtml("正文"),
    });
    const init = { code: "Digit2", ctrlKey: true };
    press(editor, "2", init);
    press(editor, "2", init);

    expect(headingLevel(editor)).toBeNull();
    editor.destroy();
  });
});
