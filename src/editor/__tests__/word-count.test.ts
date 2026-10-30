import { describe, expect, it } from "vitest";
import { countWords } from "../word-count";

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
