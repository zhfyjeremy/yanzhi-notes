/**
 * [[双链]] 出链索引与反向链接聚合(PRD §5.4-2 基础版)。
 * - parseWikiOut:md 源文本提取 [[目标]] / [[目标|别名]](与重命名联动的朴素扫描同语义:
 *   代码块内的 [[…]] 也会计入,基础版可接受)
 * - WikiRefIndex:全库出链 Map,与搜索索引同点位增量维护(boot 重建/保存增量/删除移除,
 *   改名走 scheduleIndexRebuild 兜底重建);回收站文档单独一份(「已删除」灰态来源)
 * - backlinks():按解析后的目标文档聚合;解析规则与点击跳转完全同构(resolveWikiTarget),
 *   裸名/路径/别名写法归一为同一目标计数
 */

import type { DocContent } from "./types";
import { resolveWikiTarget, type WikiDoc } from "./wiki-refs";

export interface OutLink {
  /** 链接目标原文(未解析,含路径写法) */
  target: string;
  /** `|显示名` 部分,无则 null */
  alias: string | null;
}

export interface BacklinkRow {
  /** 引用方文档相对路径(回收站来源 = 原相对路径) */
  source: string;
  /** 该文档内指向目标的引用次数(各写法归一合计) */
  count: number;
  /** 来源已被移入回收站(灰态,点击引导去回收站) */
  deleted: boolean;
}

const WIKI_RE = /\[\[([^\[\]]+?)\]\]/g;

export function parseWikiOut(content: string): OutLink[] {
  const out: OutLink[] = [];
  for (const m of content.matchAll(WIKI_RE)) {
    const inner = m[1];
    const bar = inner.indexOf("|");
    if (bar === -1) out.push({ target: inner.trim(), alias: null });
    else
      out.push({
        target: inner.slice(0, bar).trim(),
        alias: inner.slice(bar + 1).trim() || null,
      });
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

  /** 聚合指向 targetRel 的全部引用;docs = 当前树平铺(解析用,与跳转同构) */
  backlinks(targetRel: string, docs: WikiDoc[]): BacklinkRow[] {
    const rows = new Map<string, BacklinkRow>();
    const bump = (source: string, deleted: boolean) => {
      const row = rows.get(source);
      if (row) row.count += 1;
      else rows.set(source, { source, count: 1, deleted });
    };
    for (const [source, links] of this.out) {
      for (const l of links) {
        if (resolveWikiTarget(docs, l.target) === targetRel) bump(source, false);
      }
    }
    for (const [source, links] of this.trashOut) {
      for (const l of links) {
        if (resolveWikiTarget(docs, l.target) === targetRel) bump(source, true);
      }
    }
    return [...rows.values()].sort((a, b) => a.source.localeCompare(b.source));
  }
}
