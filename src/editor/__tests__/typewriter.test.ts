import { describe, expect, it } from "vitest";
import { typewriterTargetScroll } from "../typewriter";

describe("打字机滚动目标", () => {
  it("把光标对齐到视口 ratio 处并钳制边界", () => {
    // caret 在 500,视口 400,ratio 0.45 → 目标 500-180=320
    expect(typewriterTargetScroll(500, 400, 2000, 0.45)).toBe(320);
  });
  it("文首不够上滚时钳到 0", () => {
    expect(typewriterTargetScroll(50, 400, 2000, 0.45)).toBe(0);
  });
  it("文末不够下滚时钳到 max", () => {
    // max = 800-400=400; caret 750 → 750-180=570 → 钳 400
    expect(typewriterTargetScroll(750, 400, 800, 0.45)).toBe(400);
  });
  it("内容矮于视口时始终 0", () => {
    expect(typewriterTargetScroll(100, 400, 300, 0.45)).toBe(0);
  });
  it("viewport 非法时回 0", () => {
    expect(typewriterTargetScroll(100, 0, 1000)).toBe(0);
  });
});
