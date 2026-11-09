import { describe, expect, it } from "vitest";
import { folderBreadcrumbs } from "../breadcrumb";

describe("folderBreadcrumbs", () => {
  it("根目录文档不产生文件夹段", () => {
    expect(folderBreadcrumbs("开始使用.md")).toEqual([]);
  });

  it("逐级累积 POSIX 路径", () => {
    expect(folderBreadcrumbs("项目/2026/Q4/复盘.md")).toEqual([
      { label: "项目", path: "项目" },
      { label: "2026", path: "项目/2026" },
      { label: "Q4", path: "项目/2026/Q4" },
    ]);
  });

  it("兼容尾部与反斜杠输入", () => {
    expect(folderBreadcrumbs("资料\\索引.md/")).toEqual([{ label: "资料", path: "资料" }]);
  });
});
