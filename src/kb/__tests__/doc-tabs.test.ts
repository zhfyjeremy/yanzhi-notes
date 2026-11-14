import { describe, expect, it } from "vitest";
import {
  closeOtherTabs,
  closeTab,
  closeTabsToLeft,
  closeTabsToRight,
  openInTabs,
  parseWorkspace,
  pruneTabs,
  reorderTabs,
  restoreTabs,
  rewriteTabPaths,
  workspaceOf,
} from "../doc-tabs";

const setup = () => restoreTabs(["a.md", "b.md", "c.md"], "b.md");

describe("doc tabs", () => {
  it("解析 workspace:去重并只接受存在的 activePath", () => {
    expect(parseWorkspace('{"version":1,"tabs":["a.md","a.md","b.md"],"activePath":"b.md"}')).toEqual({
      tabs: ["a.md", "b.md"],
      activePath: "b.md",
    });
    expect(parseWorkspace('{"tabs":"bad"}')).toBeNull();
    expect(parseWorkspace("not-json")).toBeNull();
  });

  it("打开文档:已有路径激活并记后退;新路径追加带历史;current 模式写入当前 tab 历史", () => {
    const initial = setup();
    // b → a:激活已有 a,并把 b 记进 a 的后退栈
    const toA = openInTabs(initial.tabs, initial.activeId, "a.md");
    expect(toA.activeId).toBe(initial.tabs[0].id);
    expect(toA.changed).toBe(true);
    expect(toA.tabs[0]).toMatchObject({ path: "a.md", back: ["b.md"], front: [] });

    const opened = openInTabs(initial.tabs, initial.activeId, "d.md");
    expect(opened.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md", "c.md", "d.md"]);
    expect(opened.activeId).toBe(opened.tabs[3].id);
    expect(opened.tabs[3]).toMatchObject({ path: "d.md", back: ["b.md"], front: [] });

    const current = openInTabs(initial.tabs, initial.activeId, "d.md", "current");
    expect(current.tabs[1]).toMatchObject({ path: "d.md", back: ["b.md"], front: [] });
    expect(current.activeId).toBe(initial.activeId);
  });

  it("关闭标签:当前 tab 先右后左;关闭其他/右侧保留正确激活项", () => {
    const state = setup();
    const closed = closeTab(state.tabs, state.activeId, "restore:b.md");
    expect(closed.tabs.map((tab) => tab.path)).toEqual(["a.md", "c.md"]);
    expect(closed.activeId).toBe("restore:c.md");

    const onlyA = closeOtherTabs(state.tabs, "restore:a.md");
    expect(onlyA.tabs.map((tab) => tab.path)).toEqual(["a.md"]);
    expect(onlyA.activeId).toBe("restore:a.md");

    const rightClosed = closeTabsToRight(state.tabs, "restore:c.md", "restore:a.md");
    expect(rightClosed.tabs.map((tab) => tab.path)).toEqual(["a.md"]);
    expect(rightClosed.activeId).toBe("restore:a.md");

    const leftClosedFromEnd = closeTabsToLeft(state.tabs, state.activeId, "restore:c.md");
    expect(leftClosedFromEnd.tabs.map((tab) => tab.path)).toEqual(["c.md"]);
    expect(leftClosedFromEnd.activeId).toBe("restore:c.md");

    const leftClosedFromStart = closeTabsToLeft(state.tabs, state.activeId, "restore:a.md");
    expect(leftClosedFromStart.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(leftClosedFromStart.activeId).toBe(state.activeId);
  });

  it("重排、路径重写与失效清理", () => {
    const state = setup();
    const reordered = reorderTabs(state.tabs, state.activeId, 2, 0);
    expect(reordered.tabs.map((tab) => tab.path)).toEqual(["c.md", "a.md", "b.md"]);

    const moved = rewriteTabPaths(state.tabs, state.activeId, "a.md", "x/y.md");
    expect(moved.tabs[0].path).toBe("x/y.md");
    expect(moved.activeId).toBe(state.activeId);

    const pruned = pruneTabs(state.tabs, state.activeId, new Set(["a.md", "c.md"]));
    expect(pruned.tabs.map((tab) => tab.path)).toEqual(["a.md", "c.md"]);
    expect(pruned.activeId).toBe("restore:c.md");
  });

  it("workspace 输出只保存路径顺序与 activePath", () => {
    const state = setup();
    expect(workspaceOf(state.tabs, state.activeId)).toEqual({
      version: 1,
      tabs: ["a.md", "b.md", "c.md"],
      activePath: "b.md",
    });
  });
});
