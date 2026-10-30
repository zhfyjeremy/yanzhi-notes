/**
 * 图片粘贴压缩(PRD §8:WebP 质量 85):canvas 前端编码,零新依赖,
 * mock/浏览器/Tauri(WebKit)链路同构,Rust 侧不动。
 * 层位:App 的粘贴/拖拽入口(onImageFiles),压缩后再进 saveImageFiles
 * —— 内容哈希命名基于压缩后字节,同图同设置不会存两份。
 * 保留原图的三种情况:SVG/GIF(矢量/动画语义不可再编码)、编码环境不支持
 * image/webp(toBlob 返回 null)、压完不小反大(源图已高度优化)。
 */

const COMPRESSIBLE = new Set(["image/png", "image/jpeg", "image/webp"]);
const WEBP_QUALITY = 0.85;

/** 图片文件识别:MIME 优先;WKWebView 从 Finder 拖入的 File 常无 type
 *  (拖拽粘贴板不带 UTI),空 MIME 回退按扩展名判——否则被静默滤掉,
 *  表现为「拖了没反应」 */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|tiff?)$/i;
export function isImageFile(f: File): boolean {
  return f.type.startsWith("image/") || (!f.type && IMAGE_EXT.test(f.name));
}

/** 能否再编码:位图格式才压;SVG/GIF 原样过 */
export function isCompressible(file: File): boolean {
  return COMPRESSIBLE.has(file.type);
}

/** 编码结果裁决(纯函数,单测锁定):失败/变大回原图,划算则换 .webp 名 */
export function pickCompressed(original: File, encoded: Blob | null): File {
  if (!encoded || encoded.type !== "image/webp" || encoded.size >= original.size) return original;
  const base = original.name.replace(/\.[^.]+$/, "");
  return new File([encoded], `${base || "image"}.webp`, { type: "image/webp" });
}

/** 粘贴/拖拽的图片文件 → 压缩后的 File(任何异常都原图兜底,不阻塞插入) */
export async function compressImageFile(file: File): Promise<File> {
  if (!isCompressible(file)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", WEBP_QUALITY));
      return pickCompressed(file, blob);
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
