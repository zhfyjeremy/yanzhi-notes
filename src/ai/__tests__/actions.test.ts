import { describe, expect, it } from "vitest";
import { AI_ACTIONS, aiActionById } from "../actions";

describe("AI 动作表", () => {
  it("AI-1 写作九个 + AI-2 结构五个,续写允许空选区", () => {
    expect(AI_ACTIONS.map((a) => a.id)).toEqual([
      "polish",
      "continue",
      "expand",
      "shorten",
      "tone",
      "translate",
      "explain",
      "fix",
      "summarize",
      "outline",
      "restructure",
      "extractTodos",
      "toTable",
      "wikiSuggest",
    ]);
    expect(aiActionById("continue").allowEmptySelection).toBe(true);
    expect(AI_ACTIONS.filter((a) => a.id !== "continue").every((a) => !a.allowEmptySelection)).toBe(
      true,
    );
    expect(AI_ACTIONS.filter((a) => a.group === "write")).toHaveLength(9);
    expect(AI_ACTIONS.filter((a) => a.group === "structure")).toHaveLength(5);
  });

  it("结构替换类标记 blockApply", () => {
    expect(aiActionById("restructure").blockApply).toBe(true);
    expect(aiActionById("toTable").blockApply).toBe(true);
    expect(aiActionById("outline").bias).toBe("insert");
    expect(aiActionById("extractTodos").bias).toBe("insert");
    expect(aiActionById("wikiSuggest").bias).toBe("insert");
    expect(aiActionById("wikiSuggest").runningLabel).toBe("挑选相关双链");
    expect(aiActionById("polish").blockApply).toBeFalsy();
  });

  it("userPrompt 带上上下文", () => {
    const p = aiActionById("polish").userPrompt("你好世界");
    expect(p).toContain("你好世界");
    expect(aiActionById("outline").userPrompt("第一章")).toContain("第一章");
    const wiki = aiActionById("wikiSuggest").userPrompt("正文里提到产品概述", "- [[产品概述]]");
    expect(wiki).toContain("[[产品概述]]");
    expect(wiki).toContain("正文里提到产品概述");
  });
});
