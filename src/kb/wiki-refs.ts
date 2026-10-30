/**
 * [[双链]] 目标解析与引用替换(纯函数,Rust kb.rs 同构)。
 * - resolveWikiTarget:点击跳转时 解析目标 → 文档相对路径(PRD §517 唯一名称匹配)
 * - updateWikiRefs:mock 后端 rename 时的引用联动(与 Rust rename_entry 行为一致)
 */

import type { TreeNode } from "./types";

export interface WikiDoc {
  /** 相对路径(含 .md) */
  path: string;
  /** 文档名(basename 去 .md) */
  name: string;
}

/** 树 → 文档平铺(输入 `[[` 检索列表/跳转解析用) */
export function flattenDocs(nodes: TreeNode[]): WikiDoc[] {
  const out: WikiDoc[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.isDir) walk(n.children);
      else out.push({ path: n.path, name: n.name });
    }
  };
  walk(nodes);
  return out;
}

/**
 * 解析双链目标 → 文档相对路径。
 * 路径写法(含 `/`)精确匹配;裸名匹配 basename,重名取第一个
 * (写入端对重名强制路径写法,手写撞名属边界情形)。
 * 未命中返回 null(调用方提示「目标不存在或已移动」)。
 */
export function resolveWikiTarget(docs: WikiDoc[], target: string): string | null {
  const t = target.trim();
  if (!t) return null;
  if (t.includes("/")) {
    const exact = docs.find((d) => d.path === t + ".md");
    return exact?.path ?? null;
  }
  return docs.find((d) => d.name === t)?.path ?? null;
}

/** 双链插入时的目标写法:重名文档强制路径写法(PRD §517) */
export function wikiTargetFor(docs: WikiDoc[], path: string): string {
  const name = path.replace(/\.md$/i, "").split("/").pop()!;
  const dup = docs.some((d) => d.name === name && d.path !== path);
  return dup ? path.replace(/\.md$/i, "") : name;
}

interface RefPatterns {
  /** 文档闭式 pattern(含 `[[` 前缀),长键在前 */
  patterns: [string, string][];
  /** 文件夹改名:(旧段, 新段),仅 [[…]] 区间内段级替换 */
  folder?: [string, string];
  /** 文件夹移动(改父目录):(旧路径前缀, 新路径前缀),仅重写以 `旧/` 开头的 [[目标]] */
  prefix?: [string, string];
}

/**
 * 引用联动替换(mock 后端用;与 Rust update_wikilink_refs 同构):
 * 返回新内容与替换次数。文件夹只动 [[目标]] 的路径段,别名与普通文本不受影响。
 */
export function updateWikiRefs(
  content: string,
  { patterns, folder, prefix }: RefPatterns,
): { content: string; count: number } {
  let next = content;
  let count = 0;
  for (const [from, to] of patterns) {
    count += next.split(from).length - 1;
    next = next.split(from).join(to);
  }
  if (folder) {
    const [oldSeg, newSeg] = folder;
    let out = "";
    let rest = next;
    while (true) {
      const start = rest.indexOf("[[");
      if (start === -1) break;
      out += rest.slice(0, start + 2);
      const tail = rest.slice(start + 2);
      const end = tail.indexOf("]]");
      if (end === -1) {
        out += tail;
        rest = "";
        break;
      }
      const inner = tail.slice(0, end);
      const bar = inner.indexOf("|");
      const target = bar === -1 ? inner : inner.slice(0, bar);
      const alias = bar === -1 ? "" : inner.slice(bar);
      // 单段 target([[folder]])指向名为 folder 的文档,不是文件夹 → 不动;
      // 多段路径里的段命中文件夹名才替换
      const segs = target.split("/");
      const replaced =
        segs.length > 1
          ? segs
              .map((s) => {
                if (s === oldSeg) {
                  count += 1;
                  return newSeg;
                }
                return s;
              })
              .join("/")
          : target;
      out += replaced + alias + "]]";
      rest = tail.slice(end + 2);
    }
    next = out + rest;
  }
  if (prefix) {
    const [oldP, newP] = prefix;
    let out = "";
    let rest = next;
    while (true) {
      const start = rest.indexOf("[[");
      if (start === -1) break;
      out += rest.slice(0, start + 2);
      const tail = rest.slice(start + 2);
      const end = tail.indexOf("]]");
      if (end === -1) {
        out += tail;
        rest = "";
        break;
      }
      const inner = tail.slice(0, end);
      const bar = inner.indexOf("|");
      const target = bar === -1 ? inner : inner.slice(0, bar);
      const alias = bar === -1 ? "" : inner.slice(bar);
      // 名字不变:仅 target 以 `旧路径/` 开头才改前缀(段名替换会误伤别处的同名段)
      if (target.startsWith(oldP + "/")) {
        count += 1;
        out += newP + target.slice(oldP.length) + alias + "]]";
      } else {
        out += target + alias + "]]";
      }
      rest = tail.slice(end + 2);
    }
    next = out + rest;
  }
  return { content: next, count };
}

/** move(改父目录、名字不变)时构造引用替换规则(与 Rust move_entry 一致) */
export function movePatternsFor(rel: string, newRel: string, isDir: boolean): RefPatterns {
  if (isDir) return { patterns: [], prefix: [rel, newRel] };
  const oldStem = rel.replace(/\.md$/i, "");
  const newStem = newRel.replace(/\.md$/i, "");
  // 根级文档的路径写法即裸名,移动后裸名仍解析 → 无需改写
  if (!oldStem.includes("/")) return { patterns: [] };
  return {
    patterns: [
      [`[[${oldStem}]]`, `[[${newStem}]]`],
      [`[[${oldStem}|`, `[[${newStem}|`],
    ],
  };
}

/** rename 时构造引用替换规则(与 Rust rename_entry 的 pattern 构造一致) */
export function refPatternsFor(
  rel: string,
  newRel: string,
  isDir: boolean,
): RefPatterns {
  if (isDir) return { patterns: [], folder: [rel, newRel] };
  const oldStem = rel.replace(/\.md$/i, "");
  const newStem = newRel.replace(/\.md$/i, "");
  const patterns: [string, string][] = [
    [`[[${oldStem}]]`, `[[${newStem}]]`],
    [`[[${oldStem}|`, `[[${newStem}|`],
  ];
  const oldName = oldStem.split("/").pop()!;
  const newName = newStem.split("/").pop()!;
  if (oldName !== oldStem) {
    patterns.push([`[[${oldName}]]`, `[[${newName}]]`]);
    patterns.push([`[[${oldName}|`, `[[${newName}|`]);
  }
  return { patterns };
}
