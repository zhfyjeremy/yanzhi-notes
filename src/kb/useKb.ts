import { useCallback, useEffect, useRef, useState } from "react";
import { KbConflictError, KbIsYanzhiError, KbNotEmptyError, kbBackend } from "./backend";
import type { RecentState, TreeNode, TrashEntry } from "./types";
import { WikiRefIndex, type BacklinkRow } from "./backlinks";
import { flattenDocs, resolveWikiTarget } from "./wiki-refs";
import {
  applySiblingOrder,
  claimMetaKey,
  collapsedFolders,
  discardMetaKey,
  EMPTY_META,
  findOrphanMeta,
  moveMetaToTail,
  nextSortIndex,
  parseMeta,
  removeMetaKeys,
  renameMetaKeys,
  serializeMeta,
  setCollapsed as metaSetCollapsed,
  sortTree,
  type KbMeta,
  type OrphanMetaEntry,
} from "./meta";
import { KbSearchIndex, type SearchHit } from "./search";

/**
 * 知识库状态中枢(M3):库根/目录树/当前文档/自动保存/浏览历史,
 * 外加 meta(排序/折叠)、搜索索引、文件监听、回收站、导入导出。
 * 自动保存(PRD 5.2.5):编辑器回调(自身已 300ms 去抖)后 2s 落盘,
 * 切换文档/关库前冲刷;保存失败仅状态栏提示,不阻塞编辑。
 */

const AUTOSAVE_MS = 2000;
/** 自身写盘后的监听静默窗(写 doc/meta/assets 都会触发 notify) */
const SELF_WRITE_QUIET_MS = 1500;

export type SaveState = "saved" | "dirty" | "saving" | "error";

function findFolder(nodes: TreeNode[], rel: string): TreeNode[] {
  if (!rel) return nodes;
  for (const n of nodes) {
    if (n.path === rel) return n.children;
    if (rel.startsWith(n.path + "/")) {
      const inner = findFolder(n.children, rel);
      if (inner.length) return inner;
    }
  }
  return [];
}

function firstDoc(nodes: TreeNode[]): string | null {
  for (const n of nodes) {
    if (!n.isDir) return n.path;
    const inner = firstDoc(n.children);
    if (inner) return inner;
  }
  return null;
}

export function useKb() {
  const [booted, setBooted] = useState(false);
  const [kbRoot, setKbRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string>("# 未命名文档\n");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState("");
  const [recent, setRecent] = useState<RecentState>({ last: null, recent: [] });
  const [bootError, setBootError] = useState<string | null>(null);
  // 浏览历史(双链跳转/树点击的前进后退):栈存 ref,can* 存 state 驱动按钮禁用态
  const backRef = useRef<string[]>([]);
  const frontRef = useRef<string[]>([]);
  const [canBack, setCanBack] = useState(false);
  const [canFront, setCanFront] = useState(false);
  // meta(排序/折叠)与搜索索引
  const metaRef = useRef<KbMeta>(EMPTY_META);
  const treeRef = useRef<TreeNode[]>([]);
  treeRef.current = tree;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const searchRef = useRef(new KbSearchIndex());
  const [indexReady, setIndexReady] = useState(false);
  // 未识别条目(5.2.1):外部改名/移动/删除导致的失联 meta;只在开库/外部变动/整理动作后重扫
  const [orphanMeta, setOrphanMeta] = useState<OrphanMetaEntry[]>([]);
  // [[出链]]索引(反向链接 5.4-2):与搜索索引同点位维护;refsVersion 驱动面板重算
  const wikiRefIdx = useRef(new WikiRefIndex());
  const [refsVersion, setRefsVersion] = useState(0);
  const bumpRefs = () => setRefsVersion((v) => (v + 1) % 1_000_000);
  // 外部改动(5.2.6):当前文档在磁盘被改且本地有未保存 → App 弹「保留我的/载入磁盘版本」
  const [externalChange, setExternalChange] = useState<string | null>(null);

  const dirtyRef = useRef<string | null>(null); // 未落盘的最新内容
  const saveTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  rootRef.current = kbRoot;
  pathRef.current = currentPath;
  const selfWriteUntil = useRef(0);
  const fsUnRef = useRef<(() => void) | null>(null);
  const metaWriteTimer = useRef<number | undefined>(undefined);
  const indexRebuildTimer = useRef<number | undefined>(undefined);

  const markSelfWrite = () => {
    selfWriteUntil.current = Date.now() + SELF_WRITE_QUIET_MS;
  };

  /** meta 落盘(去抖;写失败只丢偏好不阻塞,9.1.4) */
  const persistMeta = useCallback(() => {
    window.clearTimeout(metaWriteTimer.current);
    metaWriteTimer.current = window.setTimeout(() => {
      const root = rootRef.current;
      if (root) kbBackend.writeMeta(root, serializeMeta(metaRef.current)).catch(() => {});
    }, 300);
  }, []);

  const syncNav = () => {
    setCanBack(backRef.current.length > 0);
    setCanFront(frontRef.current.length > 0);
  };

  const flushSave = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const content = dirtyRef.current;
    if (content == null) return;
    const root = rootRef.current;
    const rel = pathRef.current;
    if (!root || !rel) return;
    dirtyRef.current = null;
    setSaveState("saving");
    try {
      markSelfWrite();
      await kbBackend.writeDoc(root, rel, content);
      setSaveState("saved");
      searchRef.current.add(rel, content); // 保存时增量更新索引(5.5.3)
      wikiRefIdx.current.update(rel, content); // 出链随内容变(反向链接即时反映)
      bumpRefs();
      const now = new Date();
      setSavedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
      );
    } catch (e) {
      // 落盘失败:内容留在 dirty,下轮再试
      dirtyRef.current = content;
      setSaveState("error");
      console.error("[kb] 自动保存失败:", e);
    }
  }, []);

  /** 编辑器内容变更(编辑器内已 300ms 去抖):挂起 2s 落盘 */
  const onMarkdownChange = useCallback(
    (md: string) => {
      dirtyRef.current = md;
      setSaveState("dirty");
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushSave(), AUTOSAVE_MS);
    },
    [flushSave],
  );

  /** 当前最新正文(dirty 优先;导出/复制等即时消费用,不等落盘) */
  const getMarkdownNow = useCallback((): string => dirtyRef.current ?? markdown, [markdown]);

  /** 读取并呈现文档(不动历史栈);openDoc/navBack/navForward 共用。
   *  读取失败(被外部删除/权限)置 docError 供上层 toast,返回 false */
  const [docError, setDocError] = useState<string | null>(null);
  const loadDoc = useCallback(async (rel: string): Promise<boolean> => {
    const root = rootRef.current;
    if (!root) return false;
    try {
      const content = await kbBackend.readDoc(root, rel);
      dirtyRef.current = null;
      setCurrentPath(rel);
      setMarkdown(content);
      setSaveState("saved");
      setDocError(null);
      if (searchRef.current.size > 0) searchRef.current.add(rel, content);
      wikiRefIdx.current.update(rel, content);
      kbBackend.setLastDoc(rel).catch(() => {});
      return true;
    } catch (e) {
      console.error("[kb] 打开文档失败:", e);
      setDocError(rel);
      return false;
    }
  }, []);

  /** 打开文档(入历史栈);读取失败不动历史栈(否则后退栈被无效项污染) */
  const openDoc = useCallback(
    async (rel: string) => {
      const cur = pathRef.current;
      if (rel === cur) return;
      await flushSave(); // 切换前冲刷上一篇
      if (!(await loadDoc(rel))) return;
      if (cur) backRef.current = [...backRef.current, cur];
      frontRef.current = [];
      syncNav();
    },
    [flushSave, loadDoc],
  );

  const navBack = useCallback(async () => {
    const back = backRef.current;
    if (!back.length) return;
    const cur = pathRef.current;
    const target = back[back.length - 1];
    await flushSave();
    if (target !== pathRef.current && !(await loadDoc(target))) return; // 失败:栈保持原状
    backRef.current = back.slice(0, -1);
    if (cur) frontRef.current = [cur, ...frontRef.current];
    syncNav();
  }, [flushSave, loadDoc]);

  const navForward = useCallback(async () => {
    const front = frontRef.current;
    if (!front.length) return;
    const cur = pathRef.current;
    const target = front[0];
    await flushSave();
    if (target !== pathRef.current && !(await loadDoc(target))) return;
    frontRef.current = front.slice(1);
    if (cur) backRef.current = [...backRef.current, cur];
    syncNav();
  }, [flushSave, loadDoc]);

  /** 双链跳转:解析目标 → 打开;未命中返回 null(调用方提示「目标不存在或已移动」) */
  const openWikiLink = useCallback(
    async (target: string): Promise<string | null> => {
      const rel = resolveWikiTarget(flattenDocs(treeRef.current), target);
      if (!rel) return null;
      await openDoc(rel);
      return rel;
    },
    [openDoc],
  );

  const refreshTree = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      const nodes = await kbBackend.scanTree(root);
      const sorted = sortTree(nodes, metaRef.current);
      // 同步更新 treeRef:外部监听链路 .then(refreshOrphans) 可能先于重渲染执行
      treeRef.current = sorted;
      setTree(sorted);
    } catch (e) {
      console.error("[kb] 扫描目录失败:", e);
    }
  }, []);

  /* ---------------- 未识别条目整理(5.2.1) ---------------- */

  /** 失联 meta 扫描:开库 / 外部变动落定 / 整理动作后调用 */
  const refreshOrphans = useCallback(() => {
    setOrphanMeta(findOrphanMeta(metaRef.current, treeRef.current));
  }, []);

  /** 认领合并:偏好转移到真实路径,树序即时生效 */
  const claimOrphan = useCallback(
    (entry: OrphanMetaEntry, targetRel: string) => {
      metaRef.current = claimMetaKey(metaRef.current, entry.path, targetRel, entry.isDir);
      persistMeta();
      const sorted = sortTree(treeRef.current, metaRef.current);
      treeRef.current = sorted;
      setTree(sorted);
      setOrphanMeta(findOrphanMeta(metaRef.current, sorted));
    },
    [persistMeta],
  );

  /** 丢弃单条失联 meta(逐条;批量是 V3) */
  const discardOrphan = useCallback(
    (entry: OrphanMetaEntry) => {
      metaRef.current = discardMetaKey(metaRef.current, entry.path, entry.isDir);
      persistMeta();
      setOrphanMeta(findOrphanMeta(metaRef.current, treeRef.current));
    },
    [persistMeta],
  );

  /* ---------------- 搜索(5.5) ---------------- */

  /** 回收站出链刷新(boot/删除/恢复/彻底删除/清空后;反向链接「已删除」来源) */
  const refreshTrashRefs = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      wikiRefIdx.current.buildTrash(await kbBackend.readAllTrashDocs(root));
      bumpRefs();
    } catch (e) {
      console.error("[kb] 读取回收站引用失败:", e);
    }
  }, []);

  const rebuildIndex = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    try {
      const docs = await kbBackend.readAllDocs(root);
      searchRef.current.build(docs);
      wikiRefIdx.current.build(docs); // 出链索引与搜索索引同源重建
      setIndexReady(true);
      void refreshTrashRefs();
    } catch (e) {
      console.error("[kb] 重建搜索索引失败:", e);
    }
  }, [refreshTrashRefs]);

  const search = useCallback((q: string): SearchHit[] => {
    if (!indexReady) return [];
    return searchRef.current.search(q);
  }, [indexReady]);

  /* ---------------- 文件监听(5.2.6) ---------------- */

  /** 外部改当前文档且本地干净 → 静默重载 */
  const reloadCurrent = useCallback(async () => {
    const cur = pathRef.current;
    if (cur) await loadDoc(cur);
  }, [loadDoc]);

  const scheduleIndexRebuild = useCallback(() => {
    window.clearTimeout(indexRebuildTimer.current);
    indexRebuildTimer.current = window.setTimeout(() => void rebuildIndex(), 1500);
  }, [rebuildIndex]);

  useEffect(() => {
    if (!kbRoot) return;
    let alive = true;
    void kbBackend.listenFsEvent((paths) => {
      if (!alive || Date.now() < selfWriteUntil.current) return;
      void refreshTree().then(refreshOrphans); // 外部改名/移动/删除 → 重扫失联 meta
      const cur = pathRef.current;
      if (cur && paths.includes(cur)) {
        if (dirtyRef.current != null) setExternalChange(cur);
        else void reloadCurrent();
        return;
      }
      if (paths.some((p) => p.endsWith(".md"))) scheduleIndexRebuild();
    }).then((un) => {
      if (!alive) {
        un();
        return;
      }
      fsUnRef.current?.();
      fsUnRef.current = un;
    });
    return () => {
      alive = false;
    };
    // 换库重订阅(旧 un 在新 then 里先退订)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbRoot]);

  /** 外部改动弹窗结果(保留我的 / 载入磁盘版本) */
  const resolveExternal = useCallback(
    async (keep: boolean) => {
      setExternalChange(null);
      if (!keep) await reloadCurrent(); // 载入磁盘版:丢弃 dirty 重读
      // 保留我的:继续编辑,下一轮自动保存会覆盖磁盘版本
    },
    [reloadCurrent],
  );

  /* ---------------- 开库/关库 ---------------- */

  const enterKb = useCallback(
    async (root: string) => {
      backRef.current = [];
      frontRef.current = [];
      syncNav();
      await kbBackend.setRecent(root);
      setRecent(await kbBackend.getRecent());
      setKbRoot(root);
      rootRef.current = root;
      // meta 先于树加载:排序/折叠要参与首帧渲染
      metaRef.current = parseMeta(await kbBackend.readMeta(root).catch(() => ""));
      setCollapsed(collapsedFolders(metaRef.current));
      const nodes = await kbBackend.scanTree(root).catch(() => [] as TreeNode[]);
      const sorted = sortTree(nodes, metaRef.current);
      treeRef.current = sorted;
      setTree(sorted);
      setOrphanMeta(findOrphanMeta(metaRef.current, sorted));
      // 搜索索引后台构建,不阻塞首帧(5.5.3)
      setIndexReady(false);
      void rebuildIndex();
      // 打开上次文档(5.0.4);无效则第一篇;空库给空白草稿
      const lastDoc = (await kbBackend.getRecent()).lastDoc;
      const firstDoc_ = firstDoc(nodes);
      if (lastDoc && lastDoc !== pathRef.current) {
        try {
          await openDoc(lastDoc);
          return;
        } catch {
          /* 上次文档已不存在 → 回退第一篇 */
        }
      }
      if (firstDoc_) {
        await openDoc(firstDoc_);
      } else {
        setCurrentPath(null);
        setMarkdown("# 未命名文档\n");
      }
    },
    [openDoc, rebuildIndex],
  );

  const openKbAt = useCallback(
    async (root: string) => {
      setBootError(null);
      try {
        await kbBackend.openKb(root);
        await enterKb(root);
      } catch (e) {
        console.error("[kb] 打开知识库失败:", e);
        return `无法打开「${root}」:${String(e)}`;
      }
      return null;
    },
    [enterKb],
  );

  const createKbAt = useCallback(
    async (root: string, force = false) => {
      setBootError(null);
      try {
        if (force) {
          await kbBackend.forceCreateKb(root);
        } else {
          await kbBackend.createKb(root);
        }
      } catch (e) {
        if (e instanceof KbNotEmptyError) return "NOT_EMPTY" as const;
        if (e instanceof KbIsYanzhiError) return "IS_YANZHI" as const;
        console.error("[kb] 新建知识库失败:", e);
        return `无法在此创建:${String(e)}` as const;
      }
      await enterKb(root);
      return null;
    },
    [enterKb],
  );

  /** 新建流程结果:非空/已是砚知库把 root 带回来,供确认或引导改用「打开」 */
  const pickAndCreate = useCallback(async (): Promise<
    null | { kind: "not-empty" | "is-yanzhi"; root: string } | { kind: "error"; message: string }
  > => {
    const dir = await kbBackend.pickFolder();
    if (!dir) return null;
    const result = await createKbAt(dir);
    if (result === "NOT_EMPTY") return { kind: "not-empty", root: dir };
    if (result === "IS_YANZHI") return { kind: "is-yanzhi", root: dir };
    if (result) return { kind: "error", message: result };
    return null;
  }, [createKbAt]);

  const pickAndOpen = useCallback(async () => {
    const dir = await kbBackend.pickFolder();
    if (!dir) return null;
    return openKbAt(dir);
  }, [openKbAt]);

  const closeKb = useCallback(async () => {
    await flushSave();
    fsUnRef.current?.();
    fsUnRef.current = null;
    setKbRoot(null);
    rootRef.current = null;
    setTree([]);
    setCurrentPath(null);
    setOrphanMeta([]);
  }, [flushSave]);

  /* ---------------- 增删改(目录树操作) ---------------- */

  const createDoc = useCallback(
    async (folderRel: string, title: string) => {
      const root = rootRef.current;
      if (!root) return;
      try {
        markSelfWrite();
        const rel = await kbBackend.createDoc(root, folderRel, title);
        // 新条目排在所在文件夹末尾(meta 记序,树序唯一出处)
        metaRef.current = {
          ...metaRef.current,
          docs: {
            ...metaRef.current.docs,
            [rel]: { sortIndex: nextSortIndex(metaRef.current, findFolder(treeRef.current, folderRel)) },
          },
        };
        persistMeta();
        searchRef.current.add(rel, `# ${title}\n`);
        wikiRefIdx.current.update(rel, `# ${title}\n`); // 新文档无出链,占位保持索引与树一致
        await refreshTree();
        await openDoc(rel);
      } catch (e) {
        console.error("[kb] 新建文档失败:", e);
      }
    },
    [openDoc, persistMeta, refreshTree],
  );

  const createFolder = useCallback(
    async (folderRel: string, name: string) => {
      const root = rootRef.current;
      if (!root) return;
      try {
        markSelfWrite();
        const rel = await kbBackend.createFolder(root, folderRel, name);
        metaRef.current = {
          ...metaRef.current,
          folders: {
            ...metaRef.current.folders,
            [rel]: { sortIndex: nextSortIndex(metaRef.current, findFolder(treeRef.current, folderRel)) },
          },
        };
        persistMeta();
        await refreshTree();
      } catch (e) {
        console.error("[kb] 新建文件夹失败:", e);
      }
    },
    [persistMeta, refreshTree],
  );

  const removeEntry = useCallback(
    async (rel: string) => {
      const root = rootRef.current;
      if (!root) return;
      await flushSave();
      try {
        markSelfWrite();
        await kbBackend.moveToTrash(root, rel);
        metaRef.current = removeMetaKeys(metaRef.current, rel, !(rel.endsWith(".md")));
        persistMeta();
        for (const p of flattenDocs(treeRef.current)) {
          if (p.path === rel || p.path.startsWith(rel + "/")) {
            searchRef.current.remove(p.path);
            wikiRefIdx.current.remove(p.path);
          }
        }
        void refreshTrashRefs(); // 刚入站的文档转为「已删除」引用来源
        await refreshTree();
        // 删的是当前文档或其祖先文件夹 → 打开树上第一篇
        const cur = pathRef.current;
        if (cur === rel || (cur?.startsWith(rel + "/") ?? false)) {
          const nodes = await kbBackend.scanTree(root);
          const first = firstDoc(nodes);
          if (first) await openDoc(first);
          else {
            setCurrentPath(null);
            setMarkdown("# 未命名文档\n");
          }
        }
      } catch (e) {
        console.error("[kb] 删除失败:", e);
      }
    },
    [flushSave, openDoc, persistMeta, refreshTree],
  );

  /** 重命名 + 双链引用联动(5.1):flushSave 后由后端扫全库替换;
   * 当前文档的引用被改写时重载编辑器内容。文件夹改名会前缀重写
   * 当前文档路径与前进/后退历史,避免旧路径失效。 */
  const renameEntry = useCallback(
    async (rel: string, newTitle: string) => {
      const root = rootRef.current;
      if (!root) return null;
      await flushSave(); // 磁盘替换引用前,当前文档最新内容必须先落盘
      try {
        markSelfWrite();
        const result = await kbBackend.renameEntry(root, rel, newTitle);
        metaRef.current = renameMetaKeys(metaRef.current, rel, result.newPath, !rel.endsWith(".md"));
        persistMeta();
        // 索引 key 迁移:旧路径条目挪到新路径(内容从索引外重读太贵,直接重建该条)
        const affected = flattenDocs(treeRef.current)
          .map((d) => d.path)
          .filter((p) => p === rel || (!rel.endsWith(".md") && p.startsWith(rel + "/")));
        for (const p of affected) searchRef.current.remove(p);
        scheduleIndexRebuild();
        // 路径前缀重写:自身改名,或所在文件夹(含祖先)改名
        const rewrite = (p: string) =>
          p === rel
            ? result.newPath
            : p.startsWith(rel + "/")
              ? result.newPath + p.slice(rel.length)
              : p;
        const cur = pathRef.current;
        const newCur = cur ? rewrite(cur) : null;
        if (newCur && newCur !== cur) setCurrentPath(newCur);
        backRef.current = backRef.current.map(rewrite);
        frontRef.current = frontRef.current.map(rewrite);
        await refreshTree();
        if (newCur && result.updatedFiles.includes(newCur)) {
          const content = await kbBackend.readDoc(root, newCur).catch(() => null);
          if (content != null) {
            dirtyRef.current = null;
            setMarkdown(content);
            setSaveState("saved");
          }
        }
        return result;
      } catch (e) {
        console.error("[kb] 重命名失败:", e);
        return null;
      }
    },
    [flushSave, persistMeta, refreshTree, scheduleIndexRebuild],
  );

  /* ---------------- 移动(拖拽调整层级,5.1) ---------------- */

  const moveEntry = useCallback(
    async (srcRel: string, destFolderRel: string, orderedPaths?: string[]) => {
      const root = rootRef.current;
      if (!root) return null;
      await flushSave();
      try {
        markSelfWrite();
        const result = await kbBackend.moveEntry(root, srcRel, destFolderRel);
        if (result.newPath === srcRel) return result; // 已在目标位置,幂等
        const isDir = !srcRel.endsWith(".md");
        metaRef.current = renameMetaKeys(metaRef.current, srcRel, result.newPath, isDir);
        // 跨组 before/after 带 orderedPaths → 按落位;into → 目标组落尾
        metaRef.current =
          orderedPaths && orderedPaths.length
            ? applySiblingOrder(metaRef.current, destFolderRel, orderedPaths)
            : moveMetaToTail(metaRef.current, result.newPath, destFolderRel);
        // 折叠状态 key 跟随路径迁移
        setCollapsed((prev) => {
          const next = new Set<string>();
          for (const k of prev) {
            next.add(
              k === srcRel
                ? result.newPath
                : k.startsWith(srcRel + "/")
                  ? result.newPath + k.slice(srcRel.length)
                  : k,
            );
          }
          return next;
        });
        persistMeta();
        // 索引与路径引用同 rename:先摘旧键,防抖全量重建
        const affected = flattenDocs(treeRef.current)
          .map((d) => d.path)
          .filter((p) => p === srcRel || (isDir && p.startsWith(srcRel + "/")));
        for (const p of affected) searchRef.current.remove(p);
        scheduleIndexRebuild();
        const rewrite = (p: string) =>
          p === srcRel
            ? result.newPath
            : p.startsWith(srcRel + "/")
              ? result.newPath + p.slice(srcRel.length)
              : p;
        const cur = pathRef.current;
        const newCur = cur ? rewrite(cur) : null;
        if (newCur && newCur !== cur) setCurrentPath(newCur);
        backRef.current = backRef.current.map(rewrite);
        frontRef.current = frontRef.current.map(rewrite);
        await refreshTree();
        // 引用被联动改写的当前文档:重读落盘版,避免编辑器旧内容盖回
        if (newCur && result.updatedFiles.includes(newCur)) {
          const content = await kbBackend.readDoc(root, newCur).catch(() => null);
          if (content != null) {
            dirtyRef.current = null;
            setMarkdown(content);
            setSaveState("saved");
          }
        }
        return result;
      } catch (e) {
        console.error("[kb] 移动失败:", e);
        return null;
      }
    },
    [flushSave, persistMeta, refreshTree, scheduleIndexRebuild],
  );

  /* ---------------- 排序/折叠(meta) ---------------- */

  /** 拖拽落点后的新顺序:整组兄弟重写 sortIndex(0..n-1)并本地重排 */
  const persistSiblingOrder = useCallback(
    (parentRel: string, orderedPaths: string[]) => {
      metaRef.current = applySiblingOrder(metaRef.current, parentRel, orderedPaths);
      persistMeta();
      setTree(sortTree(treeRef.current, metaRef.current));
    },
    [persistMeta],
  );

  const toggleCollapse = useCallback(
    (folderRel: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        const now = next.has(folderRel);
        if (now) next.delete(folderRel);
        else next.add(folderRel);
        metaRef.current = metaSetCollapsed(metaRef.current, folderRel, !now);
        persistMeta();
        return next;
      });
    },
    [persistMeta],
  );

  /* ---------------- 回收站(5.1.1) ---------------- */

  const listTrash = useCallback(async (): Promise<TrashEntry[]> => {
    const root = rootRef.current;
    if (!root) return [];
    return kbBackend.listTrash(root);
  }, []);

  /** 当前文档的反向链接(5.4-2);解析与点击跳转同构 */
  const getBacklinks = useCallback((rel: string | null): BacklinkRow[] => {
    if (!rel) return [];
    return wikiRefIdx.current.backlinks(rel, flattenDocs(treeRef.current));
  }, []);

  /** 恢复;原路径冲突抛 KbConflictError(调用方弹三选一后再带 strategy 重试) */
  const restoreTrash = useCallback(
    async (rel: string, strategy?: "overwrite" | "rename"): Promise<string> => {
      const root = rootRef.current;
      if (!root) throw new Error("未打开知识库");
      markSelfWrite();
      const finalRel = await kbBackend.restoreTrash(root, rel, strategy);
      await refreshTree();
      void rebuildIndex(); // 恢复可能带回多篇文档,重建最稳
      return finalRel;
    },
    [rebuildIndex, refreshTree],
  );

  /** 彻底删除/清空回收站(不可恢复);不碰库内文件 → 无需刷树/重建索引 */
  const purgeTrash = useCallback(async (rel: string): Promise<void> => {
    const root = rootRef.current;
    if (!root) throw new Error("未打开知识库");
    markSelfWrite();
    await kbBackend.purgeTrash(root, rel);
    void refreshTrashRefs();
  }, [refreshTrashRefs]);

  const emptyTrash = useCallback(async (): Promise<void> => {
    const root = rootRef.current;
    if (!root) throw new Error("未打开知识库");
    markSelfWrite();
    await kbBackend.emptyTrash(root);
    void refreshTrashRefs();
  }, [refreshTrashRefs]);

  /* ---------------- assets / 导入导出 ---------------- */

  /** 粘贴/拖拽图片字节 → 当前文档所在 assets(9.3);返回可插入的 src 列表 */
  const saveImageFiles = useCallback(async (files: File[]): Promise<string[]> => {
    const root = rootRef.current;
    const rel = pathRef.current;
    if (!root || !rel) return [];
    const srcs: string[] = [];
    for (const f of files) {
      const ext = (f.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const bytes = new Uint8Array(await f.arrayBuffer());
      try {
        markSelfWrite();
        srcs.push(await kbBackend.saveAsset(root, rel, ext, bytes));
      } catch (e) {
        console.error("[kb] 图片落盘失败:", e);
      }
    }
    return srcs;
  }, []);

  /** 斜杠菜单「图片」:文件选择 → assets;取消返回 null */
  const importImagesFromPicker = useCallback(async (): Promise<string[] | null> => {
    const root = rootRef.current;
    const rel = pathRef.current;
    if (!root || !rel) return null;
    markSelfWrite();
    return kbBackend.importImagesFromPicker(root, rel);
  }, []);

  /** 导入外部 Markdown 到指定文件夹(5.6);取消返回 null */
  const importDocs = useCallback(
    async (folderRel: string): Promise<string[] | null> => {
      const root = rootRef.current;
      if (!root) return null;
      markSelfWrite();
      const rels = await kbBackend.importDocsFromPicker(root, folderRel);
      if (!rels?.length) return null;
      await refreshTree();
      void rebuildIndex();
      return rels;
    },
    [rebuildIndex, refreshTree],
  );

  const exportText = useCallback(
    async (defaultName: string, filterExt: string, content: string): Promise<string | null> => {
      return kbBackend.exportText(defaultName, filterExt, content);
    },
    [],
  );

  const readAssetBase64 = useCallback(async (rel: string) => {
    const root = rootRef.current;
    if (!root) return null;
    return kbBackend.readAssetBase64(root, rel);
  }, []);

  /** 图片 src 渲染解析注册(image-card NodeView 消费) */
  const assetSrcResolver = useCallback((src: string): string => {
    const root = rootRef.current;
    const rel = pathRef.current;
    if (!root || !rel) return src;
    return kbBackend.resolveAssetSrc(root, rel, src);
  }, []);

  // 首启(5.0.4):上次库仍有效 → 直开;否则欢迎页
  useEffect(() => {
    void (async () => {
      try {
        const state = await kbBackend.getRecent();
        setRecent(state);
        if (state.last) {
          try {
            await kbBackend.openKb(state.last);
            await enterKb(state.last);
          } catch {
            setBootError("找不到上次的文件夹,可能被移动或删除");
          }
        }
      } catch (e) {
        console.error("[kb] 首启读取失败:", e);
      } finally {
        setBooted(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载冲刷 + 退订
  useEffect(
    () => () => {
      void flushSave();
      fsUnRef.current?.();
    },
    [flushSave],
  );

  return {
    booted,
    bootError,
    kbRoot,
    tree,
    currentPath,
    markdown,
    saveState,
    savedAt,
    recent,
    canBack,
    canFront,
    collapsed,
    indexReady,
    externalChange,
    onMarkdownChange,
    getMarkdownNow,
    openDoc,
    openWikiLink,
    navBack,
    navForward,
    openKbAt,
    createKbAt,
    pickAndCreate,
    pickAndOpen,
    closeKb,
    createDoc,
    createFolder,
    removeEntry,
    renameEntry,
    moveEntry,
    search,
    rebuildIndex,
    resolveExternal,
    toggleCollapse,
    persistSiblingOrder,
    listTrash,
    restoreTrash,
    purgeTrash,
    emptyTrash,
    getBacklinks,
    refsVersion,
    orphanMeta,
    claimOrphan,
    discardOrphan,
    saveImageFiles,
    /** 最近一次打开失败的文档路径(供上层 toast;成功打开后清空) */
    docError,
    importImagesFromPicker,
    importDocs,
    exportText,
    readAssetBase64,
    assetSrcResolver,
  };
}

export { KbConflictError };
