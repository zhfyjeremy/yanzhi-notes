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
    expect(links.map((l) => [l.target, l.alias])).toEqual([
      ["开始使用", null],
      ["随笔/第一篇", "随手记"],
    ]);
    // label(6.3-1 面板高亮/定位用):别名优先
    expect(links.map((l) => l.label)).toEqual(["开始使用", "随手记"]);
  });

  it("目标原文保留首尾空格调平、空别名归 null", () => {
    const links = parseWikiOut("[[ a | ]]");
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("a");
    expect(links[0].alias).toBeNull();
  });

  it("普通文本/链接式图片不误报", () => {
    const links = parseWikiOut("[不是链接] ![图](a.png) [[a]]b]]");
    expect(links.map((l) => l.target)).toEqual(["a"]);
  });

  it("引用位置 = 所在标题路径(6.3-1);跨层级截断;文首为 null", () => {
    const links = parseWikiOut(
      [
        "开头文首引用 [[notes]]", // heading null
        "# 安装",
        "正文 [[notes]]",
        "## macOS",
        "细说 [[notes]]",
        "# 卸载",
        "再引 [[notes]]",
      ].join("\n"),
    );
    expect(links.map((l) => l.heading)).toEqual([
      null,
      "安装",
      "安装 / macOS",
      "卸载",
    ]);
  });

  it("代码围栏内的 # 不是标题(fence 门控 heading;链接仍计数,基础版语义)", () => {
    const links = parseWikiOut("# 真标题\n\n```md\n# 围栏内标题\n[[notes]]\n```\n\n[[notes]]");
    expect(links.map((l) => l.heading)).toEqual(["真标题", "真标题"]);
  });

  it("片段 = 引用所在行前后各 ~24 字,越界补省略号,含 [[…]] 原文", () => {
    const short = parseWikiOut("短句 [[notes]]")[0].snippet;
    expect(short).toBe("短句 [[notes]]"); // 行内不越界,无省略号
    const long = parseWikiOut(`${"前".repeat(40)}[[notes]]${"后".repeat(40)}`)[0].snippet;
    expect(long.startsWith("…")).toBe(true);
    expect(long.endsWith("…")).toBe(true);
    expect(long).toContain("[[notes]]");
    expect(long.length).toBeLessThan(40 + 8 + 40); // 两侧截断
  });
});

describe("WikiRefIndex.backlinks", () => {
  it("三种写法归一到同一目标;同源多引用展开多行;裸名重名取树序第一个", () => {
    const idx = new WikiRefIndex();
    idx.build([
      { path: "开始使用.md", content: "# t\n\n引用 [[第一篇]] 和 [[第一篇|别名]]" },
      { path: "tech/notes.md", content: "见 [[随笔/第一篇]] 两处:\n\n- [[随笔/第一篇]]\n- [[第一篇]]" },
    ]);
    // 裸名「第一篇」重名 → 解析到树序第一个「随笔/第一篇」(与点击跳转同构)
    const rows = idx.backlinks("随笔/第一篇.md", docs);
    expect(rows.map((r) => [r.source, r.label, r.heading])).toEqual([
      ["开始使用.md", "第一篇", "t"],
      ["开始使用.md", "别名", "t"],
      ["tech/notes.md", "随笔/第一篇", null],
      ["tech/notes.md", "随笔/第一篇", null],
      ["tech/notes.md", "第一篇", null],
    ]);
    // tech/第一篇 只被路径写法指向,裸名不落它
    expect(idx.backlinks("tech/第一篇.md", docs)).toEqual([]);
  });

  it("路径写法精确匹配;未命中目标不计入任何文档", () => {
    const idx = new WikiRefIndex();
    idx.build([{ path: "a.md", content: "[[tech/notes]] [[不存在]] [[notes]]" }]);
    const rows = idx.backlinks("tech/notes.md", docs);
    expect(rows.map((r) => r.source)).toEqual(["a.md", "a.md"]);
    expect(rows.every((r) => !r.deleted)).toBe(true);
  });

  it("回收站来源标记 deleted;恢复后从 trashOut 消失", () => {
    const idx = new WikiRefIndex();
    idx.build([{ path: "开始使用.md", content: "x" }]);
    idx.buildTrash([{ path: "tech/notes.md", content: "看 [[开始使用]]" }]);
    const rows = idx.backlinks("开始使用.md", docs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "tech/notes.md", deleted: true, label: "开始使用" });
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
