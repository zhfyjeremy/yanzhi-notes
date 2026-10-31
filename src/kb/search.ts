/**
 * 本地搜索索引(PRD 5.5):FlexSearch 三路索引(标题/正文/路径)加权合并,
 * 中文按 bigram(+单字)切分、西文按词(自定义 tokenize,查询与入库同一条路径)。
 * 排序不依赖 FlexSearch 内部分数:按各路命中位次 × 字段权重自算,确定性可单测。
 * 索引只在内存,开库构建/保存增量更新/损坏可重建(重建入口在搜索空态与目录树菜单)。
 */

import FlexSearch from "flexsearch";

/**
 * flexsearch 0.7 的 d.ts 描述的是 async/worker 形态(search 返回 Promise、
 * id 是 number、default 带 .create 静态),而 ESM 版同步 Index 的默认导出
 * 是构造函数、运行时返回数组且接受 string id —— 此处按运行时行为做
 * 一次性结构化收窄,上层不再碰 flexsearch 类型。
 * 自定义切词必须挂 **encode**(返回 token 数组):挂 tokenize 函数在 ESM
 * 构建里不生效,CJK 会被默认拉丁编码器整段剥掉(实测)。
 */
interface SyncIndex {
  add(id: string, text: string): void;
  remove(id: string): void;
  search(query: string, options: { limit: number; suggest: boolean }): string[];
}

type SyncIndexCtor = new (options: { encode: (str: string) => string[] }) => SyncIndex;

/** ESM 默认导出是 Index 构造函数,CJS(vitest 走 main)是 { Index } 对象 —— 两种都接 */
const IndexCtor: SyncIndexCtor =
  typeof FlexSearch === "function"
    ? (FlexSearch as unknown as SyncIndexCtor)
    : (FlexSearch as unknown as { Index: SyncIndexCtor }).Index;

const createSyncIndex = (): SyncIndex => new IndexCtor({ encode: tokenize });

/** CJK 统一表意/扩展A/兼容/假名/谚文 + 拉丁数字词 */
const TOKEN_RE = /[a-z0-9]+|[⺀-鿿豈-﫿぀-ヿ가-힯]+/g;

/** 入库/查询共用的切词:拉丁·数字整词;CJK 连续段拆 bigram + 单字(单字查询可命中) */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
    const token = m[0];
    if (token[0] >= "a" && token[0] <= "z") {
      out.push(token);
      continue;
    }
    for (let i = 0; i < token.length; i++) {
      out.push(token[i]);
      if (i + 1 < token.length) out.push(token.slice(i, i + 2));
    }
  }
  return out;
}

/** 高亮用词:优先多字词;全为单字(如单字查询)才用单字,避免把相邻字全染黄 */
export function highlightTerms(query: string): string[] {
  const tokens = tokenize(query);
  const multi = tokens.filter((t) => t.length >= 2);
  return multi.length ? Array.from(new Set(multi)) : Array.from(new Set(tokens));
}

export interface SnippetSegment {
  text: string;
  hit: boolean;
}

export interface SearchHit {
  path: string;
  /** 文档名(basename 去 .md) */
  name: string;
  /** 所在文件夹相对路径(库根为空串) */
  dir: string;
  score: number;
  /** 命中片段(正文无命中时给开头摘要,无高亮) */
  snippet: SnippetSegment[];
}

const WEIGHTS = { title: 8, path: 4, content: 1 } as const;
const LIMIT = 50;
/** 片段窗口:首个命中词前后各留这么多字符 */
const SNIPPET_RADIUS = 36;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const docName = (path: string): string => path.replace(/\.md$/i, "").split("/").pop() ?? "";
export const docDir = (path: string): string =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** 首个命中定位 + 关键词切分片段(纯函数,单测锁定) */
export function buildSnippet(content: string, terms: string[]): SnippetSegment[] {
  if (!content) return [];
  const effective = terms.length ? terms : null;
  let first = -1;
  if (effective) {
    const re = new RegExp(effective.map(escapeRe).join("|"), "gi");
    first = re.exec(content)?.index ?? -1;
  }
  const from = first >= 0 ? Math.max(0, first - SNIPPET_RADIUS) : 0;
  const raw = content.slice(from, from + SNIPPET_RADIUS * 2 + Math.max(0, first >= 0 ? terms[0].length : 12));
  const segs: SnippetSegment[] = [];
  if (first >= 0 && effective) {
    const re = new RegExp(effective.map(escapeRe).join("|"), "gi");
    let last = 0;
    for (const m of raw.matchAll(re)) {
      if (m.index > last) segs.push({ text: raw.slice(last, m.index), hit: false });
      segs.push({ text: m[0], hit: true });
      last = m.index + m[0].length;
    }
    if (last < raw.length) segs.push({ text: raw.slice(last), hit: false });
  } else {
    segs.push({ text: raw, hit: false });
  }
  return segs;
}

export class KbSearchIndex {
  private title: SyncIndex = createSyncIndex();
  private content: SyncIndex = createSyncIndex();
  private path: SyncIndex = createSyncIndex();
  private raws = new Map<string, string>();

  build(docs: { path: string; content: string }[], tagsOf?: (path: string) => string[]): void {
    this.clear();
    for (const d of docs) this.add(d.path, d.content, tagsOf?.(d.path) ?? []);
  }

  /** tags(6.3-2)拼进正文索引尾部:搜标签名即可命中(片段仍取正文原文) */
  add(path: string, content: string, tags: string[] = []): void {
    this.remove(path);
    this.title.add(path, docName(path));
    this.content.add(path, tags.length ? `${content}\n${tags.map((t) => `#${t}`).join(" ")}` : content);
    this.path.add(path, path);
    this.raws.set(path, content);
  }

  remove(path: string): void {
    this.title.remove(path);
    this.content.remove(path);
    this.path.remove(path);
    this.raws.delete(path);
  }

  clear(): void {
    for (const p of Array.from(this.raws.keys())) this.remove(p);
  }

  get size(): number {
    return this.raws.size;
  }

  search(query: string): SearchHit[] {
    const q = query.trim();
    if (!q || tokenize(q).length === 0) return [];
    const scores = new Map<string, number>();
    // 位次分:第 i/n 名得 (n-i)/n,乘字段权重后跨路累加(标题 > 路径 > 正文)
    const bump = (ids: string[] | undefined, weight: number) => {
      if (!ids?.length) return;
      const n = ids.length;
      ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + (weight * (n - i)) / n));
    };
    // suggest:true —— 全 token AND 无果时按 OR 兜底(多字查询部分命中也能出)
    const opt = { limit: LIMIT, suggest: true };
    bump(this.title.search(q, opt), WEIGHTS.title);
    bump(this.path.search(q, opt), WEIGHTS.path);
    bump(this.content.search(q, opt), WEIGHTS.content);

    const terms = highlightTerms(q);
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, LIMIT)
      .map(([path, score]) => ({
        path,
        name: docName(path),
        dir: docDir(path),
        score,
        snippet: buildSnippet(this.raws.get(path) ?? "", terms),
      }));
  }
}
