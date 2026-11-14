/**
 * 图片粘贴压缩(PRD §8):canvas 前端编码,零新依赖,mock/浏览器/Tauri(WebKit)同构。
 * 位图统一输出 JPG/PNG,不再输出 WebP:
 * - 无透明通道 → JPG 质量 85
 * - 有透明像素 → PNG(保留 alpha;JPG 不支持透明)
 * SVG/GIF 保留原图,避免破坏矢量/动画语义;PNG/JPEG 重编码后变大时保留原图。
 * 已是 WebP 的源图即使目标体积变大也强制转换,确保粘贴落盘不再产生 WebP。
 */

const COMPRESSIBLE = new Set(["image/png", "image/jpeg", "image/webp"]);
const JPEG_QUALITY = 0.85;

/** 图片文件识别:MIME 优先;WKWebView 从 Finder 拖入的 File 常无 type
 *  (拖拽粘贴板不带 UTI),空 MIME 回退按扩展名判——否则会被静默滤掉,
 *  表现为「拖了没反应」 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/i;
export function isImageFile(f: File): boolean {
  return f.type.startsWith("image/") || (!f.type && IMAGE_EXT.test(f.name));
}

/** 能否再编码:位图格式才压;SVG/GIF 原样过 */
export function isCompressible(file: File): boolean {
  return COMPRESSIBLE.has(file.type);
}

/** 编码结果裁决(纯函数,单测锁定):失败/非法目标格式回原图;
 * WebP 强制转 JPG/PNG,其他源图只有更小才替换。 */
export function pickCompressed(
  original: File,
  encoded: Blob | null,
  forceConversion = original.type === "image/webp",
): File {
  const target = encoded?.type;
  if (!encoded || (target !== "image/jpeg" && target !== "image/png")) return original;
  if (!forceConversion && encoded.size >= original.size) return original;

  const ext = target === "image/jpeg" ? "jpg" : "png";
  const base = original.name.replace(/\.[^.]+$/, "");
  return new File([encoded], `${base || "image"}.${ext}`, { type: target });
}

function canvasHasAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/** 粘贴/拖拽的图片文件 → JPG/PNG 编码后的 File;任何异常原图兜底,不阻塞插入 */
export async function compressImageFile(file: File): Promise<File> {
  if (!isCompressible(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0);
      const hasAlpha = canvasHasAlpha(ctx, canvas.width, canvas.height);
      const mimeType = hasAlpha ? "image/png" : "image/jpeg";
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, mimeType, JPEG_QUALITY),
      );
      return pickCompressed(file, blob);
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
