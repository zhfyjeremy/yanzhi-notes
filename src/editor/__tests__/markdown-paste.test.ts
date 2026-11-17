import { describe, expect, it, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../extensions";
import { docToMarkdown } from "../markdown/serialize";
import { handleMarkdownPaste } from "../markdown-paste";

function clipboardEvent(text: string, types: string[] = ["text/plain"], html = ""): ClipboardEvent {
  const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      types,
      files: [],
      getData: (type: string) => (type === "text/plain" ? text : type === "text/html" ? html : ""),
    },
  });
  return event;
}

describe("纯文本 Markdown 粘贴", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("多块 Markdown 直接解析为排版视图节点", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.focus("start");
    const handled = handleMarkdownPaste(editor.view, clipboardEvent("# 标题\n\n- 列表\n\n```ts\nconst a = 1;\n```\n"));
    expect(handled).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.attrs.level).toBe(1);
    expect(editor.state.doc.toString()).toContain("bulletList");
    expect(editor.state.doc.toString()).toContain("codeBlock");
  });

  it("VS Code 式源码 HTML 优先按 text/plain Markdown 解析", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.focus("start");
    const markdown = "# 标题\n\n- 列表";
    const html =
      '<div style="font-family: Consolas, monospace;white-space: pre;"><div><span># </span><span>标题</span></div><br><div><span>- </span><span>列表</span></div></div>';
    expect(handleMarkdownPaste(editor.view, clipboardEvent(markdown, ["text/plain", "text/html"], html))).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.toString()).toContain("bulletList");
  });
  it("Windows CF_HTML 头 + 代码编辑器样式仍按 Markdown 解析", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.focus("start");
    const markdown = "# 标题\n\n- 列表";
    const html =
      "Version:0.9\r\nStartHTML:0000000105\r\nEndHTML:0000000300\r\n<html><body><!--StartFragment--><div style=\"font-family: Consolas, monospace;white-space: pre;\"><div><span># </span><span>标题</span></div><br><div><span>- </span><span>列表</span></div></div><!--EndFragment--></body></html>";
    expect(handleMarkdownPaste(editor.view, clipboardEvent(markdown, ["text/plain", "text/html"], html))).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.toString()).toContain("bulletList");
  });
  it("砚知失败粘贴后的 PM 源码副本也按 Markdown 解析", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.focus("start");
    const markdown = "# 标题\n\n- 列表";
    const html =
      '<p data-pm-slice="0 0 []"><font color="#8e5cd9"># </font>标题<br><br><font color="#8e5cd9">-</font> 列表</p>';
    expect(handleMarkdownPaste(editor.view, clipboardEvent(markdown, ["text/plain", "text/html"], html))).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.toString()).toContain("bulletList");
  });
  it("剪贴板含 text/html 时回退富文本粘贴清洗路径", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.focus("start");
    const handled = handleMarkdownPaste(editor.view, clipboardEvent("# 标题", ["text/plain", "text/html"], "<h1>标题</h1>"));
    expect(handled).toBe(false);
  });

  it("代码块内粘贴 Markdown 源码保持原样", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<pre><code></code></pre>" });
    editor.commands.focus("start");
    const handled = handleMarkdownPaste(editor.view, clipboardEvent("# 不是标题"));
    expect(handled).toBe(false);
    expect(editor.state.doc.textContent).toBe("");
  });

  it("普通纯文本不走 Markdown 强制解析", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.focus("start");
    expect(handleMarkdownPaste(editor.view, clipboardEvent("普通第一行\n普通第二行"))).toBe(false);
  });
  it("使用统一 Schema,表格与任务列表保留语义", () => {
    editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.focus("start");
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n\n- [ ] 任务\n";
    expect(handleMarkdownPaste(editor.view, clipboardEvent(md))).toBe(true);
    expect(editor.state.doc.toString()).toContain("table");
    expect(editor.state.doc.toString()).toContain("taskList");
    expect(docToMarkdown(editor.state.doc)).toContain("| a | b |");
    expect(docToMarkdown(editor.state.doc)).toContain("- [ ] 任务");
  });
});