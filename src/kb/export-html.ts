/**
 * 离线 HTML 导出(PRD 5.6):单文档 → 自包含 HTML,样式全内联,
 * 打开即可阅读(微信/邮件/浏览器直接看);图片转 base64 data URL 内嵌
 * (导出产物是派生物,base64 只出现在这里,不进 md 正文,9.3 红线不破)。
 */

import { mdToHtml } from "@/editor/markdown/md-instance";
import { inlineStyles } from "@/editor/clipboard";
import { assetRelPosix, isExternalSrc } from "./asset-src";

export interface ExportHtmlOptions {
  md: string;
  title: string;
  docRel: string;
  /** 库内相对路径 → base64(取不到返回 null,该图保留原相对引用) */
  readAssetBase64: (rel: string) => Promise<{ data: string; mime: string } | null>;
}

const PAGE_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: 48px 24px 96px;
  max-width: 780px;
  color: #231f1c;
  background: #faf9f7;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 16px;
  line-height: 1.6;
  word-break: break-word;
}
h1, h2, h3, h4, h5, h6 { margin: 1.4em 0 0.6em; line-height: 1.4; }
p { margin: 0.75em 0; }
img { max-width: 100%; height: auto; }
table { margin: 1em 0; }
pre { margin: 1em 0; }
input[type="checkbox"] { margin-right: 0.35em; }
`;

export async function buildExportHtml(opts: ExportHtmlOptions): Promise<string> {
  const doc = new DOMParser().parseFromString(mdToHtml(opts.md), "text/html");
  // 图片内嵌:相对引用 → data URL(拿不到的字节保留原引用,不至于报错)
  for (const img of Array.from(doc.body.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!src || isExternalSrc(src)) continue;
    const rel = assetRelPosix(opts.docRel, src);
    if (!rel) continue;
    const data = await opts.readAssetBase64(rel).catch(() => null);
    if (data) img.setAttribute("src", `data:${data.mime};base64,${data.data}`);
  }
  const body = inlineStyles(doc.body.innerHTML);
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}
