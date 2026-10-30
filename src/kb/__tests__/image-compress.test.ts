import { describe, expect, it } from "vitest";
import { isCompressible, pickCompressed } from "../image-compress";

/** canvas 编码链路依赖真实位图环境,浏览器 E2E 覆盖;这里锁定纯函数裁决 */

const png = (size = 1000) => new File([new Uint8Array(size)], "shot.png", { type: "image/png" });

describe("isCompressible(PRD §8 可再编码位图)", () => {
  it("png/jpeg/webp 压,svg/gif 原样过", () => {
    expect(isCompressible(png())).toBe(true);
    expect(isCompressible(new File([], "a.jpg", { type: "image/jpeg" }))).toBe(true);
    expect(isCompressible(new File([], "a.webp", { type: "image/webp" }))).toBe(true);
    expect(isCompressible(new File([], "a.svg", { type: "image/svg+xml" }))).toBe(false);
    expect(isCompressible(new File([], "a.gif", { type: "image/gif" }))).toBe(false);
  });
});

describe("pickCompressed(编码结果裁决)", () => {
  it("编码失败(null)或非 webp → 原图", () => {
    const src = png();
    expect(pickCompressed(src, null)).toBe(src);
    expect(pickCompressed(src, new Blob([new Uint8Array(10)], { type: "image/png" }))).toBe(src);
  });
  it("压完不小于原图 → 原图(已优化的源图不折腾)", () => {
    const src = png(100);
    expect(pickCompressed(src, new Blob([new Uint8Array(100)], { type: "image/webp" }))).toBe(src);
    expect(pickCompressed(src, new Blob([new Uint8Array(200)], { type: "image/webp" }))).toBe(src);
  });
  it("更小的 webp → 换名换型,内容保留", () => {
    const out = pickCompressed(png(1000), new Blob([new Uint8Array(300)], { type: "image/webp" }));
    expect(out.name).toBe("shot.webp");
    expect(out.type).toBe("image/webp");
    expect(out.size).toBe(300);
  });
  it("无扩展名文件也能给出合法名", () => {
    const out = pickCompressed(
      new File([new Uint8Array(1000)], "screenshot", { type: "image/png" }),
      new Blob([new Uint8Array(10)], { type: "image/webp" }),
    );
    expect(out.name).toBe("screenshot.webp");
  });
});
