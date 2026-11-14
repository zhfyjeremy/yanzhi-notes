import type { Node as PMNode } from "@tiptap/pm/model";
import { docToMarkdown } from "../markdown/serialize";

export interface BlockSpan {
  /** 该顶层块在 PM doc 中的起止(含节点开闭) */
  pmFrom: number;
  pmTo: number;
  /** 该块在整篇序列化 md 中的起止(含块前空行与块末换行) */
  mdFrom: number;
  mdTo: number;
  /** 块内纯文本长度,用于列位置粗估 */
  plainLength: number;
}

export interface CursorMap {
  md: string;
  blocks: BlockSpan[];
}

interface TextblockHit {
  pos: number;
  node: PMNode;
  text: string;
}

function childrenOf(doc: PMNode, count: number): PMNode[] {
  const nodes: PMNode[] = [];
  for (let i = 0; i < count; i++) nodes.push(doc.child(i));
  return nodes;
}

/** 序列化前 n 个顶层块;n=0 返回空串(不要走 serializer,否则会得到单独的 "\\n") */
function markdownPrefix(doc: PMNode, count: number): string {
  if (count <= 0) return "";
  return docToMarkdown(doc.type.create(doc.attrs, childrenOf(doc, count)));
}

/** 块对应 md 区间内,跳过块前空行后的正文起点 */
function mdContentStart(md: string, from: number, to: number): number {
  let i = from;
  while (i < to && md[i] === "\n") i++;
  return i;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 顶层块级 PM ↔ Markdown 位置表。
 * 用「前缀序列化长度差」定边界,与 docToMarkdown 规范化一致。
 */
export function buildCursorMap(doc: PMNode): CursorMap {
  const md = docToMarkdown(doc);
  const blocks: BlockSpan[] = [];
  let pmPos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    const before = markdownPrefix(doc, i);
    const after = markdownPrefix(doc, i + 1);
    blocks.push({
      pmFrom: pmPos,
      pmTo: pmPos + child.nodeSize,
      mdFrom: before.length,
      mdTo: after.length,
      plainLength: child.textContent.length,
    });
    pmPos += child.nodeSize;
  }
  return { md, blocks };
}

function findBlockForPm(map: CursorMap, pos: number): BlockSpan | null {
  if (!map.blocks.length) return null;
  for (const block of map.blocks) {
    if (pos < block.pmTo) return block;
  }
  return map.blocks[map.blocks.length - 1]!;
}

function findBlockForMd(map: CursorMap, offset: number): BlockSpan | null {
  if (!map.blocks.length) return null;
  for (const block of map.blocks) {
    if (offset < block.mdTo) return block;
  }
  return map.blocks[map.blocks.length - 1]!;
}

/** 收集顶层块内全部文本块(文档序) */
function textblocksInRange(doc: PMNode, from: number, to: number): TextblockHit[] {
  const hits: TextblockHit[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      hits.push({ pos, node, text: node.textContent });
      return false;
    }
    return true;
  });
  return hits;
}

/** 文本块 text 在同块内是第几次出现(0-based) */
function occurrenceIndex(hits: TextblockHit[], index: number): number {
  const text = hits[index]!.text;
  let n = 0;
  for (let i = 0; i < index; i++) if (hits[i]!.text === text) n++;
  return n;
}

/**
 * 在块对应 md 切片里找第 occurrence 次出现 needle 的行首。
 * 空 needle 时退回块正文起点。
 */
function mdOffsetForNeedle(
  md: string,
  block: BlockSpan,
  needle: string,
  occurrence: number,
): number {
  const contentMd = mdContentStart(md, block.mdFrom, block.mdTo);
  if (!needle) return contentMd;
  const chunk = md.slice(contentMd, block.mdTo);
  let from = 0;
  let found = -1;
  let left = occurrence;
  while (left >= 0) {
    const i = chunk.indexOf(needle, from);
    if (i < 0) break;
    found = i;
    left--;
    from = i + Math.max(1, needle.length);
  }
  if (found < 0) return contentMd;
  return mdLineStart(md, contentMd + found);
}

/** 在块内按文本块出现次序反查 PM 文本块起点 */
function pmPosForNeedle(
  doc: PMNode,
  block: BlockSpan,
  needle: string,
  occurrence: number,
): number {
  const hits = textblocksInRange(doc, block.pmFrom, block.pmTo);
  if (!hits.length) return clamp(block.pmFrom + 1, 0, doc.content.size);

  if (!needle) {
    const first = hits[0]!;
    return first.pos + 1;
  }

  let left = occurrence;
  for (const hit of hits) {
    if (hit.text !== needle) continue;
    if (left === 0) return hit.pos + 1;
    left--;
  }
  // 退化:用 md 行里剥掉常见标记后的文本再比一次
  const stripped = needle.replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+(\[[xX ]\]\s+)?/, "").replace(/^\d+[.)]\s+/, "");
  if (stripped && stripped !== needle) {
    left = occurrence;
    for (const hit of hits) {
      if (hit.text !== stripped) continue;
      if (left === 0) return hit.pos + 1;
      left--;
    }
  }
  return hits[Math.min(occurrence, hits.length - 1)]!.pos + 1;
}

/** 源码行文本 → 用于匹配的 needle(去掉标题/列表标记) */
function lineNeedle(line: string): string {
  const trimmed = line.trimEnd();
  const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
  if (heading) return heading[1] ?? "";
  const task = /^[-*+]\s+\[[xX ]\]\s+(.*)$/.exec(trimmed);
  if (task) return task[1] ?? "";
  const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
  if (bullet) return bullet[1] ?? "";
  const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
  if (ordered) return ordered[1] ?? "";
  // 代码围栏行本身
  if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) return trimmed;
  return trimmed;
}

/**
 * 排版光标 → 源码 offset。
 * 先定顶层块,再按块内文本块内容匹配到对应 md 行;列位置粗估夹在该行内。
 */
export function pmPosToMdOffset(doc: PMNode, pos: number): number {
  const map = buildCursorMap(doc);
  if (!map.blocks.length) return 0;
  const clamped = clamp(pos, 0, doc.content.size);
  const block = findBlockForPm(map, clamped);
  if (!block) return 0;

  const hits = textblocksInRange(doc, block.pmFrom, block.pmTo);
  let hitIndex = -1;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const from = hit.pos;
    const to = hit.pos + hit.node.nodeSize;
    if (clamped >= from && clamped < to) {
      hitIndex = i;
      break;
    }
  }
  if (hitIndex < 0) {
    return mdContentStart(map.md, block.mdFrom, block.mdTo);
  }

  const hit = hits[hitIndex]!;
  const occ = occurrenceIndex(hits, hitIndex);
  const lineStart = mdOffsetForNeedle(map.md, block, hit.text, occ);
  const col = Math.max(0, clamped - (hit.pos + 1));
  const lineEnd = map.md.indexOf("\n", lineStart);
  const limit = lineEnd < 0 || lineEnd > block.mdTo ? block.mdTo : lineEnd;
  // 行内列:跳过 md 行里的标记前缀,把 PM 列叠到行尾附近
  const line = map.md.slice(lineStart, limit);
  const needle = hit.text;
  const needleAt = needle ? line.indexOf(needle) : 0;
  const colBase = needleAt >= 0 ? needleAt : 0;
  return clamp(lineStart + colBase + col, lineStart, Math.max(lineStart, limit));
}

/**
 * 源码 offset → 排版 PM pos。
 * 按块表反查所属顶层块,再按该行文本匹配文本块。
 */
export function mdOffsetToPmPos(doc: PMNode, offset: number): number {
  const map = buildCursorMap(doc);
  if (!map.blocks.length) return 0;
  const clamped = clamp(offset, 0, map.md.length);
  const block = findBlockForMd(map, clamped);
  if (!block) return 0;

  const lineStart = mdLineStart(map.md, clamped);
  const lineEnd = map.md.indexOf("\n", lineStart);
  const line =
    lineEnd < 0 || lineEnd > block.mdTo
      ? map.md.slice(lineStart, block.mdTo).replace(/\n$/, "")
      : map.md.slice(lineStart, lineEnd);

  const needle = lineNeedle(line);
  // 同行多次出现时,按块内该 needle 的行序
  const contentMd = mdContentStart(map.md, block.mdFrom, block.mdTo);
  const chunk = map.md.slice(contentMd, block.mdTo);
  let occ = 0;
  if (needle) {
    let from = 0;
    const targetRel = Math.max(0, lineStart - contentMd);
    while (from <= targetRel) {
      const i = chunk.indexOf(needle, from);
      if (i < 0 || i > targetRel) break;
      if (i < targetRel) occ++;
      from = i + Math.max(1, needle.length);
    }
  }

  const base = pmPosForNeedle(doc, block, needle, occ);
  const col = Math.max(0, clamped - lineStart);
  // 去掉行首标记后的列更接近 PM 列
  const marker = line.length - needle.length;
  const pmCol = Math.max(0, col - Math.max(0, marker));
  return clamp(base + pmCol, base, base + Math.max(0, needle.length));
}

/** 源码文档中 offset 所在行的行首 offset(保行切换的稳定落点) */
export function mdLineStart(md: string, offset: number): number {
  const clamped = clamp(offset, 0, md.length);
  const i = md.lastIndexOf("\n", clamped - 1);
  return i < 0 ? 0 : i + 1;
}
