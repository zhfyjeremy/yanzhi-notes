import { describe, expect, it } from "vitest";
import { AI_ACTIONS, aiActionById } from "../actions";

describe("AI 动作表", () => {
  it("AI-1/2/3 动作齐全,续写与卡片节点动作允许空选区", () => {
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
      "explainCode",
      "rewriteCode",
      "mermaidGen",
      "mermaidFix",
      "mathGen",
    ]);
    expect(aiActionById("continue").allowEmptySelection).toBe(true);
    expect(aiActionById("explainCode").allowEmptySelection).toBe(true);
    expect(aiActionById("mermaidFix").requireNode).toBe("mermaid");
    expect(AI_ACTIONS.filter((a) => a.group === "write")).toHaveLength(9);
    expect(AI_ACTIONS.filter((a) => a.group === "structure")).toHaveLength(5);
    expect(AI_ACTIONS.filter((a) => a.group === "card")).toHaveLength(5);
  });

  it("结构/卡片回写标记", () => {
    expect(aiActionById("restructure").blockApply).toBe(true);
    expect(aiActionById("rewriteCode").applyMode).toBe("codeContent");
    expect(aiActionById("mermaidGen").applyMode).toBe("mermaidFence");
    expect(aiActionById("mathGen").option).toBe("math");
    expect(aiActionById("wikiSuggest").runningLabel).toBe("挑选相关双链");
  });

  it("userPrompt 带上上下文", () => {
    const p = aiActionById("polish").userPrompt("你好世界");
    expect(p).toContain("你好世界");
    expect(aiActionById("outline").userPrompt("第一章")).toContain("第一章");
    const wiki = aiActionById("wikiSuggest").userPrompt("正文里提到产品概述", "- [[产品概述]]");
    expect(wiki).toContain("[[产品概述]]");
    expect(aiActionById("explainCode").userPrompt("x=1", "python")).toContain("python");
  });
});
