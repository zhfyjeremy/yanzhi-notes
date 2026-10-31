/**
 * [[双链]] 出链索引与反向链接聚合(PRD §5.4-2 + 6.3-1)。
 * - parseWikiOut:md 源文本提取 [[目标]] / [[目标|别名]](与重命名联动的朴素扫描同语义:
 *   代码块内的 [[…]] 也会计入,基础版可接受),同时带出引用片段与所在章节路径
 * - WikiRefIndex:全库出链 Map,与搜索索引同点位增量维护(boot 重建/保存增量/删除移除,
 *   改名走 scheduleIndexRebuild 兜底重建);回收站文档单独一份(「已删除」灰态来源)
 * - backlinks():按解析后的目标文档聚合;解析规则与点击跳转完全同构(resolveWikiTarget),
 *   裸名/路径/别名写法归一为同一目标;每次引用一行(来源 + 章节位置 + 片段)
 */

import type { DocContent } from "./types";
import { resolveWikiTarget, type WikiDoc } from "./wiki-refs";

export interface OutLink {
  /** 链接目标原文(未解析,含路径写法) */
  target: string;
  /** `|显示名` 部分,无则 null */
  alias: string | null;
  /** 引用显示文字(别名优先) */
  label: string;
  /** 引用所在章节路径(「安装 / macOS」);文首无标题时 null */
  heading: string | null;
  /** 引用处的上下文片段(单行,含 [[…]] 原文,前后各留 ~24 字) */
  snippet: string;
}

export interface BacklinkRow {
  /** 引用方文档相对路径(回收站来源 = 原相对路径) */
  source: string;
  /** 来源已被移入回收站(灰态,点击引导去回收站) */
  deleted: boolean;
  /** 引用显示文字([[目标|别名]] 的别名/目标) */
  label: string;
  /** 引用所在章节路径;null = 文首 */
  heading: string | null;
  /** 引用上下文片段([[…]] 原文在内,渲染时高亮) */
  snippet: string;
}

const WIKI_RE = /\[\[([^\[\]]+?)\]\]/g;
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
/** 片段窗口:引用词前后各留这么多字符 */
const SNIPPET_RADIUS = 24;

/** 引用所在行 → 片段:引用词前后各 radius 字,越界补省略号 */
function snippetAround(line: string, start: number, len: number): string {
  const from = Math.max(0, start - SNIPPET_RADIUS);
  const to = Math.min(line.length, start + len + SNIPPET_RADIUS);
  const body = line.slice(from, to).trim();
  return (from > 0 ? "…" : "") + body + (to < line.length ? "…" : "");
}

export function parseWikiOut(content: string): OutLink[] {
  const out: OutLink[] = [];
  const stack: string[] = []; // stack[i] = 第 i+1 级标题文本
  let fence = false;
  for (const line of content.split("\n")) {
    if (FENCE_RE.test(line)) fence = !fence;
    const h = !fence && line.match(HEADING_RE);
    if (h) {
      // 新标题:截断到父级再入栈(`## b` 于 `# a` 后 → [a, b];`# c` → [c])
      stack.length = h[1].length - 1;
      stack.push(h[2].trim());
    }
    for (const m of line.matchAll(WIKI_RE)) {
      const inner = m[1];
      const bar = inner.indexOf("|");
      const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
      const alias = bar === -1 ? null : inner.slice(bar + 1).trim() || null;
      if (!target) continue;
      out.push({
        target,
        alias,
        label: alias ?? target,
        heading: stack.length ? stack.filter(Boolean).join(" / ") : null,
        snippet: snippetAround(line, m.index ?? 0, m[0].length),
      });
    }
  }
  return out;
}

export class WikiRefIndex {
  private out = new Map<string, OutLink[]>();
  private trashOut = new Map<string, OutLink[]>();

  /** 库内全量重建(readAllDocs) */
  build(docs: DocContent[]) {
    this.out = new Map(docs.map((d) => [d.path, parseWikiOut(d.content)]));
  }

  /** 回收站全量重建(readAllTrashDocs;path = 原相对路径) */
  buildTrash(docs: DocContent[]) {
    this.trashOut = new Map(docs.map((d) => [d.path, parseWikiOut(d.content)]));
  }

  /** 单篇内容变更(保存/打开/新建) */
  update(rel: string, content: string) {
    this.out.set(rel, parseWikiOut(content));
  }

  remove(rel: string) {
    this.out.delete(rel);
  }

  /** 指向 targetRel 的全部引用,每次引用一行;docs = 当前树平铺(解析用,与跳转同构) */
  backlinks(targetRel: string, docs: WikiDoc[]): BacklinkRow[] {
    const sourceOrder = new Map(docs.map((doc, i) => [doc.path, i]));
    const rows: BacklinkRow[] = [];
    for (const [source, links] of this.out) {
      for (const l of links) {
        if (resolveWikiTarget(docs, l.target) === targetRel) {
          rows.push({ source, deleted: false, label: l.label, heading: l.heading, snippet: l.snippet });
        }
      }
    }
    for (const [source, links] of this.trashOut) {
      for (const l of links) {
        if (resolveWikiTarget(docs, l.target) === targetRel) {
          rows.push({ source, deleted: true, label: l.label, heading: l.heading, snippet: l.snippet });
        }
      }
    }
    // 与目录树平铺顺序一致,避免 locale 差异导致面板行序随系统变化。
    return rows.sort(
      (a, b) =>
        (sourceOrder.get(a.source) ?? Number.MAX_SAFE_INTEGER) -
          (sourceOrder.get(b.source) ?? Number.MAX_SAFE_INTEGER) ||
        a.source.localeCompare(b.source),
    );
  }
}
