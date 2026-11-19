import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { kbBackend } from "../backend";
import { WelcomePage } from "../WelcomePage";

describe("最近打开记录移除", () => {
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("移除最近知识库时清空 last 与所属 lastDoc", async () => {
    localStorage.setItem(
      "yz-mock-recent-v1",
      JSON.stringify({
        last: "/users/a",
        recent: ["/users/a", "/users/b"],
        lastDoc: "old.md",
      }),
    );

    await kbBackend.removeRecent("/users/a");

    expect(await kbBackend.getRecent()).toEqual({
      last: null,
      recent: ["/users/b"],
      lastDoc: null,
    });
  });

  it("移除最近 Markdown 记录不影响其它记录", async () => {
    localStorage.setItem(
      "yz-mock-single-recent-v1",
      JSON.stringify({ recent: ["/tmp/a.md", "/tmp/b.md"] }),
    );

    await kbBackend.removeRecentFile("/tmp/a.md");

    expect(await kbBackend.getRecentFiles()).toEqual({ recent: ["/tmp/b.md"] });
  });

  it("欢迎页卡片删除按钮只触发移除回调，不触发打开", async () => {
    const removedRoots: string[] = [];
    const removedFiles: string[] = [];
    const openedRoots: string[] = [];
    const openedFiles: string[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const props = {
      recent: ["/tmp/知识库"],
      recentFiles: ["/tmp/note.md"],
      bootError: null,
      onPickCreate: () => Promise.resolve(null),
      onForceCreate: () => Promise.resolve(null),
      onPickOpen: () => Promise.resolve(null),
      onOpenRecent: (root: string) => {
        openedRoots.push(root);
        return Promise.resolve(null);
      },
      onRemoveRecent: (root: string) => {
        removedRoots.push(root);
        return Promise.resolve(null);
      },
      onPickSingleFile: () => Promise.resolve(null),
      onOpenRecentFile: (path: string) => {
        openedFiles.push(path);
        return Promise.resolve(null);
      },
      onRemoveRecentFile: (path: string) => {
        removedFiles.push(path);
        return Promise.resolve(null);
      },
    };

    await act(async () => {
      root!.render(createElement(WelcomePage, props));
      await Promise.resolve();
    });

    const [deleteRoot, deleteFile] = [
      ...container.querySelectorAll<HTMLButtonElement>("button[aria-label^='删除最近记录：']"),
    ];
    expect(deleteRoot).toBeTruthy();
    expect(deleteFile).toBeTruthy();

    await act(async () => {
      deleteRoot.click();
      deleteFile.click();
      await Promise.resolve();
    });

    expect(removedRoots).toEqual(["/tmp/知识库"]);
    expect(removedFiles).toEqual(["/tmp/note.md"]);
    expect(openedRoots).toEqual([]);
    expect(openedFiles).toEqual([]);
  });
});
