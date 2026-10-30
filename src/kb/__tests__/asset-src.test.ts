import { beforeEach, describe, expect, it } from "vitest";
import { assetRelPosix, isExternalSrc, setAssetResolver, resolveRenderSrc } from "../asset-src";
import { kbBackend } from "../backend";

describe("assetRelPosix(相对引用 → 库内相对路径)", () => {
  it("同文件夹 assets", () => {
    expect(assetRelPosix("随笔/第一篇.md", "./assets/a1.png")).toBe("随笔/assets/a1.png");
  });
  it("裸相对路径同样解析", () => {
    expect(assetRelPosix("随笔/第一篇.md", "assets/a1.png")).toBe("随笔/assets/a1.png");
  });
  it("上级穿越", () => {
    expect(assetRelPosix("随笔/第一篇.md", "../assets/a1.png")).toBe("assets/a1.png");
  });
  it("库根文档", () => {
    expect(assetRelPosix("开始使用.md", "./assets/x.png")).toBe("assets/x.png");
  });
  it("外链/data/绝对路径不解析", () => {
    expect(assetRelPosix("a.md", "https://x/y.png")).toBeNull();
    expect(assetRelPosix("a.md", "data:image/png;base64,xx")).toBeNull();
    expect(assetRelPosix("a.md", "/placeholder.svg")).toBeNull();
  });
});

describe("isExternalSrc", () => {
  it("协议与 // 与 / 开头都算外部", () => {
    expect(isExternalSrc("http://a")).toBe(true);
    expect(isExternalSrc("blob:x")).toBe(true);
    expect(isExternalSrc("//cdn/x")).toBe(true);
    expect(isExternalSrc("/app-internal.svg")).toBe(true);
    expect(isExternalSrc("./assets/x.png")).toBe(false);
  });
});

describe("resolveRenderSrc 注册表", () => {
  it("未注册原样返回,注册后走 resolver", () => {
    setAssetResolver(null);
    expect(resolveRenderSrc("./assets/x.png")).toBe("./assets/x.png");
    setAssetResolver((src) => "resolved:" + src);
    expect(resolveRenderSrc("./assets/x.png")).toBe("resolved:./assets/x.png");
    setAssetResolver(null);
  });
});

describe("mock 后端 assets(与 Rust fnv1a 命名对齐)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  it("FNV-1a 内容哈希命名:字节 [0x61] → af63dc4c8601ec8c", async () => {
    const src = await kbBackend.saveAsset("", "随笔/第一篇.md", "png", new Uint8Array([0x61]));
    expect(src).toBe("./assets/af63dc4c8601ec8c.png");
  });
  it("同内容不换名(去重靠哈希)", async () => {
    const a = await kbBackend.saveAsset("", "随笔/a.md", "png", new Uint8Array([1, 2, 3]));
    const b = await kbBackend.saveAsset("", "随笔/b.md", "png", new Uint8Array([1, 2, 3]));
    expect(a).toBe(b);
  });
  it("resolveAssetSrc 返回 dataURL(mock 渲染链路)", async () => {
    await kbBackend.saveAsset("", "随笔/a.md", "png", new Uint8Array([0x61]));
    expect(kbBackend.resolveAssetSrc("", "随笔/a.md", "./assets/af63dc4c8601ec8c.png")).toMatch(
      /^data:image\/png;base64,/,
    );
  });
  it("readAssetBase64 与 dataURL 往返", async () => {
    await kbBackend.saveAsset("", "随笔/a.md", "png", new Uint8Array([0x61]));
    const r = await kbBackend.readAssetBase64("", "随笔/assets/af63dc4c8601ec8c.png");
    expect(r?.mime).toBe("image/png");
    expect(atob(r!.data)).toBe("a");
  });
});
