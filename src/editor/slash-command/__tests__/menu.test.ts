import { describe, expect, it } from "vitest";
import { COMMANDS, buildSlashMenuNodes } from "../index";
import {
  flattenSlashMenuNodes,
  type SlashCommandDef,
  type SlashSubmenuDef,
} from "../SlashMenu";

function submenu(nodes: ReturnType<typeof buildSlashMenuNodes>, id: string) {
  const node = nodes.find(
    (item): item is { kind: "submenu" } & SlashSubmenuDef =>
      item.kind === "submenu" && item.id === id,
  );
  expect(node).toBeDefined();
  return node!;
}

describe("斜杠菜单二级分组", () => {
  it("无搜索时把标题、日期时间、提示块、AI 收进二级菜单", () => {
    const nodes = buildSlashMenuNodes(COMMANDS, "");

    expect(submenu(nodes, "heading").children).toHaveLength(6);
    expect(submenu(nodes, "date-time").children).toHaveLength(6);
    expect(submenu(nodes, "callout").children.map((item) => item.label)).toEqual([
      "信息提示",
      "成功提示",
      "警告提示",
      "注意提示",
    ]);
    expect(submenu(nodes, "ai").children.length).toBeGreaterThan(0);
    expect(nodes.some((node) => node.kind === "item" && node.item.label === "标题 1")).toBe(false);
    // 键盘上下键的根层序列必须包含 submenu 父项,不能只包含叶子命令
    expect(
      flattenSlashMenuNodes(nodes).some(
        (node) => node.kind === "submenu" && node.id === "heading",
      ),
    ).toBe(true);
  });

  it("有搜索时保留叶子命令平铺,熟手路径仍一步执行", () => {
    const h1 = COMMANDS.find((item) => item.label === "标题 1") as SlashCommandDef;
    const nodes = buildSlashMenuNodes([h1], "h1");
    expect(nodes).toEqual([{ kind: "item", item: h1 }]);
  });
});
