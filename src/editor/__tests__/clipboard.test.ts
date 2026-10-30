import { describe, expect, it } from "vitest";
import { DOMSerializer } from "@tiptap/pm/model";
import { inlineStyles } from "../clipboard";
import { markdownToDoc } from "../markdown/parse";
import { getSchema } from "../markdown/schema";

/** 与 editor.getHTML() 等价的序列化(schema renderHTML 路径) */
function toHtml(md: string): string {
  const schema = getSchema();
  const doc = markdownToDoc(md, schema);
  const frag = DOMSerializer.fromSchema(schema).serializeFragment(doc.content);
  const div = document.createElement("div");
  div.appendChild(frag);
  return div.innerHTML;
}

describe("inlineStyles(复制为 HTML 的内联样式注入)", () => {
  it("表格获得边框与单元格 padding", () => {
    const html = inlineStyles(toHtml("| a | b |\n| --- | --- |\n| 1 | 2 |"));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table")!;
    const th = doc.querySelector("th")!;
    expect(table.style.borderCollapse).toBe("collapse");
    expect(th.style.border).toContain("1px solid");
    expect(th.style.padding).not.toBe("");
  });

  it("代码块/行内代码获得底色与等宽字体", () => {
    const html = inlineStyles(toHtml("`code`"));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const code = doc.querySelector("code")!;
    expect(code.style.background).not.toBe("");
    expect(code.style.fontFamily).toContain("monospace");
  });

  it("容器带正文排版基准,双链着色", () => {
    const html = inlineStyles(toHtml("[[目标]]"));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const wrap = doc.querySelector("div")!;
    expect(wrap.style.lineHeight).toBe("1.75");
    expect(doc.querySelector("a")!.style.color).not.toBe("");
  });

  it("text-align 属性保留(表格对齐不丢)", () => {
    const html = inlineStyles(toHtml("| a |\n| :---: |\n| 1 |"));
    expect(html).toContain("text-align");
  });
});
