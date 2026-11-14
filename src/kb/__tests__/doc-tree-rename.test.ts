import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { DocTree } from "../DocTree";
import type { TreeNode } from "../types";

/** 新建文档后的树交互:展开折叠父夹并高亮当前文档,不自动进入重命名。 */
const tree: TreeNode[] = [
  {
    path: "文件夹",
    name: "文件夹",
    isDir: true,
    children: [
      { path: "文件夹/未命名文档.md", name: "未命名文档.md", isDir: false, children: [] },
    ],
  },
];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => undefined;
});

function treeProps(collapsed: Set<string>, iconMap = new Map<string, string>()) {
  return {
        root: "/tmp/kb",
        tree,
        currentPath: "文件夹/未命名文档.md",
        indexReady: true,
        onToggleCollapse: () => undefined,
        onSetAllCollapsed: () => undefined,
        iconMap,
        onSetEntryIcon: () => undefined,
        onOpenDoc: () => undefined,
        onRevealEntry: () => undefined,
        onCreateDoc: () => undefined,
        onCreateFolder: async () => null,
        onRenameEntry: () => undefined,
        onRemoveEntry: () => undefined,
        onReorder: () => undefined,
        onMoveEntry: () => undefined,
        onSearch: () => [],
        onSearchSelect: () => undefined,
        recentDocs: [],
        canCopyWikiRef: () => true,
        onCopyWikiRef: () => undefined,
        onRebuildIndex: () => undefined,
        onOpenTrash: () => undefined,
        onOpenMarkdownFile: () => undefined,
        onBackHome: () => undefined,
        onOpenOtherKb: () => undefined,
        onCreateKb: () => undefined,
        trashCount: 0,
        orphanCount: 0,
        onOpenOrphans: () => undefined,
        pinnedSet: new Set<string>(),
        onTogglePin: () => undefined,
        allTags: [],
        tagCounts: {},
        tagFilter: null,
        onTagFilter: () => undefined,
        onBatchMove: async () => ({ ok: 0, failed: 0, errors: [] }),
        onBatchSetTags: async () => ({ ok: 0, failed: 0, errors: [] }),
        onBatchRename: async () => ({ ok: 0, failed: 0, errors: [] }),
        onBatchTrash: async () => ({ ok: 0, failed: 0, errors: [] }),
    onToast: () => undefined,
    collapsed,
  };
}

function renderDocTree(
  collapsed: Set<string> = new Set<string>(),
  iconMap: Map<string, string> = new Map<string, string>(),
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(createElement(DocTree, treeProps(collapsed, iconMap)));
  });
  return { container, root };
}

describe("新建文档后的目录树选中状态", () => {
  const roots: Root[] = [];
  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()!;
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
  });

  it("展开折叠父夹后当前文档高亮且不进入重命名", async () => {
    const rendered = renderDocTree(new Set<string>(["文件夹"]));
    roots.push(rendered.root);
    expect(
      rendered.container.querySelector('[data-path="文件夹/未命名文档.md"] input'),
    ).toBeNull();

    act(() => rendered.root.render(createElement(DocTree, treeProps(new Set<string>()))));
    await act(async () => {});
    const row = rendered.container.querySelector<HTMLElement>(
      '[data-path="文件夹/未命名文档.md"]',
    );
    expect(row?.className).toContain("chrome-tree-row-active");
    expect(row?.querySelector("input")).toBeNull();
  });

  it("meta 图标偏好驱动目录树渲染,未知 ID 回退默认", () => {
    const icons = new Map<string, string>([
      ["文件夹", "code"],
      ["文件夹/未命名文档.md", "plane"],
      ["未知.md", "not-exists"],
    ]);
    const rendered = renderDocTree(new Set<string>(), icons);
    roots.push(rendered.root);
    expect(rendered.container.querySelector('[data-tree-icon="code"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-tree-icon="plane"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-tree-icon="not-exists"]')).toBeNull();
  });

});
