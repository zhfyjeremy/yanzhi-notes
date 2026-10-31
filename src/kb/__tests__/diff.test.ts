import { describe, expect, it } from "vitest";
import { diffLines } from "../diff";

const shape = (oldText: string, newText: string) =>
  diffLines(oldText, newText).map((r) => `${r.type[0]}:${r.text}`);

describe("diffLines 行级 diff(6.2 快照对比)", () => {
  it("完全相同 → 全上下文行", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");
    expect(rows.every((r) => r.type === "ctx")).toBe(true);
    expect(rows.map((r) => r.text)).toEqual(["a", "b", "c"]);
  });

  it("中间插入一行 → 单条 add,前后是 ctx", () => {
    expect(shape("a\nc", "a\nb\nc")).toEqual(["c:a", "a:b", "c:c"]);
  });

  it("删除一行 → 单条 del", () => {
    expect(shape("a\nb\nc", "a\nc")).toEqual(["c:a", "d:b", "c:c"]);
  });

  it("修改一行 → del+add 相邻", () => {
    expect(shape("标题\n旧内容", "标题\n新内容")).toEqual(["c:标题", "d:旧内容", "a:新内容"]);
  });

  it("空 ↔ 有内容", () => {
    expect(shape("", "x")).toEqual(["a:x"]);
    expect(shape("x", "")).toEqual(["d:x"]);
    // split("\n") 的空串 → [""] 空行:diff("") 与 diff("") 全 ctx 不产生增删
    expect(diffLines("", "").every((r) => r.type === "ctx")).toBe(true);
  });

  it("首尾公共段裁剪后只对中段做 LCS(大文档局部编辑)", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `第${i}行`).join("\n");
    const edited = big.replace("第1000行", "第一千行(改)");
    const rows = diffLines(big, edited);
    const changed = rows.filter((r) => r.type !== "ctx");
    expect(changed.map((r) => `${r.type[0]}:${r.text}`)).toEqual(["d:第1000行", "a:第一千行(改)"]);
    expect(rows.length).toBe(2001); // 上下文不被裁掉,行数守恒
  });

  it("超规模兜底:中段整删+整加,不追最优脚本", () => {
    const a = Array.from({ length: 1500 }, (_, i) => `L${i}`);
    const b = Array.from({ length: 1500 }, (_, i) => `R${i}`);
    const rows = diffLines(a.join("\n"), b.join("\n"));
    expect(rows.filter((r) => r.type === "del").length).toBe(1500);
    expect(rows.filter((r) => r.type === "add").length).toBe(1500);
  });
});
