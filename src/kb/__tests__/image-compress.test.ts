import { describe, expect, it } from "vitest";
import { isCompressible, pickCompressed } from "../image-compress";

/** canvas 编码链路依赖真实位图环境,浏览器 E2E 覆盖;这里锁定纯函数裁决 */

const png = (size = 1000) => new File([new Uint8Array(size)], "shot.png", { type: "image/png" });
const webp = (size = 1000) => new File([new Uint8Array(size)], "shot.webp", { type: "image/webp" });

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
  it("编码失败(null)或非 JPG/PNG → 原图", () => {
    const src = png();
    expect(pickCompressed(src, null)).toBe(src);
    expect(pickCompressed(src, new Blob([new Uint8Array(10)], { type: "image/webp" }))).toBe(src);
  });

  it("PNG/JPEG 压完不小于原图 → 原图(已优化的源图不折腾)", () => {
    const src = png(100);
    expect(pickCompressed(src, new Blob([new Uint8Array(100)], { type: "image/jpeg" }))).toBe(src);
    expect(pickCompressed(src, new Blob([new Uint8Array(200)], { type: "image/png" }))).toBe(src);
  });

  it("无透明输出更小的 JPG,有透明输出 PNG", () => {
    const jpg = pickCompressed(png(1000), new Blob([new Uint8Array(300)], { type: "image/jpeg" }));
    expect(jpg.name).toBe("shot.jpg");
    expect(jpg.type).toBe("image/jpeg");
    expect(jpg.size).toBe(300);

    const alpha = pickCompressed(
      webp(1000),
      new Blob([new Uint8Array(300)], { type: "image/png" }),
    );
    expect(alpha.name).toBe("shot.png");
    expect(alpha.type).toBe("image/png");
  });

  it("WebP 源图即使目标更大也强制转为 JPG/PNG", () => {
    const src = webp(100);
    const out = pickCompressed(src, new Blob([new Uint8Array(200)], { type: "image/jpeg" }));
    expect(out.name).toBe("shot.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBe(200);
  });

  it("无扩展名文件也能给出合法名", () => {
    const out = pickCompressed(
      new File([new Uint8Array(1000)], "screenshot", { type: "image/png" }),
      new Blob([new Uint8Array(10)], { type: "image/jpeg" }),
    );
    expect(out.name).toBe("screenshot.jpg");
  });
});
