import { describe, expect, it } from "vitest";
import { buildSnippet, highlightTerms, KbSearchIndex, tokenize } from "../search";

describe("tokenize(中文 bigram + 西文按词)", () => {
  it("CJK 连续段拆单字 + 双字", () => {
    expect(tokenize("世界")).toEqual(["世", "世界", "界"]);
  });
  it("单字 CJK 保留单字", () => {
    expect(tokenize("知")).toEqual(["知"]);
  });
  it("西文整词小写,标点切开", () => {
    expect(tokenize("Hello, Flex-Search 2")).toEqual(["hello", "flex", "search", "2"]);
  });
  it("全标点/空白 → 空数组(空查询拦截依据)", () => {
    expect(tokenize(".,,  !!")).toEqual([]);
  });
});

describe("highlightTerms", () => {
  it("多字词优先去重", () => {
    expect(highlightTerms("知识库")).toEqual(["知识", "识库"]);
  });
  it("单字查询用单字", () => {
    expect(highlightTerms("知")).toEqual(["知"]);
  });
});

describe("buildSnippet", () => {
  it("命中词切分片段并标记 hit", () => {
    const segs = buildSnippet("前文甲乙丙丁目标词后文戊己庚", ["目标词"]);
    expect(segs.some((s) => s.hit && s.text === "目标词")).toBe(true);
    expect(segs.map((s) => s.text).join("")).toContain("目标词");
  });
  it("无命中给开头摘要(无高亮)", () => {
    const segs = buildSnippet("普通正文", ["不存在"]);
    expect(segs).toHaveLength(1);
    expect(segs[0].hit).toBe(false);
  });
});

describe("KbSearchIndex(标题加权 > 路径 > 正文)", () => {
  it("标题命中排在正文命中前", () => {
    const idx = new KbSearchIndex();
    idx.add("a/正文里有砚知.md", "砚知出现在正文里");
    idx.add("b/随便.md", "# 无关标题\n\n正文没有");
    const hits = idx.search("砚知");
    expect(hits[0].path).toBe("a/正文里有砚知.md"); // 标题+正文双命中
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
  it("路径命中排在纯正文命中前", () => {
    const idx = new KbSearchIndex();
    idx.add("tech笔记/普通.md", "提到 flexsearch 一次");
    idx.add("其它/文档.md", "提到 flexsearch 很多次 flexsearch flexsearch");
    const hits = idx.search("flexsearch");
    expect(hits[0].path).toBe("tech笔记/普通.md");
  });
  it("中文按字/词命中", () => {
    const idx = new KbSearchIndex();
    idx.add("随笔/第一篇.md", "本地知识库的知识在本地");
    const hits = idx.search("知识");
    expect(hits.map((h) => h.path)).toContain("随笔/第一篇.md");
  });
  it("update/remove 生效", () => {
    const idx = new KbSearchIndex();
    idx.add("a.md", "alpha");
    expect(idx.search("alpha").length).toBe(1);
    idx.remove("a.md");
    expect(idx.search("alpha").length).toBe(0);
    idx.add("a.md", "beta");
    expect(idx.search("beta").length).toBe(1);
  });
  it("纯标点查询返回空", () => {
    const idx = new KbSearchIndex();
    idx.add("a.md", "x");
    expect(idx.search("!!")).toEqual([]);
  });
});
