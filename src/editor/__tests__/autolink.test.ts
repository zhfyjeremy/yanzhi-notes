import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { baseExtensions } from "../extensions";
import { docToMarkdown } from "../markdown/serialize";

/**
 * 编辑器输入/粘贴路径的裸 URL 自动链接边界(extensions/autolink.ts)。
 * 内置 autolink 用 linkifyjs 会把「URL 后紧跟的 , (...)」整段吞进链接;
 * yz 插件换 linkify-it(markdown-it 同源),两路径边界一致。
 */

function makeEditor(content = "<p></p>"): Editor {
  return new Editor({ extensions: baseExtensions, content });
}

function links(editor: Editor): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    if (!node.marks.some((mark) => mark.type.name === "link")) return true;
    out.push({ text: node.text ?? "", href: String(node.marks.find((mark) => mark.type.name === "link")?.attrs.href ?? "") });
    return true;
  });
  return out;
}

describe("编辑器自动链接边界(linkify-it)", () => {
  const editors: Editor[] = [];
  function track(editor: Editor): Editor {
    editors.push(editor);
    return editor;
  }
  afterEach(() => {
    editors.forEach((editor) => editor.destroy());
    editors.length = 0;
  });

  it("实时成链:https:// 后再输入即成链,不等空格(Typora 式)", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent("https://");
    expect(links(editor)).toEqual([]); // 仅 scheme 不成链
    editor.commands.insertContent("w");
    expect(links(editor)).toEqual([{ text: "https://w", href: "https://w" }]);
  });

  it("实时成链:继续输入随匹配生长", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent("https://www.example.com");
    expect(links(editor)).toEqual([
      { text: "https://www.example.com", href: "https://www.example.com" },
    ]);
  });

  it("实时成链:逐字符连续输入全程保持链接且 href 同步生长", () => {
    const editor = track(makeEditor());
    for (const ch of "https://www.baidu.com") {
      editor.commands.insertContent(ch);
    }
    expect(links(editor)).toEqual([
      { text: "https://www.baidu.com", href: "https://www.baidu.com" },
    ]);
  });

  it("实时成链:URL 后输入 ,(...) 尾巴不成链", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent("https://chwms-app.apps.intra.local");
    editor.commands.insertContent(",(apk,gitlab流水线产物)");
    expect(links(editor)).toEqual([
      { text: "https://chwms-app.apps.intra.local", href: "https://chwms-app.apps.intra.local" },
    ]);
  });

  it("删除回退:删到不再构成链接时自动变回文本", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent("https://www.baidu.com");
    expect(links(editor)).toHaveLength(1);
    const backspace = () => {
      const pos = editor.state.selection.from;
      editor.commands.setTextSelection({ from: pos - 1, to: pos });
      editor.commands.deleteSelection();
    };
    // 逐字删到 https://w(首次成链的最短形态)仍是链接
    while (editor.state.doc.textContent.length > 9) backspace();
    expect(editor.state.doc.textContent).toBe("https://w");
    expect(links(editor)).toEqual([{ text: "https://w", href: "https://w" }]);
    // 再删一字到 https:// 不再构成链接 → 变回纯文本
    backspace();
    expect(editor.state.doc.textContent).toBe("https://");
    expect(links(editor)).toEqual([]);
  });

  it("删除回退:改名手动链接删除时不被拆掉", () => {
    const editor = track(makeEditor('<p><a href="https://example.com">说明</a></p>'));
    editor.commands.setTextSelection(editor.state.doc.content.size);
    const pos = editor.state.selection.from;
    editor.commands.setTextSelection({ from: pos - 1, to: pos });
    editor.commands.deleteSelection();
    expect(editor.state.doc.textContent).toBe("说");
    expect(links(editor)).toEqual([{ text: "说", href: "https://example.com" }]);
  });

  it("删除回退:历史落盘的自引用链接删破后同样回退为文本", () => {
    const editor = track(makeEditor("<p><a href=\"https://a.com/x\">https://a.com/x</a></p>"));
    editor.commands.setTextSelection(editor.state.doc.content.size);
    const backspace = () => {
      const pos = editor.state.selection.from;
      editor.commands.setTextSelection({ from: pos - 1, to: pos });
      editor.commands.deleteSelection();
    };
    while (editor.state.doc.textContent.length > 9) backspace();
    expect(links(editor)).toEqual([{ text: "https://a", href: "https://a" }]);
    backspace();
    expect(links(editor)).toEqual([]);
  });

  it("undo 摘链后不会被自动重新成链", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent("https://example.com/a ");
    expect(links(editor)).toHaveLength(1);
    editor.commands.undo();
    expect(links(editor)).toEqual([]);
  });

  it("手动改名链接不被实时分支破坏", () => {
    const editor = track(makeEditor('<p><a href="https://other.example">发布地址</a></p>'));
    editor.commands.setTextSelection(editor.state.doc.content.size);
    editor.commands.insertContent("x");
    const manual = links(editor).find((item) => item.href === "https://other.example");
    expect(manual?.text).toContain("发布地址");
  });

  it("URL 后紧跟逗号+括号:链接只到 URL 结尾(用户报告案例)", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent(
      "内网 http://chwms-app.apps.intra.local,(apk,gitlab流水线产物) ",
    );
    expect(links(editor)).toEqual([
      { text: "http://chwms-app.apps.intra.local", href: "http://chwms-app.apps.intra.local" },
    ]);
    const markdown = docToMarkdown(editor.state.doc);
    // serialize 对普通文本括号加转义(\( \)),链接文本不受影响
    expect(markdown).toContain(
      "[http://chwms-app.apps.intra.local](http://chwms-app.apps.intra.local),\\(apk,gitlab流水线产物\\)",
    );
    expect(markdown).not.toContain("(apk,gitlab流水线产物](");
  });

  it("普通 URL 仍整段成链", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent("发布地址 https://example.com/a/b ");
    expect(links(editor)).toEqual([
      { text: "https://example.com/a/b", href: "https://example.com/a/b" },
    ]);
  });

  it("句尾标点留在链接外,与 md-open 路径一致", () => {
    const editor = track(makeEditor());
    editor.commands.insertContent("https://example.com/x. ");
    expect(links(editor)).toEqual([{ text: "https://example.com/x", href: "https://example.com/x" }]);
    expect(editor.state.doc.textContent.startsWith("https://example.com/x. ")).toBe(true);
  });

  it("行内代码中的 URL 不自动成链", () => {
    const editor = track(makeEditor());
    const schema = editor.state.schema;
    const codeText = schema.text("https://a.com/x", [schema.marks.code.create()]);
    editor.commands.insertContent([codeText, " "]);
    expect(links(editor)).toEqual([]);
  });

  it("选区粘贴整段 URL → 转链接;带逗号后缀则不转", () => {
    const editor = track(makeEditor("<p>占位</p>"));
    const { schema } = editor.state;
    const event = new Event("paste") as ClipboardEvent;

    editor.commands.selectAll();
    const pureUrl = new Slice(Fragment.from(schema.text("https://example.com/a/b")), 0, 0);
    let handled = editor.view.someProp("handlePaste", (f) => f(editor.view, event, pureUrl));
    expect(handled).toBe(true);
    // linkOnPaste 语义:选中文本成为链接(href=粘贴的 URL),内容不替换
    expect(links(editor)).toEqual([
      { text: "占位", href: "https://example.com/a/b" },
    ]);

    editor.commands.selectAll();
    const commaTail = new Slice(
      Fragment.from(schema.text("https://chwms-app.apps.intra.local,(apk,gitlab流水线产物)")),
      0,
      0,
    );
    handled = editor.view.someProp("handlePaste", (f) => f(editor.view, event, commaTail));
    expect(handled ?? false).toBe(false);
  });
});
