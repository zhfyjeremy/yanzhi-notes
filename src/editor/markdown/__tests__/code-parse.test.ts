import { describe, expect, it } from "vitest";
import { markdownToDoc } from "../parse";
import { docToMarkdown } from "../serialize";
import { getSchema } from "../schema";

const schema = getSchema();

function firstCodeBlockText(markdown: string): string {
  let text: string | null = null;
  markdownToDoc(markdown, schema).descendants((node) => {
    if (node.type.name === "codeBlock") {
      text = node.textContent;
      return false;
    }
    return true;
  });
  return text ?? "";
}

/**
 * CommonMark 把闭合围栏前的换行算进代码内容,markdown-it 输出的
 * <pre><code> 因此带尾换行;PM 解析端必须剥掉,否则行号/视觉多一行空内容。
 * 序列化端(serialize.ts)对尾换行同口径,fixtures 往返不受影响。
 */
describe("代码块解析:尾换行不产生空尾行", () => {
  it("``` 围栏剥尾换行", () => {
    expect(firstCodeBlockText("```\nnacos.plugin.auth.type=none\nnacos.core.auth.enabled=false\n```\n")).toBe(
      "nacos.plugin.auth.type=none\nnacos.core.auth.enabled=false",
    );
  });

  it("带语言围栏同样剥尾换行", () => {
    expect(firstCodeBlockText("```properties\na=1\nb=2\n```\n")).toBe("a=1\nb=2");
  });

  it("缩进代码块剥尾换行", () => {
    expect(firstCodeBlockText("正文\n\n    a=1\n    b=2\n")).toBe("a=1\nb=2");
  });

  it("代码内空行保留,只剥最外层尾换行", () => {
    expect(firstCodeBlockText("```\na\n\nb\n```\n")).toBe("a\n\nb");
  });

  it("空围栏解析为空内容(单行)", () => {
    expect(firstCodeBlockText("```\n```\n")).toBe("");
  });

  it("剥尾换行后往返逐字一致", () => {
    const markdown = "```properties\nnacos.plugin.auth.type=none\nnacos.core.auth.enabled=false\n```\n";
    expect(docToMarkdown(markdownToDoc(markdown, schema))).toBe(markdown);
  });
});
