import { describe, expect, it } from "vitest";
import type { TreeNode } from "../types";
import {
  allTagsOf,
  applySiblingOrder,
  claimMetaKey,
  collapsedFolders,
  discardMetaKey,
  filterTreeByTag,
  findOrphanMeta,
  EMPTY_META,
  moveMetaToTail,
  nextSortIndex,
  parseMeta,
  removeMetaKeys,
  preserveOrderAfterRename,
  renameMetaKeys,
  rewriteTreePaths,
  serializeMeta,
  setCollapsed,
  setDocPinned,
  setDocTags,
  sortTree,
} from "../meta";

const doc = (path: string, name?: string): TreeNode => ({
  name: name ?? path.replace(/\.md$/, ""),
  path,
  isDir: false,
  children: [],
});
const dir = (path: string, children: TreeNode[]): TreeNode => ({
  name: path.split("/").pop()!,
  path,
  isDir: true,
  children,
});

describe("parseMeta 容错", () => {
  it("损坏 JSON → 空 meta", () => {
    expect(parseMeta("{oops")).toEqual(EMPTY_META);
  });
  it("缺失字段回默认", () => {
    expect(parseMeta('{"version":2}')).toEqual({ version: 2, docs: {}, folders: {} });
  });
  it("字段异型(数组/数字/字符串)回空对象,顶层非对象回空 meta", () => {
    expect(parseMeta('{"docs":[1,2],"folders":42}')).toEqual({ version: 1, docs: {}, folders: {} });
    expect(parseMeta('{"docs":"x"}')).toEqual({ version: 1, docs: {}, folders: {} });
    expect(parseMeta('"just a string"')).toEqual(EMPTY_META);
    expect(parseMeta("123")).toEqual(EMPTY_META);
  });
  it("往返 serialize 不丢", () => {
    const m = parseMeta('{"version":1,"docs":{"a.md":{"sortIndex":1}},"folders":{"a":{"collapsed":true}}}');
    expect(parseMeta(serializeMeta(m))).toEqual(m);
  });
});

describe("sortTree", () => {
  it("sortIndex 升序,无 meta 排后按名称", () => {
    const tree = [doc("c.md"), doc("a.md"), doc("b.md")];
    const meta = parseMeta('{"version":1,"docs":{"c.md":{"sortIndex":0},"a.md":{"sortIndex":1}},"folders":{}}');
    expect(sortTree(tree, meta).map((n) => n.path)).toEqual(["c.md", "a.md", "b.md"]);
  });
  it("递归到子层级", () => {
    const tree = [dir("f", [doc("f/z.md"), doc("f/y.md")])];
    const meta = parseMeta('{"version":1,"docs":{"f/z.md":{"sortIndex":0}},"folders":{}}');
    expect(sortTree(tree, meta)[0].children.map((n) => n.path)).toEqual(["f/z.md", "f/y.md"]);
  });
  it("置顶文档组内最上(6.3-3;文件夹不参与,置顶组内仍按 sortIndex/名称)", () => {
    const tree = [dir("f", []), doc("b.md"), doc("a.md"), doc("p2.md"), doc("p1.md")];
    const meta = parseMeta(
      '{"version":1,"docs":{"a.md":{"sortIndex":0},"b.md":{"sortIndex":1},"p1.md":{"pinned":true},"p2.md":{"pinned":true,"sortIndex":5}},"folders":{"f":{"sortIndex":0}}}',
    );
    // 置顶组:p2(有 sortIndex 5)在前 p1(无)在后;非置顶组 a/f/b 按 sortIndex+名称
    expect(sortTree(tree, meta).map((n) => n.path)).toEqual(["p2.md", "p1.md", "a.md", "f", "b.md"]);
  });
  it("置顶作用于各文件夹内部,不越级", () => {
    const tree = [dir("f", [doc("f/x.md"), doc("f/p.md")]), doc("root.md")];
    const meta = parseMeta('{"version":1,"docs":{"f/p.md":{"pinned":true}},"folders":{}}');
    const sorted = sortTree(tree, meta);
    expect(sorted.map((n) => n.path)).toEqual(["f", "root.md"]); // 根层不受子层置顶影响
    expect(sorted[0].children.map((n) => n.path)).toEqual(["f/p.md", "f/x.md"]);
  });
});

describe("置顶与标签纯函数(6.3-2/3)", () => {
  it("setDocPinned 幂等翻转,不动其它偏好", () => {
    const base = parseMeta('{"version":1,"docs":{"a.md":{"sortIndex":2,"tags":["x"]}},"folders":{}}');
    const on = setDocPinned(base, "a.md", true);
    expect(on.docs["a.md"]).toEqual({ sortIndex: 2, tags: ["x"], pinned: true });
    expect(setDocPinned(on, "a.md", true)).toBe(on); // 已同值 → 原引用
    expect(setDocPinned(on, "a.md", false).docs["a.md"]?.pinned).toBeUndefined();
  });
  it("setDocTags 去重去空白保序;空数组也落键", () => {
    const next = setDocTags(EMPTY_META, "a.md", [" 工作 ", "life", "工作", "", " "]);
    expect(next.docs["a.md"]?.tags).toEqual(["工作", "life"]);
    expect(setDocTags(next, "a.md", []).docs["a.md"]?.tags).toEqual([]);
  });
  it("allTagsOf 全库收集去重排序;filterTreeByTag 空文件夹隐藏", () => {
    const meta = parseMeta(
      '{"version":1,"docs":{"a.md":{"tags":["b标签","a标签"]},"f/c.md":{"tags":["a标签"]}},"folders":{}}',
    );
    expect(allTagsOf(meta)).toEqual(["a标签", "b标签"]);
    const tree = [doc("a.md"), dir("f", [doc("f/c.md"), doc("f/d.md")]), dir("空", [])];
    const tagged = new Set(["f/c.md"]);
    expect(filterTreeByTag(tree, tagged).map((n) => n.path)).toEqual(["f"]);
    expect(filterTreeByTag(tree, new Set(["a.md"])).map((n) => n.path)).toEqual(["a.md"]);
  });
});

describe("applySiblingOrder / nextSortIndex", () => {
  it("整组兄弟重写 0..n-1(docs 与 folders 分桶)", () => {
    const meta = applySiblingOrder(EMPTY_META, "f", ["f/b.md", "f/a", "f/c.md"]);
    expect(meta.docs["f/b.md"]?.sortIndex).toBe(0);
    expect(meta.folders["f/a"]?.sortIndex).toBe(1);
    expect(meta.docs["f/c.md"]?.sortIndex).toBe(2);
  });
  it("nextSortIndex = 最大 + 1,空组为 0", () => {
    const meta = parseMeta('{"version":1,"docs":{"a.md":{"sortIndex":4}},"folders":{"x":{"sortIndex":1}}}');
    expect(nextSortIndex(meta, [doc("a.md"), dir("x", [])])).toBe(5);
    expect(nextSortIndex(EMPTY_META, [])).toBe(0);
  });
  it("moveMetaToTail:目标组最大 + 1,旧组/别组索引不干扰", () => {
    // 目标组 f 内已有 sortIndex 0..2,移入条目旧组索引 9 不得污染(newRel 已是迁移后路径)
    const meta = parseMeta(
      '{"version":1,"docs":{"f/a.md":{"sortIndex":0},"f/b.md":{"sortIndex":2},"f/根.md":{"sortIndex":9}},"folders":{"f":{"sortIndex":1}}}',
    );
    const next = moveMetaToTail(meta, "f/根.md", "f");
    expect(next.docs["f/根.md"]?.sortIndex).toBe(3);
  });
  it("moveMetaToTail:移到根组与空组", () => {
    const meta = parseMeta('{"version":1,"docs":{"a.md":{"sortIndex":0}},"folders":{"g":{"sortIndex":7}}}');
    // 移到根:根组现只有 g(7),文档落 8;空组直接 0
    expect(moveMetaToTail(meta, "a.md", "").docs["a.md"]?.sortIndex).toBe(8);
    expect(moveMetaToTail(EMPTY_META, "x.md", "").docs["x.md"]?.sortIndex).toBe(0);
  });
});

describe("rename/remove keys", () => {
  it("文件夹改名前缀重写 docs/folders", () => {
    const meta = parseMeta(
      '{"version":1,"docs":{"f/a.md":{"sortIndex":0},"g/b.md":{"sortIndex":1}},"folders":{"f":{"sortIndex":0},"f/sub":{"collapsed":true}}}',
    );
    const next = renameMetaKeys(meta, "f", "h", true);
    expect(next.docs["h/a.md"]?.sortIndex).toBe(0);
    expect(next.docs["g/b.md"]?.sortIndex).toBe(1);
    expect(next.folders["h"]?.sortIndex).toBe(0);
    expect(next.folders["h/sub"]?.collapsed).toBe(true);
    expect(next.docs["f/a.md"]).toBeUndefined();
  });
  it("文档改名单键迁移", () => {
    const meta = parseMeta('{"version":1,"docs":{"a.md":{"sortIndex":2}},"folders":{}}');
    const next = renameMetaKeys(meta, "a.md", "b.md", false);
    expect(next.docs["b.md"]?.sortIndex).toBe(2);
    expect(next.docs["a.md"]).toBeUndefined();
  });
  it("改名后保持同级视觉序(即使原先无 sortIndex)", () => {
    const siblings = [doc("c.md"), doc("a.md"), doc("b.md")];
    const next = preserveOrderAfterRename(EMPTY_META, siblings, "a.md", "z.md");
    const tree = sortTree(siblings.map((n) => (n.path === "a.md" ? doc("z.md") : n)), next);
    expect(tree.map((n) => n.path)).toEqual(["c.md", "z.md", "b.md"]);
  });
  it("rewriteTreePaths 同步 path/name", () => {
    const tree = [dir("f", [doc("f/a.md")]), doc("b.md")];
    const next = rewriteTreePaths(tree, "f/a.md", "f/z.md");
    expect(next[0].children[0]).toMatchObject({ path: "f/z.md", name: "z" });
    expect(rewriteTreePaths(tree, "f", "g")[0]).toMatchObject({ path: "g", name: "g" });
    expect(rewriteTreePaths(tree, "f", "g")[0].children[0].path).toBe("g/a.md");
  });
  it("删除文件夹清整棵子树 key", () => {
    const meta = parseMeta(
      '{"version":1,"docs":{"f/a.md":{},"f/s/b.md":{},"c.md":{}},"folders":{"f":{},"f/s":{}}}',
    );
    const next = removeMetaKeys(meta, "f", true);
    expect(Object.keys(next.docs)).toEqual(["c.md"]);
    expect(Object.keys(next.folders)).toEqual([]);
  });
});

describe("折叠持久化", () => {
  it("setCollapsed / collapsedFolders 往返", () => {
    const meta = setCollapsed(setCollapsed(EMPTY_META, "f", true), "g", false);
    expect(collapsedFolders(meta)).toEqual(new Set(["f"]));
  });
});

describe("未识别条目(5.2.1)", () => {
  const tree: TreeNode[] = [
    { name: "开始使用.md", path: "开始使用.md", isDir: false, children: [] },
    {
      name: "tech",
      path: "tech",
      isDir: true,
      children: [
        { name: "notes.md", path: "tech/notes.md", isDir: false, children: [] },
        { name: "sub",
          path: "tech/sub",
          isDir: true,
          children: [] },
      ],
    },
  ];
  it("findOrphanMeta:外部改名后的失联文档/文件夹/子树各成条目,命中项不报", () => {
    const meta = parseMeta(
      '{"version":1,"docs":{"随笔/第一篇.md":{"sortIndex":0},"tech/notes.md":{"sortIndex":1}},'
        + '"folders":{"随笔":{"sortIndex":0,"collapsed":true},"tech":{"sortIndex":1}}}',
    );
    expect(findOrphanMeta(meta, tree)).toEqual([
      { path: "随笔", isDir: true, meta: { sortIndex: 0, collapsed: true } },
      { path: "随笔/第一篇.md", isDir: false, meta: { sortIndex: 0 } },
    ]);
  });
  it("claimMetaKey:偏好转移到同类型真实路径并清旧 key;目标已有字段被失联值覆盖", () => {
    const meta = parseMeta(
      '{"version":1,"docs":{"旧.md":{"sortIndex":5},"新.md":{"sortIndex":1,"pinned":true}},"folders":{}}',
    );
    const next = claimMetaKey(meta, "旧.md", "新.md", false);
    expect(next.docs["新.md"]).toEqual({ sortIndex: 5, pinned: true });
    expect(next.docs["旧.md"]).toBeUndefined();
  });
  it("claimMetaKey:文件夹互认,文档/文件夹 record 不串", () => {
    const meta = parseMeta('{"version":1,"docs":{},"folders":{"旧":{"sortIndex":2},"新":{}}}');
    const next = claimMetaKey(meta, "旧", "新", true);
    expect(next.folders["新"]?.sortIndex).toBe(2);
    expect(next.folders["旧"]).toBeUndefined();
  });
  it("discardMetaKey:仅清单条(逐条语义,不级联子树)", () => {
    const meta = parseMeta(
      '{"version":1,"docs":{"随笔/a.md":{}},"folders":{"随笔":{}}}',
    );
    const next = discardMetaKey(meta, "随笔", true);
    expect(next.folders["随笔"]).toBeUndefined();
    expect(next.docs["随笔/a.md"]).toBeDefined();
  });
});
