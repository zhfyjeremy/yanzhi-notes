import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { WorkspaceLoading } from "../WorkspaceLoading";

describe("知识库装载态", () => {
  const roots: Root[] = [];

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()!;
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
  });

  it("不渲染未命名文档输入,只显示目录/文档恢复状态", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => {
      root.render(createElement(WorkspaceLoading));
    });

    const status = container.querySelector<HTMLElement>("[role='status']");
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.textContent).toContain("正在打开知识库");
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector(".yz-editor-doc")).toBeNull();
  });
});
