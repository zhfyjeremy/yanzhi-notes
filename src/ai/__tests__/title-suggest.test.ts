import { describe, expect, it } from "vitest";
import {
  TITLE_AI_CONTEXT_LIMIT,
  buildTitleContext,
  markdownFingerprint,
  parseAiTitleSuggestions,
  sanitizeAiTitle,
} from "../title-suggest";

describe("AI 起标题", () => {
  it("解析并清洗模型输出的候选标题", () => {
    expect(
      parseAiTitleSuggestions(
        [
          "1. **砚知本地知识库设计**",
          "- `Markdown双链.md`",
          "（无）",
          "# 第三个候选",
          "重复/重复",
        ].join("\n"),
      ),
    ).toEqual(["砚知本地知识库设计", "Markdown双链", "第三个候选"]);
  });

  it("过滤文件名非法字符、扩展名和空结果", () => {
    expect(sanitizeAiTitle('  # 设计/"回滚":<策略>.md ')).toBe("设计回滚策略");
    expect(sanitizeAiTitle("   .md   ")).toBeNull();
    expect(sanitizeAiTitle("（无）")).toBeNull();
  });

  it("限制标题长度避免文件名超限", () => {
    const longTitle = sanitizeAiTitle("砚".repeat(80));
    expect(longTitle).not.toBeNull();
    if (longTitle === null) throw new Error("长标题不应为空");
    expect(Array.from(longTitle).length).toBeLessThanOrEqual(48);
  });

  it("标题上下文按 Unicode 字符截取并保留原始终点信息", () => {
    const markdown = "😀".repeat(TITLE_AI_CONTEXT_LIMIT + 1);
    const context = buildTitleContext(markdown);
    expect(context.chars).toBe(TITLE_AI_CONTEXT_LIMIT + 1);
    expect(context.clipped).toBe(true);
    expect(Array.from(context.text)).toHaveLength(TITLE_AI_CONTEXT_LIMIT);
    expect(markdownFingerprint(context.text)).not.toBe(markdownFingerprint(markdown));
  });
});
