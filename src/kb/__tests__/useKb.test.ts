import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { kbBackend } from "../backend";
import { useKb } from "../useKb";
import { DEFAULT_SETTINGS } from "../../settings";

/** 标题 Enter 改名会先于编辑器 300ms 去抖回调到达;useKb 必须先收稿再落盘改名。 */
describe("useKb 标题改名保存", () => {
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    localStorage.clear();
  });

  it("renameEntry 前冲刷编辑器注册的未去抖稿", async () => {
    let kb!: ReturnType<typeof useKb>;
    function Harness() {
      kb = useKb(DEFAULT_SETTINGS);
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(Harness));
      await Promise.resolve();
    });
    await act(async () => {
      await kb.openKbAt("/mock-kb");
    });
    await act(async () => {
      await kb.createDoc("", "未命名文档", "");
    });
    const oldPath = kb.currentPath;
    if (oldPath !== "未命名文档.md") throw new Error(`新建文档路径异常:${oldPath}`);

    act(() => {
      kb.setBeforeSwitch(() => kb.onMarkdownChange("刚输入的正文，还未到 300ms 去抖"));
    });
    await act(async () => {
      await kb.renameEntry(oldPath, "新名字");
    });

    expect(kb.currentPath).toBe("新名字.md");
    await expect(kbBackend.readDoc("/mock-kb", "新名字.md")).resolves.toBe(
      "刚输入的正文，还未到 300ms 去抖",
    );
  });

  it("改名联动后,已打开的引用文档切回时读到磁盘上的新链接", async () => {
    let kb!: ReturnType<typeof useKb>;
    function Harness() {
      kb = useKb(DEFAULT_SETTINGS);
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(createElement(Harness));
      await Promise.resolve();
    });
    await act(async () => {
      await kb.openKbAt("/mock-kb");
    });

    await act(async () => {
      await kb.createDoc("", "被引用", "");
    });
    await act(async () => {
      await kb.createDoc("", "引用者", "");
    });
    act(() => {
      kb.onMarkdownChange("看这里:[[被引用]]");
    });
    await act(async () => {
      await kb.flushSave();
    });
    await act(async () => {
      await kb.openDoc("被引用.md");
    });
    await act(async () => {
      await kb.renameEntry("被引用.md", "未命名文档2");
    });
    await expect(kbBackend.readDoc("/mock-kb", "引用者.md")).resolves.toBe(
      "看这里:[[未命名文档2]]",
    );

    // 引用者一直开在另一个 tab:切回去必须重新读盘,不能吃旧缓存。
    await act(async () => {
      await kb.openDoc("引用者.md");
    });
    expect(kb.markdown).toBe("看这里:[[未命名文档2]]");
  });
});
