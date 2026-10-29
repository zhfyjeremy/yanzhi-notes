import { describe, expect, it } from "vitest";
import { markdownToDoc } from "../markdown/parse";
import { docToMarkdown } from "../markdown/serialize";
import { getSchema } from "../markdown/schema";

/**
 * 文字颜色方言(§10)序列化边界。
 * PM 常态将连续同 mark 文本拆成多个 run(嵌套加粗处分裂),
 * 序列化必须外提公共 fontColor 为一层标签,而不是逐 run 重复。
 */

describe("文字颜色方言序列化", () => {
  it("font 包住异构内容时公共 mark 外提", () => {
    const markdown = `<font color="#4ea832">绿**加粗**</font> 混排。`;
    const schema = getSchema();
    const output = docToMarkdown(markdownToDoc(markdown, schema));
    expect(output).toBe(`${markdown}\n`);
    expect(docToMarkdown(markdownToDoc(output, schema))).toBe(output);
  });

  it("font 跨行内代码时拆分:code 内无格式(PM code 语义),降级形态二次稳定", () => {
    const input = `<font color="#3b82f6">色 \`x = 1\` 码</font>尾。`;
    const schema = getSchema();
    const output = docToMarkdown(markdownToDoc(input, schema));
    // code 文本不携带 fontColor(PM 解析行为),font 只剩码字前后两段
    expect(output).toBe(
      `<font color="#3b82f6">色 </font>\`x = 1\`<font color="#3b82f6"> 码</font>尾。\n`,
    );
    expect(docToMarkdown(markdownToDoc(output, schema))).toBe(output);
  });
});
