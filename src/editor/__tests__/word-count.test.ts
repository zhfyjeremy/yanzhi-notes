import { describe, expect, it } from "vitest";
import { countWords, countDocStats } from "../word-count";
import { markdownToDoc } from "../markdown/parse";
import { getSchema } from "../markdown/schema";

describe("countWords(状态栏字数)", () => {
  it("中文按字计数", () => {
    expect(countWords("砚知笔记")).toBe(4);
  });

  it("西文按词计数", () => {
    expect(countWords("hello world foo_bar")).toBe(4); // _ 不连词:foo、bar 各一词
  });

  it("中英混排", () => {
    expect(countWords("砚知 Notes 编辑器")).toBe(2 + 1 + 3);
  });

  it("标点与空白不计", () => {
    expect(countWords("你好,世界! \n\t ok")).toBe(4 + 1);
  });

  it("连字符合成一词", () => {
    expect(countWords("state-of-the-art")).toBe(1);
  });

  it("空文本为 0", () => {
    expect(countWords("")).toBe(0);
  });
});

describe("countDocStats(文档统计)", () => {
  it("统计字数/字符/段落/图片/表格/阅读时长", () => {
    const schema = getSchema();
    const doc = markdownToDoc(
      "# 标题\n\n正文一段。\n\n![](./assets/a.png)\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
      schema,
    );
    const stats = countDocStats(doc);
    expect(stats.words).toBeGreaterThan(0);
    expect(stats.chars).toBeGreaterThan(0);
    expect(stats.paragraphs).toBeGreaterThanOrEqual(2);
    expect(stats.images).toBe(1);
    expect(stats.tables).toBe(1);
    expect(stats.readMinutes).toBeGreaterThanOrEqual(1);
  });
});
