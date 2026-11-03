import { describe, expect, it } from "vitest";
import {
  filterWikiSuggestOutput,
  formatWikiCatalog,
  parseWikiSuggestTargets,
} from "../wiki-suggest";

const docs = [
  { name: "产品概述", path: "产品概述.md", target: "产品概述" },
  { name: "平台策略", path: "docs/平台策略.md", target: "平台策略" },
  { name: "重名", path: "a/重名.md", target: "a/重名" },
  { name: "重名", path: "b/重名.md", target: "b/重名" },
];

describe("filterWikiSuggestOutput", () => {
  it("只保留能解析到知识库的双链", () => {
    const out = filterWikiSuggestOutput(
      "- [[产品概述]]\n- [[不存在的笔记]]\n- [[平台策略]]\n随便发明",
      docs,
    );
    expect(out).toBe("- [[产品概述]]\n- [[平台策略]]");
  });

  it("重名裸名落到首个;路径写法保留规范 target", () => {
    expect(filterWikiSuggestOutput("- [[重名]]", docs)).toBe("- [[a/重名]]");
    expect(filterWikiSuggestOutput("- [[b/重名]]", docs)).toBe("- [[b/重名]]");
  });

  it("无命中或空库返回固定空态", () => {
    expect(filterWikiSuggestOutput("- [[幻觉]]\n（无）", docs)).toContain("没有与选区匹配");
    expect(filterWikiSuggestOutput("- [[产品概述]]", [])).toContain("没有与选区匹配");
  });
});

describe("formatWikiCatalog", () => {
  it("按 target 列出候选", () => {
    const cat = formatWikiCatalog(docs.slice(0, 2));
    expect(cat).toContain("[[产品概述]]");
    expect(cat).toContain("[[平台策略]]");
  });
});

describe("parseWikiSuggestTargets", () => {
  it("抽出可点击目标;空态返回空数组", () => {
    expect(parseWikiSuggestTargets("- [[产品概述]]\n- [[平台策略]]")).toEqual([
      "产品概述",
      "平台策略",
    ]);
    expect(parseWikiSuggestTargets("（当前知识库中没有与选区匹配的文档）")).toEqual([]);
  });
});
