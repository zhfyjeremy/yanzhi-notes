import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocTree } from "../DocTree";
import type { TreeNode } from "../types";

/**
 * 拖拽 FLIP 的关键回归:落点不变时不得重渲染。
 * 曾经 computeHint 每次 dragover 都返回新对象 → setDropHint 每帧触发 → layout effect
 * 每帧 cancel 上一轮动画 → 动画永远播不完(用户看到的是瞬移)。
 */
const tree: TreeNode[] = [
  { path: "a.md", name: "a.md", isDir: false, children: [] },
  { path: "b.md", name: "b.md", isDir: false, children: [] },
  { path: "c.md", name: "c.md", isDir: false, children: [] },
];

let container: HTMLDivElement;
let root: Root;
let animateMock: ReturnType<typeof vi.fn>;
let cancelCount = 0;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => undefined;
  cancelCount = 0;
  animateMock = vi.fn();
  (Element.prototype as unknown as { animate: unknown }).animate = animateMock;
  animateMock.mockImplementation(() => ({ cancel: () => void cancelCount++ }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  vi.restoreAllMocks();
});

/** 按 DOM 顺序给每行 32px,模拟真实布局(预览增删行后顺序变化 → 位置变化) */
function mockLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    // 必须在挂载前装:挂载那一轮记录的基线要就是真实布局,否则会凭空多出动画
    if (this.tagName === "NAV") {
      return { top: 0, height: 300, bottom: 300, left: 0, right: 300, width: 300, x: 0, y: 0 } as DOMRect;
    }
    const rows = Array.from(container.querySelectorAll("[data-path]"));
    const index = rows.indexOf(this as HTMLElement);
    const top = index < 0 ? 0 : index * 32;
    return { top, height: 32, bottom: top + 32, left: 0, right: 300, width: 300, x: 0, y: top } as DOMRect;
  });
}

function fireDrag(el: Element, type: string, clientY?: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY }) as MouseEvent & {
    dataTransfer?: DataTransfer;
  };
  event.dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData: () => undefined,
    getData: () => "",
  } as unknown as DataTransfer;
  act(() => {
    el.dispatchEvent(event);
  });
}

function renderDocTree() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <DocTree
        root="/tmp/kb"
        tree={tree}
        currentPath={null}
        collapsed={new Set<string>()}
        indexReady={true}
        onToggleCollapse={() => undefined}
        onSetAllCollapsed={() => undefined}
        iconMap={new Map<string, string>()}
        onSetEntryIcon={() => undefined}
        onOpenDoc={() => undefined}
        onRevealEntry={() => undefined}
        onCreateDoc={() => undefined}
        onCreateFolder={async () => null}
        onRenameEntry={() => undefined}
        onRemoveEntry={() => undefined}
        onReorder={() => undefined}
        onMoveEntry={() => undefined}
        onSearch={() => []}
        onSearchSelect={() => undefined}
        recentDocs={[]}
        canCopyWikiRef={() => true}
        onCopyWikiRef={() => undefined}
        onRebuildIndex={() => undefined}
        onOpenTrash={() => undefined}
        onOpenMarkdownFile={() => undefined}
        onBackHome={() => undefined}
        onOpenOtherKb={() => undefined}
        onCreateKb={() => undefined}
        onCopyRootPath={() => undefined}
        trashCount={0}
        orphanCount={0}
        onOpenOrphans={() => undefined}
        pinnedSet={new Set<string>()}
        onTogglePin={() => undefined}
        allTags={[]}
        tagCounts={{}}
        tagFilter={null}
        onTagFilter={() => undefined}
        onBatchMove={async () => ({ ok: 0, failed: 0, errors: [] })}
        onBatchSetTags={async () => ({ ok: 0, failed: 0, errors: [] })}
        onBatchRename={async () => ({ ok: 0, failed: 0, errors: [] })}
        onBatchTrash={async () => ({ ok: 0, failed: 0, errors: [] })}
        onToast={() => undefined}
      />,
    );
  });
}

describe("目录树拖拽 FLIP", () => {
  it("落点变化时播放让位动画;同一落点内连续 dragover 不重渲染、不打断动画", () => {
    mockLayout();
    renderDocTree();
    const nav = container.querySelector("nav")!;
    const rowA = container.querySelector('[data-path="a.md"]')!;

    // 拖起 a(此时仍是原始布局)
    fireDrag(rowA, "dragstart");
    expect(container.querySelector('[data-path="a.md"]')).toBeTruthy();

    // 落到 c 的上半 → before c;预览:b 上移到 a 的位置,槽插在 c 前
    fireDrag(nav, "dragover", 70);
    expect(container.querySelector('[data-path="__yz-drop-slot__"]')).toBeTruthy();
    expect(container.querySelector('[data-path="a.md"]')).toBeNull();
    expect(animateMock).toHaveBeenCalled();
    const callsAfterFirstDrop = animateMock.mock.calls.length;
    expect(callsAfterFirstDrop).toBeGreaterThan(0);
    // 首次动画不该被取消
    expect(cancelCount).toBe(0);

    // 同一落点内继续 dragover(指针微动)→ 不得再触发动画,也不得取消上一轮
    fireDrag(nav, "dragover", 75);
    fireDrag(nav, "dragover", 78);
    expect(animateMock.mock.calls.length).toBe(callsAfterFirstDrop);
    expect(cancelCount).toBe(0);
  });
});
