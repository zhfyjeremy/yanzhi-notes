/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";
import { docToMarkdown } from "../markdown/serialize";
import { setColumnAlign } from "../table-utils";
import { inlineStyles } from "../clipboard";

/**
 * 表格对齐默认值的统一(PRD §5.3.9 表格卡片):
 *
 * 1) 浏览器 UA 样式给 th 的默认值是居中、td 是左对齐。新插入的表格两个单元格
 *    都没有 inline text-align,于是表头居中、内容左对齐,观感割裂。
 *    → 编辑器 CSS / 导出 HTML / 复制 HTML 三处都要显式给 th、td 默认左对齐。
 *
 * 2) Tiptap v3 内置 align 属性与砚知的 textAlign 都会渲染 style="text-align: …",
 *    两份并存时「取消对齐」只清 textAlign,残留的 align 仍渲染出 text-align,
 *    还原不生效。→ 去掉内置 align,textAlign 是唯一真相。
 */

const editorCss = readFileSync("src/editor/editor.css", "utf8");
const exportHtmlSource = readFileSync("src/kb/export-html.ts", "utf8");

function makeEditor(content = "<p></p>"): Editor {
  return new Editor({ extensions: baseExtensions, content });
}

describe("表格默认对齐", () => {
  it("新插入的表格:表头与内容都不带 inline text-align(交给 CSS 默认左对齐)", () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

    const html = editor.getHTML();
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).not.toMatch(/<th[^>]*text-align/);
    expect(html).not.toMatch(/<td[^>]*text-align/);
    editor.destroy();
  });

  it("工具栏插入的表格可用 Mod+Z 撤销", () => {
    const editor = makeEditor("<p>正文</p>");
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    expect(editor.state.doc.firstChild?.type.name).toBe("table");

    const event = new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    editor.destroy();
  });

  it("编辑器 CSS:th/td 统一显式左对齐,盖掉浏览器 UA 的 th 居中", () => {
    const rule = /\.yz-editor-doc th,\s*\.yz-editor-doc td \{[^}]+\}/.exec(editorCss)?.[0] ?? "";
    expect(rule, "表格单元格规则缺失").not.toBe("");
    expect(rule).toContain("text-align: left");
  });

  it("导出 HTML:th/td 统一显式左对齐", () => {
    const rule = /th, td \{ text-align: left; \}/.exec(exportHtmlSource)?.[0] ?? "";
    expect(rule, "导出页表格默认对齐规则缺失").not.toBe("");
  });

  it("复制为 HTML:th/td 注入 inline text-align: left,且不覆盖显式对齐", () => {
    const html = inlineStyles("<table><tr><th>表头</th></tr><tr><td>内容</td></tr></table>");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("th")?.style.textAlign).toBe("left");
    expect(doc.querySelector("td")?.style.textAlign).toBe("left");

    const aligned = inlineStyles(
      '<table><tr><th style="text-align: center;">表头</th></tr><tr><td style="text-align: center;">内容</td></tr></table>',
    );
    const alignedDoc = new DOMParser().parseFromString(aligned, "text/html");
    expect(alignedDoc.querySelector("th")?.style.textAlign).toBe("center");
    expect(alignedDoc.querySelector("td")?.style.textAlign).toBe("center");
  });
});

describe("表格对齐属性唯一真相", () => {
  it("单元格不再保留 Tiptap 内置 align 属性(与 textAlign 双源冲突)", () => {
    const editor = makeEditor(mdToHtml("| a |\n| :---: |\n| 1 |"));
    const header = editor.state.doc.firstChild?.child(0)?.child(0);
    expect(header?.attrs.textAlign).toBe("center");
    expect(header?.attrs).not.toHaveProperty("align");
    editor.destroy();
  });

  it("取消对齐后彻底还原(无残留 align 导致 text-align 不消失)", () => {
    const editor = makeEditor(mdToHtml("| a |\n| :---: |\n| 1 |"));
    setColumnAlign(editor, null);

    const header = editor.state.doc.firstChild?.child(0)?.child(0);
    expect(header?.attrs.textAlign).toBeNull();
    expect(editor.getHTML()).not.toMatch(/<th[^>]*text-align/);
    expect(editor.getHTML()).not.toMatch(/<td[^>]*text-align/);
    editor.destroy();
  });

  it("设置对齐后仍按 GFM 列级标记序列化", () => {
    const editor = makeEditor(mdToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |"));
    setColumnAlign(editor, "center");
    expect(docToMarkdown(editor.state.doc)).toContain("| :---: | --- |");
    editor.destroy();
  });
});
