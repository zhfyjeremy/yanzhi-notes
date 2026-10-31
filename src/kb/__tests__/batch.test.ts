import { describe, expect, it } from "vitest";
import { minimalRestoreRoots, parseBatchTags, planBatchRename } from "../batch";
import type { TreeNode } from "../types";

const tree: TreeNode[] = [
  {
    name: "项目",
    path: "项目",
    isDir: true,
    children: [
      { name: "周报", path: "项目/周报.md", isDir: false, children: [] },
      { name: "已存在", path: "项目/已存在.md", isDir: false, children: [] },
    ],
  },
];

describe("V3 批量文档操作", () => {
  it("批量改名支持查找替换、前后缀和非法字符过滤", () => {
    const plan = planBatchRename(["项目/周报.md"], tree, {
      find: "周",
      replace: "月",
      prefix: "2026-",
      suffix: "?",
    });
    expect(plan.errors).toEqual([]);
    expect(plan.items[0]).toMatchObject({ newName: "2026-月报", newRel: "项目/2026-月报.md" });
  });

  it("目标重名、结果为空时阻止执行", () => {
    const conflict = planBatchRename(["项目/周报.md"], tree, {
      find: "周报",
      replace: "已存在",
      prefix: "",
      suffix: "",
    });
    expect(conflict.errors[0]).toContain("已存在");
    const empty = planBatchRename(["项目/周报.md"], tree, {
      find: "周报",
      replace: "",
      prefix: "",
      suffix: "",
    });
    expect(empty.errors[0]).toContain("为空");
  });

  it("批量标签输入去空、去重并支持中英文分隔符", () => {
    expect(parseBatchTags("项目, 待读；项目\n重点")).toEqual(["项目", "待读", "重点"]);
  });

  it("回收站父子项都选中时,执行层只恢复最上层路径", () => {
    expect(
      minimalRestoreRoots(["新文件夹", "新文件夹/未命名文档.md", "另一篇.md"]),
    ).toEqual(["新文件夹", "另一篇.md"]);
  });
});
