import { describe, expect, it } from "vitest";
import { parseWikiOut, WikiRefIndex } from "../backlinks";
import type { WikiDoc } from "../wiki-refs";

/** 树平铺(与 flattenDocs 输出同构) */
const docs: WikiDoc[] = [
  { path: "开始使用.md", name: "开始使用" },
  { path: "随笔/第一篇.md", name: "第一篇" },
  { path: "tech/notes.md", name: "notes" },
  { path: "tech/第一篇.md", name: "第一篇" }, // 重名(tech/ 下)
];

describe("parseWikiOut", () => {
  it("提取裸名/路径/别名三种写法", () => {
    const links = parseWikiOut(
      "见 [[开始使用]] 与 [[随笔/第一篇|随手记]],[[未闭合 不算",
    );
    expect(links).toEqual([
      { target: "开始使用", alias: null },
      { target: "随笔/第一篇", alias: "随手记" },
    ]);
  });

  it("目标原文保留首尾空格调平、空别名归 null", () => {
    expect(parseWikiOut("[[ a | ]]")).toEqual([{ target: "a", alias: null }]);
  });

  it("普通文本/链接式图片不误报", () => {
    expect(parseWikiOut("[不是链接] ![图](a.png) [[a]]b]]")).toEqual([{ target: "a", alias: null }]);
  });
});

describe("WikiRefIndex.backlinks", () => {
  it("三种写法归一到同一目标并合计次数;裸名重名取树序第一个", () => {
    const idx = new WikiRefIndex();
    idx.build([
      { path: "开始使用.md", content: "# t\n\n引用 [[第一篇]] 和 [[第一篇|别名]]" },
      { path: "tech/notes.md", content: "见 [[随笔/第一篇]] 两处:\n\n- [[随笔/第一篇]]\n- [[第一篇]]" },
    ]);
    // 裸名「第一篇」重名 → 解析到树序第一个「随笔/第一篇」(与点击跳转同构)
    const rows = idx.backlinks("随笔/第一篇.md", docs);
    expect(rows).toEqual([
      { source: "开始使用.md", count: 2, deleted: false },
      { source: "tech/notes.md", count: 3, deleted: false },
    ]);
    // tech/第一篇 只被路径写法指向,裸名不落它
    expect(idx.backlinks("tech/第一篇.md", docs)).toEqual([]);
  });

  it("路径写法精确匹配;未命中目标不计入任何文档", () => {
    const idx = new WikiRefIndex();
    idx.build([{ path: "a.md", content: "[[tech/notes]] [[不存在]] [[notes]]" }]);
    expect(idx.backlinks("tech/notes.md", docs)).toEqual([
      { source: "a.md", count: 2, deleted: false },
    ]);
  });

  it("回收站来源标记 deleted;恢复后从 trashOut 消失", () => {
    const idx = new WikiRefIndex();
    idx.build([{ path: "开始使用.md", content: "x" }]);
    idx.buildTrash([{ path: "tech/notes.md", content: "看 [[开始使用]]" }]);
    expect(idx.backlinks("开始使用.md", docs)).toEqual([
      { source: "tech/notes.md", count: 1, deleted: true },
    ]);
    idx.buildTrash([]);
    expect(idx.backlinks("开始使用.md", docs)).toEqual([]);
  });

  it("update/remove 随保存与删除增量维护", () => {
    const idx = new WikiRefIndex();
    idx.build([{ path: "a.md", content: "[[notes]]" }]);
    expect(idx.backlinks("tech/notes.md", docs)).toHaveLength(1);
    idx.update("a.md", "链接删了");
    expect(idx.backlinks("tech/notes.md", docs)).toHaveLength(0);
    idx.update("b.md", "[[notes]]");
    idx.remove("b.md");
    expect(idx.backlinks("tech/notes.md", docs)).toHaveLength(0);
  });
});
