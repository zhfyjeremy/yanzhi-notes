import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { kbBackend } from "../backend";
import { useSingleFile } from "../useSingleFile";

/**
 * 未命名缓冲区(docs/single-file-mode.md):新建即可写,保存时再选存储位置;
 * 关闭/切换时与普通单文件一样询问未保存修改。browser mock 的 saveSingleFileAs
 * 返回 /mock-single/<默认名>,足以覆盖「无路径 → saveAs → 有路径」的状态迁移。
 */
describe("useSingleFile 未命名缓冲区", () => {
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

  async function mount() {
    let single!: ReturnType<typeof useSingleFile>;
    function Harness() {
      single = useSingleFile();
      return null;
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(createElement(Harness));
      await Promise.resolve();
    });
    return () => single;
  }

  it("新建未命名:立即进入单文件态、无路径、空内容、不算脏", async () => {
    const get = await mount();
    expect(get().active).toBe(false);
    await act(async () => {
      await get().newUntitled();
    });
    const s = get();
    expect(s.active).toBe(true);
    expect(s.untitled).toBe(true);
    expect(s.filePath).toBeNull();
    expect(s.markdown).toBe("");
    expect(s.dirty).toBe(false);
    expect(s.saveState).toBe("saved");
  });

  it("未命名保存 = 选位置落盘:之后有路径、内容已写、不再脏、仍在单文件态", async () => {
    const get = await mount();
    await act(async () => {
      await get().newUntitled();
    });
    act(() => {
      get().onMarkdownChange("# 随手记\n\n先写下来,回头再决定放哪。");
    });
    expect(get().dirty).toBe(true);
    await act(async () => {
      await expect(get().save()).resolves.toBe(true);
    });
    const s = get();
    expect(s.filePath).toBe("/mock-single/未命名.md");
    expect(s.untitled).toBe(false);
    expect(s.active).toBe(true);
    expect(s.dirty).toBe(false);
    expect(s.saveState).toBe("saved");
    await expect(kbBackend.readSingleFile("/mock-single/未命名.md")).resolves.toBe(
      "# 随手记\n\n先写下来,回头再决定放哪。",
    );
  });

  it("已有文件时新建未命名:旧文件让位,内容清空且无路径", async () => {
    const get = await mount();
    await act(async () => {
      // mock 的 writeSingleFile 只允许写回已存在的文件,新建走 saveSingleFileAs
      const oldPath = await kbBackend.saveSingleFileAs("旧.md", "旧内容");
      await get().openFile(oldPath ?? "");
    });
    expect(get().filePath).toBe("/mock-single/旧.md");
    expect(get().markdown).toBe("旧内容");
    await act(async () => {
      await get().newUntitled();
    });
    const s = get();
    expect(s.active).toBe(true);
    expect(s.untitled).toBe(true);
    expect(s.filePath).toBeNull();
    expect(s.markdown).toBe("");
  });

  it("未命名可直接插图:资源先落缓存锚点,保存后迁到「<文件名>.assets/」且正文引用改写", async () => {
    const get = await mount();
    await act(async () => {
      await get().newUntitled();
    });
    const shellBase = get().assetBasePath;
    expect(shellBase).toMatch(/^\/mock-cache\/dropped-md\//);

    const file = new File([new Uint8Array([1, 2, 3, 4])], "shot.png", { type: "image/png" });
    let srcs: string[] = [];
    await act(async () => {
      srcs = await get().saveImageFiles([file]);
    });
    expect(srcs).toHaveLength(1);
    // 可读名:原始名-短哈希,目录是锚点文件同名的 .assets
    expect(srcs[0]).toMatch(/^\.\/[^/]+\.assets\/shot-[0-9a-f]{8}\.png$/);
    await expect(get().readAssetBase64(srcs[0])).resolves.toMatchObject({ mime: "image/png" });

    act(() => {
      get().onMarkdownChange(`# 紧急记录\n\n![截图](${srcs[0]})`);
    });
    await act(async () => {
      await expect(get().save()).resolves.toBe(true);
    });
    const s = get();
    expect(s.filePath).toBe("/mock-single/未命名.md");
    expect(s.assetBasePath).toBe("/mock-single/未命名.md");
    const shortHash = /-(?<h>[0-9a-f]{8})\.png$/.exec(srcs[0])![1];
    const newSrc = `./未命名.assets/shot-${shortHash}.png`;
    // 磁盘上的正文已改写到新目录;编辑器里的旧引用按映射仍可读图
    await expect(kbBackend.readSingleFile(s.filePath!)).resolves.toBe(`# 紧急记录\n\n![截图](${newSrc})`);
    expect(s.getMarkdownNow()).toContain(newSrc);
    await expect(s.readAssetBase64(newSrc)).resolves.toMatchObject({ mime: "image/png" });
    await expect(s.readAssetBase64(srcs[0])).resolves.toMatchObject({ mime: "image/png" });
  });

  it("另存为换名:资源迁到「<新名>.assets/」,旧文件与旧目录不受影响", async () => {
    const get = await mount();
    await act(async () => {
      await get().newUntitled();
    });
    const file = new File([new Uint8Array([9, 9, 9])], "a.png", { type: "image/png" });
    let srcs: string[] = [];
    await act(async () => {
      srcs = await get().saveImageFiles([file]);
    });
    act(() => {
      get().onMarkdownChange(`![a](${srcs[0]})`);
    });
    await act(async () => {
      await expect(get().save()).resolves.toBe(true);
    });
    const first = get();
    const shortHash = /-(?<h>[0-9a-f]{8})\.png$/.exec(srcs[0])![1];
    const firstSrc = `./未命名.assets/a-${shortHash}.png`;
    expect(first.filePath).toBe("/mock-single/未命名.md");

    await act(async () => {
      await expect(first.saveAs()).resolves.toBe(true);
    });
    const second = get();
    expect(second.filePath).toBe("/mock-single/未命名 (2).md");
    const secondSrc = `./未命名 (2).assets/a-${shortHash}.png`;
    await expect(kbBackend.readSingleFile(second.filePath!)).resolves.toBe(`![a](${secondSrc})`);
    // 旧文件保持原样,新目录能读到同一张图
    await expect(kbBackend.readSingleFile(first.filePath!)).resolves.toBe(`![a](${firstSrc})`);
    await expect(second.readAssetBase64(secondSrc)).resolves.toMatchObject({ mime: "image/png" });
  });

  it("打开的文件被删除后按保存:直接转另存为,内容落到新位置而不是静默失败", async () => {
    const get = await mount();
    const path = (await kbBackend.saveSingleFileAs("笔记.md", "原文"))!;
    await act(async () => {
      await get().openFile(path);
    });
    act(() => {
      get().onMarkdownChange("删掉之前改过的内容");
    });
    // 模拟磁盘上被删除(mock 存储里移掉这条)
    const key = "yz-mock-single-files-v1";
    const all = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, string>;
    delete all[path];
    localStorage.setItem(key, JSON.stringify(all));
    await expect(kbBackend.readSingleFile(path)).rejects.toBeDefined();

    await act(async () => {
      // 没有「保存引导走另存为」时这里会是 false(写回不存在的文件失败)
      await expect(get().save()).resolves.toBe(true);
    });
    const s = get();
    expect(s.missing).toBe(false);
    expect(s.filePath).toBe(path); // 另存为默认名同名 → 原位置重建
    await expect(kbBackend.readSingleFile(path)).resolves.toBe("删掉之前改过的内容");
  });

  it("清理未引用图片:只列出正文没引用的文件;删掉后目录里只剩被引用的", async () => {
    const get = await mount();
    const path = (await kbBackend.saveSingleFileAs("带图.md", "原文"))!;
    await act(async () => {
      await get().openFile(path);
    });
    const used = new File([new Uint8Array([1, 2])], "used.png", { type: "image/png" });
    const gone = new File([new Uint8Array([3, 4])], "gone.png", { type: "image/png" });
    let srcs: string[] = [];
    await act(async () => {
      srcs = await get().saveImageFiles([used, gone]);
    });
    act(() => {
      get().onMarkdownChange(`![used](${srcs[0]})`);
    });
    let scan = { files: [] as string[], unused: [] as string[] };
    await act(async () => {
      scan = await get().listUnreferencedAssets();
    });
    const usedName = srcs[0].split("/").pop()!;
    const goneName = srcs[1].split("/").pop()!;
    expect(scan.files.sort()).toEqual([usedName, goneName].sort());
    // 被引用的那张绝不会被列为未引用
    expect(scan.unused).toEqual([goneName]);

    let removed = 0;
    await act(async () => {
      removed = await get().deleteUnreferencedAssets(scan.unused);
    });
    expect(removed).toBe(1);
    await act(async () => {
      scan = await get().listUnreferencedAssets();
    });
    expect(scan.files).toEqual([usedName]);
    expect(scan.unused).toEqual([]);
  });

  it("关闭未命名:退出单文件态", async () => {
    const get = await mount();
    await act(async () => {
      await get().newUntitled();
    });
    await act(async () => {
      await get().close();
    });
    expect(get().active).toBe(false);
    expect(get().untitled).toBe(false);
  });
});
