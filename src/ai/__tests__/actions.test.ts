import { describe, expect, it } from "vitest";
import { AI_ACTIONS, aiActionById } from "../actions";

describe("AI 动作表", () => {
  it("首期九个动作齐全且续写允许空选区", () => {
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
    ]);
    expect(aiActionById("continue").allowEmptySelection).toBe(true);
    expect(AI_ACTIONS.filter((a) => a.id !== "continue").every((a) => !a.allowEmptySelection)).toBe(
      true,
    );
  });
  it("userPrompt 带上上下文", () => {
    const p = aiActionById("polish").userPrompt("你好世界");
    expect(p).toContain("你好世界");
  });
});
