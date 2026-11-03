/**
 * AI-2 双链建议:只允许知识库已有文档名;模型输出再本地过滤。
 */

import { resolveWikiTarget, wikiTargetFor, type WikiDoc } from "../kb/wiki-refs";

export interface WikiSuggestDoc {
  name: string;
  path: string;
  /** 写入双链时的目标写法(重名用路径) */
  target: string;
}

export const WIKI_SUGGEST_EMPTY = "（当前知识库中没有与选区匹配的文档）";
const EMPTY_MSG = WIKI_SUGGEST_EMPTY;

/** 供 prompt 使用的候选清单;过大时截断以免撑爆上下文 */
export function formatWikiCatalog(docs: WikiSuggestDoc[], limit = 500): string {
  const slice = docs.slice(0, limit);
  const lines = slice.map((d) => `- [[${d.target}]]`);
  if (docs.length > limit) {
    lines.push(`- …(其余 ${docs.length - limit} 篇未列入,请优先匹配以上)`);
  }
  return lines.join("\n");
}

/**
 * 从模型输出抽出 [[…]],只保留能解析到知识库文档的项;
 * 统一写成 wikiTargetFor 的规范写法。无命中则返回固定空态文案。
 */
export function filterWikiSuggestOutput(
  modelOutput: string,
  docs: WikiSuggestDoc[],
): string {
  if (!docs.length) return EMPTY_MSG;
  const wikiDocs: WikiDoc[] = docs.map((d) => ({ name: d.name, path: d.path }));
  const picked: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(modelOutput)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    const path = resolveWikiTarget(wikiDocs, raw);
    if (!path) continue;
    const target = wikiTargetFor(wikiDocs, path);
    if (seen.has(target)) continue;
    seen.add(target);
    picked.push(`- [[${target}]]`);
  }
  return picked.length ? picked.join("\n") : EMPTY_MSG;
}

/** 从已过滤结果抽出可点击的双链目标(空态返回 []) */
export function parseWikiSuggestTargets(result: string): string[] {
  if (!result.trim() || result.includes("没有与选区匹配")) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(result)) !== null) {
    const target = m[1].trim();
    if (!target || seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}
