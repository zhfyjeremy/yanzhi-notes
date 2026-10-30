/**
 * .yanzhi/meta.json 读写与派生(PRD 9.1):单文件按相对路径 key,
 * 只存 UI 偏好(排序/折叠/置顶),删了不影响正文。
 * 写入与文档保存解耦:meta 写失败只丢排序偏好,不阻塞任何操作。
 */

import type { TreeNode } from "./types";

export interface DocMeta {
  sortIndex?: number;
  pinned?: boolean;
}
export interface FolderMeta {
  sortIndex?: number;
  collapsed?: boolean;
}
export interface KbMeta {
  version: number;
  docs: Record<string, DocMeta>;
  folders: Record<string, FolderMeta>;
}

export const EMPTY_META: KbMeta = { version: 1, docs: {}, folders: {} };

/** 容错解析:损坏/缺失回空 meta(索引重建口径,不静默丢文档只丢偏好) */
export function parseMeta(raw: string): KbMeta {
  try {
    const m = JSON.parse(raw) as Partial<KbMeta>;
    if (!m || typeof m !== "object") return EMPTY_META;
    return {
      version: typeof m.version === "number" ? m.version : 1,
      docs: m.docs && typeof m.docs === "object" ? m.docs : {},
      folders: m.folders && typeof m.folders === "object" ? m.folders : {},
    };
  } catch {
    return EMPTY_META;
  }
}

export function serializeMeta(meta: KbMeta): string {
  return JSON.stringify(meta);
}

const sortIndexOf = (node: TreeNode, meta: KbMeta): number | undefined =>
  node.isDir ? meta.folders[node.path]?.sortIndex : meta.docs[node.path]?.sortIndex;

/**
 * 递归排序(纯函数):有 sortIndex 的在前按 index 升序,无 meta 的排后按名称;
 * 目录树显示顺序唯一出处(Rust scan_tree 只给名称序兜底)。
 */
export function sortTree(nodes: TreeNode[], meta: KbMeta): TreeNode[] {
  const withChildren = nodes.map((n) => (n.isDir ? { ...n, children: sortTree(n.children, meta) } : n));
  return withChildren.sort((a, b) => {
    const ai = sortIndexOf(a, meta);
    const bi = sortIndexOf(b, meta);
    if (ai != null && bi != null) return ai - bi || a.name.localeCompare(b.name);
    if (ai != null) return -1;
    if (bi != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** 一组兄弟的新顺序 → 重写整组 sortIndex(0..n-1,全量覆盖避免稀疏漂移) */
export function applySiblingOrder(meta: KbMeta, parentRel: string, orderedPaths: string[]): KbMeta {
  const next: KbMeta = { version: meta.version, docs: { ...meta.docs }, folders: { ...meta.folders } };
  const prefix = parentRel ? parentRel + "/" : "";
  orderedPaths.forEach((p, i) => {
    const rel = p.startsWith(prefix) ? p : prefix + p;
    if (rel.endsWith(".md")) next.docs[rel] = { ...next.docs[rel], sortIndex: i };
    else next.folders[rel] = { ...next.folders[rel], sortIndex: i };
  });
  return next;
}

/** 新建条目落尾:当前兄弟最大 sortIndex + 1(无序时 0) */
export function nextSortIndex(meta: KbMeta, siblings: TreeNode[]): number {
  let max = -1;
  for (const s of siblings) {
    const i = sortIndexOf(s, meta);
    if (i != null && i > max) max = i;
  }
  return max + 1;
}

/** 移动落尾:改写 sortIndex 为目标组最大值 + 1(清掉旧组继承的索引,避免错位) */
export function moveMetaToTail(meta: KbMeta, newRel: string, destFolderRel: string): KbMeta {
  const next: KbMeta = { version: meta.version, docs: { ...meta.docs }, folders: { ...meta.folders } };
  const pre = destFolderRel ? destFolderRel + "/" : "";
  let max = -1;
  for (const record of [next.docs, next.folders]) {
    for (const [k, v] of Object.entries(record)) {
      if (k === newRel) continue;
      const atDest = pre ? k.startsWith(pre) : !k.includes("/");
      if (atDest && v.sortIndex != null && v.sortIndex > max) max = v.sortIndex;
    }
  }
  if (newRel.endsWith(".md")) next.docs[newRel] = { ...next.docs[newRel], sortIndex: max + 1 };
  else next.folders[newRel] = { ...next.folders[newRel], sortIndex: max + 1 };
  return next;
}

/** 重命名迁移 meta key:文档单键;文件夹自身 + 前缀重写 */
export function renameMetaKeys(meta: KbMeta, oldRel: string, newRel: string, isDir: boolean): KbMeta {
  const next: KbMeta = { version: meta.version, docs: { ...meta.docs }, folders: { ...meta.folders } };
  const remap = <T>(record: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k === oldRel) out[newRel] = v;
      else if (isDir && k.startsWith(oldRel + "/")) out[newRel + k.slice(oldRel.length)] = v;
      else out[k] = v;
    }
    return out;
  };
  if (isDir) {
    next.folders = remap(meta.folders);
    next.docs = remap(meta.docs);
  } else {
    next.docs = remap(meta.docs);
  }
  return next;
}

/** 删除(移入回收站)清 key:文档单键;文件夹前缀清 */
export function removeMetaKeys(meta: KbMeta, rel: string, isDir: boolean): KbMeta {
  const next: KbMeta = { version: meta.version, docs: { ...meta.docs }, folders: { ...meta.folders } };
  if (isDir) {
    delete next.folders[rel];
    for (const k of Object.keys(next.docs)) if (k === rel || k.startsWith(rel + "/")) delete next.docs[k];
    for (const k of Object.keys(next.folders)) if (k.startsWith(rel + "/")) delete next.folders[k];
  } else {
    delete next.docs[rel];
  }
  return next;
}

export function setCollapsed(meta: KbMeta, folderRel: string, collapsed: boolean): KbMeta {
  return {
    ...meta,
    folders: { ...meta.folders, [folderRel]: { ...meta.folders[folderRel], collapsed } },
  };
}

/** 初始折叠集合(开库恢复 5.1「折叠状态存 meta」) */
export function collapsedFolders(meta: KbMeta): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(meta.folders)) if (v.collapsed) out.add(k);
  return out;
}

/* ---------------- 未识别条目(外部改名/移动/删除后的失联 meta,5.2.1) ---------------- */

/** 失联 meta 条目:key 不在当前树;kind 与所在 record 一致 */
export interface OrphanMetaEntry {
  /** 失联的旧相对路径 */
  path: string;
  isDir: boolean;
  /** 曾记录的偏好(排序/折叠/置顶),列表展示用 */
  meta: DocMeta | FolderMeta;
}

/** 扫描失联条目;不做静默丢弃(5.2-4) */
export function findOrphanMeta(meta: KbMeta, tree: TreeNode[]): OrphanMetaEntry[] {
  const docPaths = new Set<string>();
  const dirPaths = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      (n.isDir ? dirPaths : docPaths).add(n.path);
      if (n.isDir) walk(n.children);
    }
  };
  walk(tree);
  const out: OrphanMetaEntry[] = [];
  for (const [k, v] of Object.entries(meta.docs)) {
    if (!docPaths.has(k)) out.push({ path: k, isDir: false, meta: v });
  }
  for (const [k, v] of Object.entries(meta.folders)) {
    if (!dirPaths.has(k)) out.push({ path: k, isDir: true, meta: v });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 认领合并:失联条目的偏好转移到库内真实路径(同类型;逐条,不级联子条目 —— 批量是 V3) */
export function claimMetaKey(
  meta: KbMeta,
  oldRel: string,
  targetRel: string,
  isDir: boolean,
): KbMeta {
  const next: KbMeta = { version: meta.version, docs: { ...meta.docs }, folders: { ...meta.folders } };
  if (isDir) {
    if (next.folders[oldRel]) {
      next.folders[targetRel] = { ...next.folders[targetRel], ...next.folders[oldRel] };
      delete next.folders[oldRel];
    }
  } else if (next.docs[oldRel]) {
    next.docs[targetRel] = { ...next.docs[targetRel], ...next.docs[oldRel] };
    delete next.docs[oldRel];
  }
  return next;
}

/** 丢弃单条失联 meta */
export function discardMetaKey(meta: KbMeta, oldRel: string, isDir: boolean): KbMeta {
  const next: KbMeta = { version: meta.version, docs: { ...meta.docs }, folders: { ...meta.folders } };
  if (isDir) delete next.folders[oldRel];
  else delete next.docs[oldRel];
  return next;
}
