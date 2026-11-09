/**
 * 文档位置面包屑:只从当前相对路径派生,不写 meta / Markdown。
 * 根节点由 UI 单独补,文件夹段给出可定位目录树的 path。
 */

export interface FolderBreadcrumb {
  label: string;
  /** 相对知识库根的文件夹路径;可空的前缀不重复生成 */
  path: string;
}

export function folderBreadcrumbs(docRel: string): FolderBreadcrumb[] {
  const parts = docRel
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (parts.length <= 1) return [];
  const folders = parts.slice(0, -1);
  const out: FolderBreadcrumb[] = [];
  for (let i = 0; i < folders.length; i += 1) {
    out.push({
      label: folders[i],
      path: folders.slice(0, i + 1).join("/"),
    });
  }
  return out;
}
