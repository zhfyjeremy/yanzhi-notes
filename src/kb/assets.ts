import { assetRelPosix } from "./asset-src";
import type { DocContent } from "./types";

const MD_TARGET =
  /!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const HTML_TARGET = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const MD_RICH =
  /(!?\[[^\]]*\]\(\s*)(?:<([^>\n]+)>|([^\s)]+))((?:\s+(?:"[^"]*"|'[^']*'))?\s*\))/g;
const HTML_RICH = /(\b(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi;

/** 提取一篇 Markdown 指向 assets/ 的库内相对路径;代码中的误命中只会多保留文件。 */
export function extractAssetReferences(docRel: string, content: string): Set<string> {
  const out = new Set<string>();
  const add = (target: string | undefined) => {
    if (!target) return;
    const rel = assetRelPosix(docRel, target.trim());
    if (!rel) return;
    const parts = rel.split("/");
    if (parts.includes("assets")) out.add(rel);
  };
  for (const m of content.matchAll(MD_TARGET)) add(m[1] ?? m[2]);
  for (const m of content.matchAll(HTML_TARGET)) add(m[1]);
  return out;
}

/** assets 全集 - Markdown 引用集 = 可安全清理的候选。 */
export function unReferencedAssets(docs: DocContent[], assets: string[]): string[] {
  const used = new Set<string>();
  for (const doc of docs) {
    for (const rel of extractAssetReferences(doc.path, doc.content)) used.add(rel);
  }
  return assets.filter((rel) => !used.has(rel));
}

export interface AssetCopy {
  from: string;
  to: string;
}

/**
 * 文档移动后:把仍被它引用的 assets 复制到目标文件夹,并把引用改写为 `./assets/<名>`。
 * 引用不存在或不是 assets 相对路径时原样保留;源资源不被删除,供其它文档继续使用。
 */
export function migrateMarkdownAssetRefs(
  content: string,
  oldDocRel: string,
  newDocRel: string,
): { content: string; copies: AssetCopy[] } {
  const oldDir = oldDocRel.includes("/") ? oldDocRel.slice(0, oldDocRel.lastIndexOf("/")) : "";
  const newDir = newDocRel.includes("/") ? newDocRel.slice(0, newDocRel.lastIndexOf("/")) : "";
  if (oldDir === newDir) return { content, copies: [] };

  const copyMap = new Map<string, AssetCopy>();
  const rewrite = (target: string): string => {
    const from = assetRelPosix(oldDocRel, target.trim());
    if (!from || !from.split("/").includes("assets")) return target;
    const name = from.split("/").pop();
    if (!name) return target;
    const to = `${newDir ? newDir + "/" : ""}assets/${name}`;
    copyMap.set(`${from}\0${to}`, { from, to });
    return `./assets/${name}`;
  };

  let next = content.replace(MD_RICH, (_match, pre: string, angle?: string, plain?: string, post = "") => {
    const target = angle ?? plain ?? "";
    const rewritten = rewrite(target);
    return `${pre}${angle ? `<${rewritten}>` : rewritten}${post}`;
  });
  next = next.replace(HTML_RICH, (_match, pre: string, target: string, post: string) => {
    return `${pre}${rewrite(target)}${post}`;
  });
  return { content: next, copies: [...copyMap.values()] };
}
