import { describe, expect, it } from "vitest";
import { dropHintAt, type DragRowRect } from "../DocTree";

/** 三行:文档 32px、目录 36px、文档 32px(与 chrome-tree-row 的 min-h-8/min-h-9 对齐) */
const rows: DragRowRect[] = [
  { path: "a.md", top: 0, height: 32, isDir: false },
  { path: "dir", top: 32, height: 36, isDir: true },
  { path: "b.md", top: 68, height: 32, isDir: false },
];

describe("目录树拖拽落点判定(几何来自拖起时的快照)", () => {
  it("文档行:上半 before、下半 after", () => {
    expect(dropHintAt(rows, 5)).toEqual({ path: "a.md", zone: "before" });
    expect(dropHintAt(rows, 27)).toEqual({ path: "a.md", zone: "after" });
  });

  it("目录行:上 1/4 before、中段 into、下 1/4 after", () => {
    expect(dropHintAt(rows, 36)).toEqual({ path: "dir", zone: "before" });
    expect(dropHintAt(rows, 50)).toEqual({ path: "dir", zone: "into" });
    expect(dropHintAt(rows, 66)).toEqual({ path: "dir", zone: "after" });
  });

  it("首行之上 = before 首行;末行之下 = after 末行", () => {
    expect(dropHintAt(rows, -20)).toEqual({ path: "a.md", zone: "before" });
    expect(dropHintAt(rows, 500)).toEqual({ path: "b.md", zone: "after" });
  });

  it("空列表无落点", () => {
    expect(dropHintAt([], 10)).toBeNull();
  });

  /**
   * 不抖的根基:预览只「移除被拖行 + 插入等高占位槽」,两者都不参与判定;
   * 因此同一段指针区间,在原始布局与预览布局下算出的落点必须一致。
   */
  it("同一指针位置在「移除被拖行 + 插入等高槽」前后判定一致", () => {
    // 原始:dir(被拖,32-68) b(68-100);快照排除 dir 后 b 仍在 68
    const snapshot: DragRowRect[] = [
      { path: "a.md", top: 0, height: 32, isDir: false },
      { path: "dir", top: 32, height: 36, isDir: true },
      { path: "b.md", top: 68, height: 32, isDir: false },
    ];
    const dragged = "dir";
    const excluded = snapshot.filter((row) => row.path !== dragged);
    // 指针在 b 上半(原始 68-84)
    const before = dropHintAt(excluded, 76);
    // 预览布局:dir 移除后 b 上移到 32,再在 b 前插入 36px 槽 → b 回到 68
    const preview: DragRowRect[] = [
      { path: "a.md", top: 0, height: 32, isDir: false },
      { path: "b.md", top: 68, height: 32, isDir: false },
    ];
    expect(dropHintAt(preview, 76)).toEqual(before);
  });
});
