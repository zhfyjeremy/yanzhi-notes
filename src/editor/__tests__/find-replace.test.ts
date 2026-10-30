import { describe, expect, it } from "vitest";
import { findMatches } from "../find-replace";
import { markdownToDoc } from "../markdown/parse";
import { getSchema } from "../markdown/schema";

const schema = getSchema();
const doc = (md: string) => markdownToDoc(md, schema);

describe("findMatches(文档内查找)", () => {
  it("多处匹配按位置序返回", () => {
    const d = doc("读砚知用砚知夸砚知");
    expect(findMatches(d, "砚知")).toEqual([
      { from: 2, to: 4 },
      { from: 5, to: 7 },
      { from: 8, to: 10 },
    ]);
  });

  it("不区分大小写", () => {
    const d = doc("YanZhi notes yanzhi");
    expect(findMatches(d, "yanzhi")).toHaveLength(2);
  });

  it("空词无匹配;跨节点文本不拼接", () => {
    const d = doc("**砚**知");
    expect(findMatches(d, "")).toEqual([]);
    // 「砚」带 bold mark 与「知」是不同 text 节点,跨节点的"砚知"不命中(Typora 同口径)
    expect(findMatches(d, "砚知")).toEqual([]);
  });

  it("代码块内同样命中", () => {
    const d = doc("```\nfoo bar foo\n```");
    expect(findMatches(d, "foo")).toHaveLength(2);
  });
});
