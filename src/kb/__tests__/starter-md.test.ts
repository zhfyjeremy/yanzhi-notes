import { describe, expect, it } from "vitest";
import { mdToHtml } from "../../editor/markdown/md-instance";
import { STARTER_MD } from "../help-docs";

describe("开始使用.md", () => {
  const html = mdToHtml(STARTER_MD);

  it("开篇先给 3 步上手,而不是先讲存储原理", () => {
    expect(STARTER_MD.trimStart().startsWith("# 开始使用\n\n> [!SUCCESS] 先做这 3 件事")).toBe(true);
  });

  it("引导里的 Markdown 方言都能被统一解析链路接受", () => {
    expect(html).toContain('data-callout="success"');
    expect(html).toContain('data-callout="info"');
    expect(html).toContain('data-type="wiki-link"');
    expect(html).toContain("<table>");
    expect(html).not.toContain("[!SUCCESS]");
    expect(html).not.toContain("[!INFO]");
  });

  it("覆盖首次使用必须知道的关键动作", () => {
    for (const text of [
      "自动保存",
      "标签页",
      "反向链接",
      "回收站",
      "复制知识库路径",
      "AI 默认关闭",
    ]) {
      expect(html).toContain(text);
    }
  });
});