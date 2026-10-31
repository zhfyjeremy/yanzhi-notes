import type { TreeNode } from "./types";

export interface BatchResult {
  ok: number;
  failed: number;
  errors: string[];
}

export interface BatchRenameOptions {
  find: string;
  replace: string;
  prefix: string;
  suffix: string;
}

export interface BatchRenameItem {
  rel: string;
  newName: string;
  newRel: string;
}

export interface BatchRenamePlan {
  items: BatchRenameItem[];
  errors: string[];
}

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g;

export function docStem(rel: string): string {
  return (rel.split("/").pop() ?? rel).replace(/\.md$/i, "");
}

export function allTreePaths(tree: TreeNode[]): Set<string> {
  const out = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      out.add(n.path);
      if (n.isDir) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** 批量改名只处理 Markdown 文件名,不改变所在文件夹;返回预览与阻断错误。 */
export function planBatchRename(
  rels: string[],
  tree: TreeNode[],
  opts: BatchRenameOptions,
): BatchRenamePlan {
  const existing = allTreePaths(tree);
  const targets = new Set<string>();
  const items: BatchRenameItem[] = [];
  const errors: string[] = [];

  for (const rel of rels) {
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const original = docStem(rel);
    let stem = opts.find ? original.split(opts.find).join(opts.replace) : original;
    stem = `${opts.prefix}${stem}${opts.suffix}`.replace(ILLEGAL_NAME_CHARS, "").trim().replace(/\.+$/, "");
    if (!stem) {
      errors.push(`「${rel}」改名后为空`);
      continue;
    }
    const newRel = `${parent ? parent + "/" : ""}${stem}.md`;
    if (newRel !== rel && existing.has(newRel)) {
      errors.push(`「${rel}」的目标「${newRel}」已存在`);
    }
    if (targets.has(newRel)) {
      errors.push(`多个条目会重名为「${newRel}」`);
    }
    targets.add(newRel);
    items.push({ rel, newName: stem, newRel });
  }

  return { items, errors: [...new Set(errors)] };
}

export function parseBatchTags(raw: string): string[] {
  const out: string[] = [];
  for (const value of raw.split(/[,，;；\n]/)) {
    const tag = value.trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * 批量恢复的选中集可能同时包含文件夹与其子项。
 * 恢复父文件夹时子项已随之恢复,因此执行层只保留最上层路径。
 */
export function minimalRestoreRoots(paths: string[]): string[] {
  return paths.filter(
    (path) => !paths.some((parent) => parent !== path && path.startsWith(parent + "/")),
  );
}

export function foldersOf(tree: TreeNode[]): { path: string; label: string }[] {
  const out: { path: string; label: string }[] = [{ path: "", label: "知识库根目录" }];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (!n.isDir) continue;
      out.push({ path: n.path, label: `${"　".repeat(depth)}${n.name}` });
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 0);
  return out;
}
