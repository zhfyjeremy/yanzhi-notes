import type { EditorView } from "@tiptap/pm/view";
import { NodeSelection } from "@tiptap/pm/state";
import { insertImageAtSelection } from "./image-insert";

/**
 * 粘贴“整段恰好是一个 http(s) URL”的纯文本时识别外链图片。
 * 已知图片扩展名走零请求快路径；未知扩展名由用户主动粘贴触发一次
 * no-referrer 图片解码探测，失败则保留链接语义。
 */
const IMAGE_URL_EXTENSIONS = new Set([
  "avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp",
]);
/** 常见“扩展名在 query”的图床形态(如微信 wx_fmt=png) */
const IMAGE_URL_FORMAT_PARAMS = new Set(["as", "fmt", "format", "f", "output", "wx_fmt"]);
const IMAGE_PROBE_TIMEOUT_MS = 10_000;

function httpURLFromClipboardText(text: string | null | undefined): string | null {
  const src = text?.trim() ?? "";
  if (!src || /\s/.test(src)) return null;

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? src : null;
}

/** 能从 URL 本身判断为图片时返回原 URL;不做任何网络请求。 */
export function imageURLFromClipboardText(text: string | null | undefined): string | null {
  const src = httpURLFromClipboardText(text);
  if (!src) return null;
  const url = new URL(src);

  const pathExt = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (pathExt && IMAGE_URL_EXTENSIONS.has(pathExt)) return src;
  const queryExt = [...IMAGE_URL_FORMAT_PARAMS]
    .flatMap((key) => url.searchParams.getAll(key))
    .map((value) => value.toLowerCase())
    .find((value) => IMAGE_URL_EXTENSIONS.has(value));
  return queryExt ? src : null;
}

/**
 * 用 Image 解码探测未知 URL。这里比 HEAD 更可靠：
 * WebView fetch/HEAD 受 CORS 限制，且不少图床不支持 HEAD；
 * Image 与最终显示路径一致，不暴露响应内容给脚本。
 */
export function canLoadAsImage(
  src: string,
  imageCtor?: typeof Image,
  timeoutMs = IMAGE_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new (imageCtor ?? globalThis.Image)();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);

    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = src;
  });
}

function altFromImageURL(src: string): string | null {
  try {
    const filename = new URL(src).pathname.split("/").filter(Boolean).pop() ?? "";
    const alt = decodeURIComponent(filename.replace(/\.[^.]+$/, "")).trim();
    return alt || null;
  } catch {
    return null;
  }
}

/** 在当前文档中找离参考位置最近的整段 URL 文本，成功探测后把它替换为图片。 */
function replaceExactTextWithImage(
  view: EditorView,
  src: string,
  preferredPos: number,
): boolean {
  let from = -1;
  let to = -1;
  let distance = Number.POSITIVE_INFINITY;

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "text" || node.text !== src) return true;
    const nextDistance = Math.abs(pos - preferredPos);
    if (nextDistance < distance) {
      distance = nextDistance;
      from = pos;
      to = pos + node.nodeSize;
    }
    return true;
  });
  if (from < 0) return false;

  const img = view.state.schema.nodes.image.create({ src, alt: altFromImageURL(src) });
  const tr = view.state.tr.replaceWith(from, to, img);
  tr.setSelection(NodeSelection.create(tr.doc, from));
  view.dispatch(tr);
  return true;
}

function probeUnknownImageURL(
  view: EditorView,
  src: string,
  canLoad: (src: string) => Promise<boolean>,
): void {
  // 先让 PM 原生粘贴完成(未知 URL 仍先落为链接/文本)，记录落点后再异步探测。
  window.setTimeout(() => {
    if (view.isDestroyed) return;
    const preferredPos = view.state.selection.from;
    void canLoad(src).then((ok) => {
      if (ok && !view.isDestroyed) replaceExactTextWithImage(view, src, preferredPos);
    });
  }, 0);
}

/** 只接管整段 http(s) URL;普通混合文本继续走 PM 粘贴。 */
export function handleImageURLPaste(
  view: EditorView,
  event: ClipboardEvent,
  canLoad: (src: string) => Promise<boolean> = canLoadAsImage,
): boolean {
  if (event.clipboardData?.files?.length) return false;
  // 代码块里粘贴 URL 必须保持源码文本,不能被改成图片节点
  for (let d = view.state.selection.$from.depth; d >= 0; d--) {
    if (view.state.selection.$from.node(d).type.name === "codeBlock") return false;
  }

  const rawURL = httpURLFromClipboardText(event.clipboardData?.getData("text/plain"));
  if (!rawURL) return false;

  const knownImageURL = imageURLFromClipboardText(rawURL);
  if (knownImageURL) {
    event.preventDefault();
    insertImageAtSelection(view, { src: knownImageURL, alt: altFromImageURL(knownImageURL) });
    return true;
  }

  // 用户主动粘贴未知 URL：保留默认链接粘贴，同时做一次图片解码探测。
  probeUnknownImageURL(view, rawURL, canLoad);
  return false;
}
