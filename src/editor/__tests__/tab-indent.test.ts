import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../extensions";
import { TabIndent } from "../extensions/tab-indent";
import { docToMarkdown } from "../markdown/serialize";
import { mdToHtml } from "../markdown/md-instance";

const INDENT = "\u00a0".repeat(4);

function codeText(editor: Editor): string {
  let text = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "codeBlock") {
      text = node.textContent;
      return false;
    }
    return true;
  });
  return text;
}

function pressTab(editor: Editor, shiftKey = false): void {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    shiftKey,
    cancelable: true,
  });
  editor.view.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

describe("排版视图 Tab 缩进", () => {
  it("光标在文字后按 Tab,在文字后插入四字符视觉缩进", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent],
      content: mdToHtml("abc\n\n后文"),
    });
    let paragraphEnd: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "abc") {
        paragraphEnd = pos + 1 + node.content.size;
        return false;
      }
      return true;
    });
    expect(paragraphEnd).not.toBeNull();
    editor.commands.setTextSelection(paragraphEnd!);

    pressTab(editor);
    expect(editor.getText()).toBe(`abc${INDENT}\n\n后文`);
    expect(docToMarkdown(editor.state.doc)).toBe(`abc${INDENT}\n\n后文\n`);
    editor.destroy();
  });

  it("Tab 缩进字符数跟随设置,Shift+Tab 可移除文字后刚插入的缩进", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent.configure({ indentSize: 2 })],
      content: mdToHtml("abc"),
    });
    editor.commands.setTextSelection(4);

    pressTab(editor);
    expect(editor.getText()).toBe(`abc${"\u00a0".repeat(2)}`);
    pressTab(editor, true);
    expect(editor.getText()).toBe("abc");
    editor.destroy();
  });

  it("光标在行首按 Tab 缩进整行,Shift+Tab 缩回", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent],
      content: mdToHtml("正文"),
    });
    editor.commands.focus("start");

    pressTab(editor);
    expect(editor.getText()).toBe(`${INDENT}正文`);

    editor.commands.focus("start");
    pressTab(editor, true);
    expect(editor.getText()).toBe("正文");
    editor.destroy();
  });

  it("列表内保留既有 Tab 升级语义", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent],
      content: mdToHtml("- a\n- b"),
    });

    let listTextEnd: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "b") {
        listTextEnd = pos + 1 + node.content.size;
        return false;
      }
      return true;
    });
    expect(listTextEnd).not.toBeNull();
    editor.commands.setTextSelection(listTextEnd!);

    pressTab(editor);
    const json = JSON.stringify(editor.getJSON());
    expect(json).toMatch(/"type":"listItem"[\s\S]*"type":"bulletList"[\s\S]*"type":"listItem"/);
    editor.destroy();
  });

  it("代码块光标后按 Tab,在光标处插入四个空格", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent],
      content: mdToHtml("```ts\nfoo\n```"),
    });
    let afterFoo: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") {
        afterFoo = pos + 1 + "foo".length;
        return false;
      }
      return true;
    });
    expect(afterFoo).not.toBeNull();
    editor.commands.setTextSelection(afterFoo!);

    pressTab(editor);
    expect(codeText(editor)).toBe("foo    \n");
    editor.destroy();
  });

  it("非空选区按块缩进,不会用缩进串替换选区文字", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent],
      content: mdToHtml("一行\n\n二行"),
    });
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    pressTab(editor);
    expect(editor.getText()).toBe(`${INDENT}一行\n\n${INDENT}二行`);
    pressTab(editor, true);
    expect(editor.getText()).toBe("一行\n\n二行");
    editor.destroy();
  });

  it("正文 Tab 只产生一次文档变更事务", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent],
      content: mdToHtml("abc"),
    });
    editor.commands.setTextSelection(4);
    let docChanged = 0;
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) docChanged += 1;
    });
    pressTab(editor);
    expect(docChanged).toBe(1);
    expect(editor.getText()).toBe(`abc${INDENT}`);
    editor.destroy();
  });

  it("空段落可连续 Tab 深入缩进,Enter 新行不继承上行缩进", () => {
    const editor = new Editor({
      extensions: [...baseExtensions, TabIndent],
      content: "<p>上文</p><p></p>",
    });
    let emptyPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.content.size === 0) {
        emptyPos = pos + 1;
        return false;
      }
      return true;
    });
    expect(emptyPos).not.toBeNull();
    editor.commands.setTextSelection(emptyPos!);

    pressTab(editor);
    pressTab(editor);
    pressTab(editor);
    expect(editor.state.selection.$from.parent.textContent).toBe(INDENT.repeat(3));
    expect(docToMarkdown(editor.state.doc)).toBe(`上文\n\n${INDENT.repeat(3)}\n`);

    // Enter 拆段:新行应从头开始,不带着上行 NBSP
    editor.commands.enter();
    expect(editor.state.selection.$from.parent.textContent).toBe("");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    editor.destroy();
  });
});
