import type { Node as PMNode } from "@tiptap/pm/model";

export function collectHttpImageUrls(doc: PMNode): string[] {
  const urls: string[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "image") return;
    const src = String(node.attrs.src ?? "");
    if (/^https?:\/\//i.test(src) && !urls.includes(src)) urls.push(src);
  });
  return urls;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function mermaidSvgSize(svg: string): { width: number; height: number } {
  // Mermaid 的根节点通常是 width="100%" + height 缺失 + viewBox 完整；
  // 不能用正则扫整段 SVG，否则会误取第一个内部 rect/path 的宽高，
  // 导致导出的 PNG 变成 32×48、300×156 这类错误尺寸。
  if (typeof DOMParser === "undefined") return { width: 1200, height: 800 };
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const numericAttr = (name: string): number | null => {
    const value = Number(root.getAttribute(name)?.replace(/px$/i, ""));
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  const view = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBoxSize =
    view?.length === 4 && view.every((n) => Number.isFinite(n))
      ? { width: view[2], height: view[3] }
      : null;
  const width = numericAttr("width");
  const height = numericAttr("height");
  if (width && height) return { width, height };
  if (width && viewBoxSize) return { width, height: viewBoxSize.height };
  if (height && viewBoxSize) return { width: viewBoxSize.width, height };
  if (viewBoxSize && viewBoxSize.width > 0 && viewBoxSize.height > 0) return viewBoxSize;
  const maxWidth = Number(root.getAttribute("style")?.match(/max-width:\s*([\d.]+)px/)?.[1]);
  if (Number.isFinite(maxWidth) && maxWidth > 0 && viewBoxSize) {
    return { width: maxWidth, height: viewBoxSize.height };
  }
  return { width: 1200, height: 800 };
}

function hasExternalResource(svg: string): boolean {
  return /\b(?:xlink:href|href)\s*=\s*["']https?:\/\//i.test(svg) || /\burl\(\s*['"]?https?:\/\//i.test(svg);
}

async function svgToPngDataUrl(svg: string): Promise<string | null> {
  if (typeof document === "undefined" || hasExternalResource(svg)) return null;
  const source = `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Mermaid SVG 无法解码"));
    image.src = source;
  });
  const original = mermaidSvgSize(svg);
  const width = Math.max(1, Math.round(original.width || 1200));
  const height = Math.max(1, Math.round(original.height || 800));
  // 控制体积,同时给 Word 打印保留足够清晰度；等比缩放,避免任何一边被 4000px 上限裁坏比例。
  const scale = Math.min(2, 4000 / width, 4000 / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:image/png;base64,${bytesToBase64(bytes)}`;
}

export async function renderMermaidDataUrl(code: string): Promise<string | null> {
  try {
    const { renderMermaid } = await import("../editor/extensions/mermaid");
    const svg = await renderMermaid(code, false);
    const png = await svgToPngDataUrl(svg).catch(() => null);
    if (png) return png;
    if (hasExternalResource(svg)) return null;
    return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
  } catch {
    return null;
  }
}
