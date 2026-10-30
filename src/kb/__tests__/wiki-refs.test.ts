import { describe, expect, it } from "vitest";
import type { TreeNode } from "../types";
import {
  flattenDocs,
  movePatternsFor,
  refPatternsFor,
  resolveWikiTarget,
  updateWikiRefs,
  wikiTargetFor,
} from "../wiki-refs";

const tree: TreeNode[] = [
  {
    name: "随笔",
    path: "随笔",
    isDir: true,
    children: [
      { name: "第一篇", path: "随笔/第一篇.md", isDir: false, children: [] },
    ],
  },
  {
    name: "tech",
    path: "tech",
    isDir: true,
    children: [
      { name: "第一篇", path: "tech/第一篇.md", isDir: false, children: [] },
    ],
  },
  { name: "开始使用", path: "开始使用.md", isDir: false, children: [] },
];

describe("wiki-refs(双链目标解析与引用联动)", () => {
  it("flattenDocs 平铺文档(跳过文件夹)", () => {
    const docs = flattenDocs(tree);
    expect(docs.map((d) => d.path)).toEqual([
      "随笔/第一篇.md",
      "tech/第一篇.md",
      "开始使用.md",
    ]);
  });

  it("resolveWikiTarget:裸名唯一命中", () => {
    expect(resolveWikiTarget(flattenDocs(tree), "开始使用")).toBe("开始使用.md");
  });

  it("resolveWikiTarget:裸名重名取第一个(写入端应强制路径写法)", () => {
    expect(resolveWikiTarget(flattenDocs(tree), "第一篇")).toBe("随笔/第一篇.md");
  });

  it("resolveWikiTarget:路径写法精确匹配 / 未命中 null", () => {
    expect(resolveWikiTarget(flattenDocs(tree), "tech/第一篇")).toBe("tech/第一篇.md");
    expect(resolveWikiTarget(flattenDocs(tree), "不存在")).toBeNull();
    expect(resolveWikiTarget(flattenDocs(tree), "  ")).toBeNull();
  });

  it("wikiTargetFor:唯一名 → 裸名;重名 → 路径写法(§517)", () => {
    const docs = flattenDocs(tree);
    expect(wikiTargetFor(docs, "开始使用.md")).toBe("开始使用");
    expect(wikiTargetFor(docs, "tech/第一篇.md")).toBe("tech/第一篇");
  });
});

describe("updateWikiRefs(rename 引用联动,与 Rust 同构)", () => {
  it("文档改名:裸名 + 别名 + 路径写法都替换", () => {
    const refs = refPatternsFor("随笔/旧名.md", "随笔/新名.md", false);
    const md = "看 [[旧名]] 和 [[旧名|别名]] 与 [[随笔/旧名]],另有 [[其他]]。\n";
    const { content, count } = updateWikiRefs(md, refs);
    expect(content).toBe("看 [[新名]] 和 [[新名|别名]] 与 [[随笔/新名]],另有 [[其他]]。\n");
    expect(count).toBe(3);
  });

  it("子串名不误伤:改名「名」不动「旧名」", () => {
    const refs = refPatternsFor("a/名.md", "a/改名.md", false);
    const { content, count } = updateWikiRefs("[[旧名]] 和 [[名]]", refs);
    expect(content).toBe("[[旧名]] 和 [[改名]]");
    expect(count).toBe(1);
  });

  it("文件夹改名:[[folder/doc]] 段级替换,中间段与别名也处理", () => {
    const refs = refPatternsFor("folder", "folder2", true);
    const md = "[[folder/doc]]、[[a/folder/doc|别名]]、[[folder|别名是文件夹名]]、普通文本 folder/ 不动";
    const { content, count } = updateWikiRefs(md, refs);
    expect(content).toBe(
      "[[folder2/doc]]、[[a/folder2/doc|别名]]、[[folder|别名是文件夹名]]、普通文本 folder/ 不动",
    );
    expect(count).toBe(2);
  });

  it("文件夹段替换不影响别名(| 之后)", () => {
    const refs = refPatternsFor("f", "g", true);
    const { content } = updateWikiRefs("[[a/f|f/x]]", refs);
    expect(content).toBe("[[a/g|f/x]]");
  });
});

describe("updateWikiRefs(move 移动联动,名字不变)", () => {
  it("文档移动:路径写法与别名前缀改写,裸名不动", () => {
    const refs = movePatternsFor("tech/notes.md", "随笔/notes.md", false);
    const md = "[[tech/notes]]、[[tech/notes|别名]]、[[notes]] 不动、[[别的/notes]] 不动";
    const { content, count } = updateWikiRefs(md, refs);
    expect(content).toBe("[[随笔/notes]]、[[随笔/notes|别名]]、[[notes]] 不动、[[别的/notes]] 不动");
    expect(count).toBe(2);
  });

  it("根级文档移动:路径写法即裸名,无需改写", () => {
    expect(movePatternsFor("notes.md", "随笔/notes.md", false)).toEqual({ patterns: [] });
  });

  it("文件夹移动:仅整前缀命中才改写(同名段在别处不误伤)", () => {
    const refs = movePatternsFor("tech", "随笔/tech", true);
    const md = "[[tech/notes]]、[[tech/notes|别名]]、[[a/tech/x]] 不动、[[tech]] 不动、普通 tech/ 文本";
    const { content, count } = updateWikiRefs(md, refs);
    expect(content).toBe(
      "[[随笔/tech/notes]]、[[随笔/tech/notes|别名]]、[[a/tech/x]] 不动、[[tech]] 不动、普通 tech/ 文本",
    );
    expect(count).toBe(2);
  });
});
