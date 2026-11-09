import { describe, expect, it } from "vitest";
import { markdownForRange } from "../copy-markdown";
import { markdownToDoc } from "../markdown/parse";
import { getSchema } from "../markdown/schema";

describe("复制为 Markdown", () => {
  it("空选区复制整篇,走唯一序列化出口", () => {
    const schema = getSchema();
    const md = "# 标题\n\n正文 **重点**。\n";
    const doc = markdownToDoc(md, schema);
    expect(markdownForRange(doc, schema, 1, 1)).toBe(md);
  });

  it("行内选区保留格式并包装为可序列化段落", () => {
    const schema = getSchema();
    const doc = markdownToDoc("前文 **重点** 后文\n", schema);
    const text = doc.firstChild!.textBetween(0, doc.firstChild!.content.size);
    const from = 1 + text.indexOf("重点");
    expect(doc.textBetween(from, from + 2)).toBe("重点");
    expect(markdownForRange(doc, schema, from, from + 2).trim()).toBe("**重点**");
  });

  it("跨段落选区仍按块级 Markdown 输出", () => {
    const schema = getSchema();
    const doc = markdownToDoc("第一段\n\n第二段\n", schema);
    const first = doc.firstChild!;
    const second = doc.child(1);
    const from = 1 + first.textContent.indexOf("第一");
    const to = first.nodeSize + second.nodeSize - 1;
    const out = markdownForRange(doc, schema, from, to);
    expect(out).toContain("第一段");
    expect(out).toContain("第二");
  });
});
