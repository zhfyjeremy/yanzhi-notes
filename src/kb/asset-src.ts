/**
 * 图片 src 双环境解析(PRD 9.3):
 * - md 里存的永远是相对文档所在文件夹的引用(`./assets/x.png`);
 *   PM doc 的 attrs.src 保持相对路径(序列化唯一真源),仅渲染时解析成可显示 URL。
 * - tauri:convertFileSrc(asset: 协议,tauri.conf 已开 assetProtocol);
 *   browser mock:localStorage 里的 dataURL 查表。
 * 外链 / data: / blob: / 应用内绝对路径(/placeholder.svg 等)原样返回。
 */

export function isExternalSrc(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//") || src.startsWith("/");
}

/**
 * 相对引用 → 库内 POSIX 相对路径(不含开头 ./);解析失败或非相对引用返回 null。
 * `随笔/第一篇.md` + `./assets/a.png` → `随笔/assets/a.png`;
 * `随笔/第一篇.md` + `../assets/a.png` → `assets/a.png`。
 */
export function assetRelPosix(docRel: string, src: string): string | null {
  if (!src || isExternalSrc(src)) return null;
  const clean = src.split("#")[0].split("?")[0];
  if (!clean) return null;
  const docDir = docRel.includes("/") ? docRel.slice(0, docRel.lastIndexOf("/")) : "";
  const segs = [...docDir.split("/"), ...clean.split(/[\\/]/)].filter(Boolean);
  const out: string[] = [];
  for (const s of segs) {
    if (s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  if (!out.length) return null;
  return out.join("/");
}

/* ---------------- 渲染期全局解析(编辑器 NodeView 用) ----------------
 * NodeView 的 <img src> 需要同步值,而 root/docRel 在 App 层;
 * App 在 layout effect 里注册(App 先于子组件 passive effect 的 setContent,
 * 图片挂载时 resolver 已指向新文档)。 */

type AssetResolver = (src: string) => string;
let resolver: AssetResolver | null = null;

export function setAssetResolver(fn: AssetResolver | null): void {
  resolver = fn;
}

/** attrs.src(相对引用)→ 可显示 URL;未注册或解析失败原样返回 */
export function resolveRenderSrc(src: string): string {
  if (!src) return src;
  return resolver ? resolver(src) : src;
}
