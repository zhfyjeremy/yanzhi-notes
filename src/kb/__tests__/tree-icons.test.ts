import { describe, expect, it } from "vitest";
import { TREE_ICON_GROUPS, TREE_ICONS, treeIconComponent } from "../tree-icons";

describe("目录树内置图标库", () => {
  it("图标 ID 唯一且都归属已知分组", () => {
    const ids = TREE_ICONS.map((icon) => icon.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups: Set<string> = new Set(TREE_ICON_GROUPS);
    for (const icon of TREE_ICONS) expect(groups.has(icon.group)).toBe(true);
  });

  it("每个分组都有图标,并包含彩色分组", () => {
    for (const group of TREE_ICON_GROUPS) {
      expect(TREE_ICONS.some((icon) => icon.group === group)).toBe(true);
    }
    expect(TREE_ICONS.filter((icon) => icon.group === "彩色").length).toBeGreaterThanOrEqual(40);
    expect(TREE_ICONS.filter((icon) => icon.group === "彩色面性").length).toBeGreaterThanOrEqual(24);
  });

  it("未知 ID 回退默认", () => {
    expect(treeIconComponent("not-exists")).toBeNull();
    expect(treeIconComponent(null)).toBeNull();
  });
});
