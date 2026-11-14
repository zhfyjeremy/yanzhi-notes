import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KbConflictError, KbIsYanzhiError, KbNotEmptyError, kbBackend } from "./backend";
import { parseSettings, type AppSettings } from "../settings";
import type { HistoryEntry, RecentState, TreeNode, TrashEntry } from "./types";
import {
  closeOtherTabs,
  closeTab,
  closeTabsToLeft,
  closeTabsToRight,
  openInTabs,
  parseWorkspace,
  pruneTabs,
  reorderTabs,
  restoreTabs,
  rewriteTabPaths,
  workspaceOf,
  type DocTab,
} from "./doc-tabs";
import { WikiRefIndex, type BacklinkRow } from "./backlinks";
import { flattenDocs, resolveWikiTarget } from "./wiki-refs";
import {
  allTagsOf,
  applySiblingOrder,
  claimMetaKey,
  collapsedFolders,
  discardMetaKey,
  EMPTY_META,
  findOrphanMeta,
  moveMetaToTail,
  nextSortIndex,
  parseMeta,
  preserveOrderAfterRename,
  removeMetaKeys,
  renameMetaKeys,
  rewriteTreePaths,
  serializeMeta,
  setCollapsed as metaSetCollapsed,
  setEntryIcon,
  setDocPinned,
  setDocTags,
  setFoldersCollapsed,
  sortTree,
  type KbMeta,
  type OrphanMetaEntry,
} from "./meta";
import { KbSearchIndex, type SearchHit } from "./search";
import type { BatchResult } from "./batch";

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

/** 后端 rename 偶发返回绝对路径时,用旧 rel 的父目录 + 新文件名重拼相对路径 */
function coerceRelPath(oldRel: string, newPath: string): string {
  const norm = newPath.replace(/\\/g, "/");
  const looksAbsolute =
    /^[a-zA-Z]:\//.test(norm) || norm.startsWith("/") || norm.startsWith("//");
  if (!looksAbsolute && !norm.includes(":/")) return norm;
  const base = norm.split("/").pop() || norm;
  const slash = oldRel.lastIndexOf("/");
  return slash >= 0 ? `${oldRel.slice(0, slash)}/${base}` : base;
}

function firstDoc(nodes: TreeNode[]): string | null {
  for (const n of nodes) {
    if (!n.isDir) return n.path;
    const inner = firstDoc(n.children);
    if (inner) return inner;
  }
  return null;
}

/** 回收站徽标按最上层条目计数,已包含在文件夹里的子项不重复计数。 */
function topLevelTrashCount(entries: TrashEntry[]): number {
  const paths = new Set(entries.map((entry) => entry.path));
  return entries.filter((entry) => {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (paths.has(parts.slice(0, i).join("/"))) return false;
    }
    return true;
  }).length;
}

export function useKb(settings: AppSettings) {
  const [booted, setBooted] = useState(false);
  const [openingKb, setOpeningKb] = useState(false);
  const [kbRoot, setKbRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string>("# 未命名文档\n");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState("");
  const [recent, setRecent] = useState<RecentState>({ last: null, recent: [] });
  const [bootError, setBootError] = useState<string | null>(null);
  // 文档标签页:tab 只存路径;前进/后退历史属于 active tab,切换 tab 不互串
  const [tabs, setTabs] = useState<DocTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabsRef = useRef<DocTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
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
  const [trashCount, setTrashCount] = useState(0);
  // [[出链]]索引(反向链接 5.4-2):与搜索索引同点位维护;refsVersion 驱动面板重算
  const wikiRefIdx = useRef(new WikiRefIndex());
  const [refsVersion, setRefsVersion] = useState(0);
  const bumpRefs = () => setRefsVersion((v) => (v + 1) % 1_000_000);
  // 外部改动(5.2.6):当前文档在磁盘被改且本地有未保存 → App 弹「保留我的/载入磁盘版本」
  const [externalChange, setExternalChange] = useState<string | null>(null);

  const dirtyRef = useRef<string | null>(null); // 未落盘的最新内容
  // 最近一次落盘(openDoc 载入/自动保存成功)的内容:getMarkdownNow 的兜底源。
  // 不能用 markdown state 兜底——flushSave 不 setMarkdown(prop 变化会整体重载
  // 编辑器),编辑后闲置 2s dirty 清空,state 仍停在 openDoc 版本(导出/快照会拿旧文)
  const savedMdRef = useRef<string>(markdown);
  /** 已打开文档的正文缓存:切 tab 命中则免 readDoc,手感明显更顺 */
  const docCacheRef = useRef(new Map<string, string>());
  const rewriteDocCache = (oldRel: string, newRel: string) => {
    const next = new Map<string, string>();
    for (const [k, v] of docCacheRef.current) {
      next.set(k === oldRel ? newRel : k.startsWith(oldRel + "/") ? newRel + k.slice(oldRel.length) : k, v);
    }
    docCacheRef.current = next;
  };
  const dropDocCache = (rel: string) => {
    const next = new Map<string, string>();
    for (const [k, v] of docCacheRef.current) {
      if (k === rel || k.startsWith(rel + "/")) continue;
      next.set(k, v);
    }
    docCacheRef.current = next;
  };
  /** 切文档前由 App 注册:冲刷编辑器去抖中的最新稿到 dirtyRef */
  const beforeSwitchRef = useRef<(() => void) | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<string | null>(null);
  const pathRef = useRef<string | null>(null);
  rootRef.current = kbRoot;
  pathRef.current = currentPath;
  const selfWriteUntil = useRef(0);
  const fsUnRef = useRef<(() => void) | null>(null);
  const metaWriteTimer = useRef<number | undefined>(undefined);
  const indexRebuildTimer = useRef<number | undefined>(undefined);
  // 快照设置随渲染同步(设置窗改立即生效,不重启)
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const markSelfWrite = () => {
    selfWriteUntil.current = Date.now() + SELF_WRITE_QUIET_MS;
  };

  const refreshTrashCount = useCallback(async () => {
    const root = rootRef.current;
    if (!root) {
      setTrashCount(0);
      return;
    }
    try {
      setTrashCount(topLevelTrashCount(await kbBackend.listTrash(root)));
    } catch {
      setTrashCount(0);
    }
  }, []);

  /** meta 落盘(去抖;写失败只丢偏好不阻塞,9.1.4) */
  const persistMeta = useCallback(() => {
    window.clearTimeout(metaWriteTimer.current);
    metaWriteTimer.current = window.setTimeout(() => {
      const root = rootRef.current;
      if (root) kbBackend.writeMeta(root, serializeMeta(metaRef.current)).catch(() => {});
    }, 300);
  }, []);

  const syncNav = () => {
    const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    setCanBack(!!active?.back.length);
    setCanFront(!!active?.front.length);
  };

  const flushSave = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(saveTimer.current);
    const content = dirtyRef.current;
    if (content == null) return true;
    const root = rootRef.current;
    const rel = pathRef.current;
    if (!root || !rel) return false;
    dirtyRef.current = null;
    setSaveState("saving");
    try {
      markSelfWrite();
      await kbBackend.writeDoc(root, rel, content);
      setSaveState("saved");
      savedMdRef.current = content;
      docCacheRef.current.set(rel, content);
      searchRef.current.add(rel, content, metaRef.current.docs[rel]?.tags); // 保存时增量更新索引(5.5.3)
      wikiRefIdx.current.update(rel, content); // 出链随内容变(反向链接即时反映)
      bumpRefs();
      void maybeAutoSnapshot(rel, content); // 落盘后顺带检查自动快照(6.2-1)
      const now = new Date();
      setSavedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
      );
      return true;
    } catch (e) {
      // 落盘失败:内容留在 dirty,下轮再试
      dirtyRef.current = content;
      setSaveState("error");
      console.error("[kb] 自动保存失败:", e);
      return false;
    }
  }, []);

  /**
   * 后台落盘指定文档(切 tab 不阻塞 UI)。失败时把内容放回 dirty 并标 error,
   * 若仍停在该文档则下次 flush 会重试;已切走则 cache 里仍保留最新稿。
   */
  const writeDocBackground = useCallback((rel: string, content: string) => {
    const root = rootRef.current;
    if (!root) return;
    docCacheRef.current.set(rel, content);
    setSaveState("saving");
    markSelfWrite();
    void kbBackend
      .writeDoc(root, rel, content)
      .then(() => {
        if (pathRef.current === rel) {
          savedMdRef.current = content;
          setSaveState("saved");
          const now = new Date();
          setSavedAt(
            `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
          );
        }
        searchRef.current.add(rel, content, metaRef.current.docs[rel]?.tags);
        wikiRefIdx.current.update(rel, content);
        bumpRefs();
        void maybeAutoSnapshot(rel, content);
      })
      .catch((e) => {
        console.error("[kb] 后台保存失败:", e);
        docCacheRef.current.set(rel, content);
        if (pathRef.current === rel) {
          dirtyRef.current = content;
          setSaveState("error");
        }
      });
  }, []);

  /** 编辑器内容变更(编辑器内已 300ms 去抖):挂起 2s 落盘 */
  const onMarkdownChange = useCallback(
    (md: string) => {
      dirtyRef.current = md;
      const rel = pathRef.current;
      if (rel) docCacheRef.current.set(rel, md);
      setSaveState("dirty");
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flushSave(), AUTOSAVE_MS);
    },
    [flushSave],
  );

  /** App 注册:切文档前冲刷编辑器去抖稿 */
  const setBeforeSwitch = useCallback((fn: (() => void) | null) => {
    beforeSwitchRef.current = fn;
  }, []);

  /** 切走前:冲刷去抖 → 若有未保存稿则后台写盘(不 await) */
  const prepareSwitch = useCallback(() => {
    beforeSwitchRef.current?.();
    window.clearTimeout(saveTimer.current);
    const content = dirtyRef.current;
    const rel = pathRef.current;
    if (content == null || !rel) return;
    dirtyRef.current = null;
    writeDocBackground(rel, content);
  }, [writeDocBackground]);

  /** 当前最新正文(dirty 优先,落盘版兜底;导出/复制/快照等即时消费用,不等落盘) */
  const getMarkdownNow = useCallback((): string => dirtyRef.current ?? savedMdRef.current, []);

  /* ---------------- 历史快照(6.2) ---------------- */

  // 每篇文档最近一次快照(时间 + 内容),自动节流与「实质差异」判断都在前端;
  // 后端只管存储与数量上限。懒加载:首次保存该文档时从后端补最新一条。
  const snapRef = useRef(new Map<string, { time: number; content: string }>());
  const [historyVersion, setHistoryVersion] = useState(0);
  const bumpHistory = () => setHistoryVersion((v) => (v + 1) % 1_000_000);

  /** 落盘后自动快照检查(6.2-1):距上次 ≥ 设置间隔 且 内容有实质差异 */
  async function maybeAutoSnapshot(rel: string, content: string): Promise<void> {
    const root = rootRef.current;
    if (!root) return;
    const { snapshotIntervalMin, snapshotKeep } = settingsRef.current;
    try {
      let last = snapRef.current.get(rel);
      if (!last) {
        const list = await kbBackend.listHistory(root, rel);
        const latest = list[0];
        last = latest
          ? { time: latest.time, content: await kbBackend.readHistory(root, rel, latest.id) }
          : { time: 0, content: "" };
        snapRef.current.set(rel, last);
      }
      if (Date.now() - last.time < snapshotIntervalMin * 60_000) return;
      if (content === last.content) return; // 无实质差异(空文档首拍同样跳过)
      const entry = await kbBackend.saveSnapshot(root, rel, content, true, snapshotKeep);
      snapRef.current.set(rel, { time: entry.time, content });
      bumpHistory();
    } catch (e) {
      console.error("[kb] 自动快照失败:", e);
    }
  }

  /** 手动「打快照」(6.2-1:不受间隔与差异限制);先冲刷再存,确保存的是最新内容 */
  const snapshotNow = useCallback(async (): Promise<HistoryEntry | null> => {
    const root = rootRef.current;
    const rel = pathRef.current;
    if (!root || !rel) return null;
    const content = getMarkdownNow(); // flushSave 会清 dirty,先取
    await flushSave();
    try {
      markSelfWrite();
      const entry = await kbBackend.saveSnapshot(root, rel, content, false, settingsRef.current.snapshotKeep);
      snapRef.current.set(rel, { time: entry.time, content });
      bumpHistory();
      return entry;
    } catch (e) {
      console.error("[kb] 打快照失败:", e);
      return null;
    }
  }, [flushSave, getMarkdownNow]);

  /** 恢复快照(6.2-4):恢复前先把当前内容存一份快照(防手滑丢稿),再整体替换正文 */
  const restoreSnapshot = useCallback(
    async (content: string): Promise<boolean> => {
      const root = rootRef.current;
      const rel = pathRef.current;
      if (!root || !rel) return false;
      const current = getMarkdownNow();
      if (current !== content) {
        try {
          markSelfWrite();
          const entry = await kbBackend.saveSnapshot(root, rel, current, true, settingsRef.current.snapshotKeep);
          snapRef.current.set(rel, { time: entry.time, content: current });
          bumpHistory();
        } catch {
          /* 恢复前快照失败不阻断恢复(当前内容仍有 2s 自动保存兜底) */
        }
      }
      setMarkdown(content); // markdown prop 变化 → 编辑器整体重载(openDoc 同路径)
      savedMdRef.current = content; // 落盘前 getMarkdownNow 即可取到恢复版
      onMarkdownChange(content); // 挂起 2s 自动保存,恢复内容落盘
      return true;
    },
    [getMarkdownNow, onMarkdownChange],
  );

  const listHistory = useCallback(async (rel: string): Promise<HistoryEntry[]> => {
    const root = rootRef.current;
    if (!root) return [];
    return kbBackend.listHistory(root, rel);
  }, []);

  const readHistory = useCallback(async (rel: string, id: string): Promise<string> => {
    const root = rootRef.current;
    if (!root) throw new Error("未打开知识库");
    return kbBackend.readHistory(root, rel, id);
  }, []);

  /** 按 keep 立刻裁全库历史;开库兜底 / 设置调小上限时调用 */
  const pruneHistoryKeep = useCallback(async (keep: number) => {
    const root = rootRef.current;
    if (!root) return 0;
    try {
      markSelfWrite();
      const removed = await kbBackend.pruneHistory(root, keep);
      if (removed > 0) bumpHistory();
      return removed;
    } catch (e) {
      console.error("[kb] 裁剪历史失败:", e);
      return 0;
    }
  }, []);

  // 设置「每篇保留上限」调小 → 立刻裁,不必等下次打快照(历史面板同步刷新)
  const keepRef = useRef(settings.snapshotKeep);
  useEffect(() => {
    const prev = keepRef.current;
    const next = settings.snapshotKeep;
    keepRef.current = next;
    if (next < prev && rootRef.current) void pruneHistoryKeep(next);
  }, [settings.snapshotKeep, pruneHistoryKeep]);

  /** 快照节流状态 key 跟随改名/移动(前缀改写,文档与文件夹通用) */
  const rewriteSnapKeys = useCallback((oldRel: string, newRel: string) => {
    const next = new Map<string, { time: number; content: string }>();
    for (const [k, v] of snapRef.current) {
      next.set(k === oldRel ? newRel : k.startsWith(oldRel + "/") ? newRel + k.slice(oldRel.length) : k, v);
    }
    snapRef.current = next;
  }, []);

  /** 读取并呈现文档(不动历史栈);openDoc/navBack/navForward 共用。
   *  读取失败(被外部删除/权限)置 docError 供上层 toast,返回 false。
   *  优先走内存缓存,已打开过的 tab 切回去不打 readDoc。 */
  const [docError, setDocError] = useState<string | null>(null);
  const presentDoc = useCallback((rel: string, content: string, saveStateNext: SaveState = "saved") => {
    dirtyRef.current = saveStateNext === "dirty" ? content : null;
    pathRef.current = rel; // 同步写 ref:立刻可读,不等重渲染
    setCurrentPath(rel);
    setMarkdown(content);
    savedMdRef.current = content;
    docCacheRef.current.set(rel, content);
    setSaveState(saveStateNext);
    setDocError(null);
    // 搜索/双链索引更新挪出关键路径:长文 tokenize 不挡首帧高亮与 setContent
    queueMicrotask(() => {
      if (pathRef.current !== rel) return;
      if (searchRef.current.size > 0) searchRef.current.add(rel, content, metaRef.current.docs[rel]?.tags);
      wikiRefIdx.current.update(rel, content);
    });
    kbBackend.setLastDoc(rel).catch(() => {});
  }, []);

  const loadDoc = useCallback(async (rel: string, opts?: { bypassCache?: boolean }): Promise<boolean> => {
    const root = rootRef.current;
    if (!root) return false;
    if (!opts?.bypassCache) {
      const cached = docCacheRef.current.get(rel);
      if (cached != null) {
        presentDoc(rel, cached);
        return true;
      }
    }
    try {
      const content = await kbBackend.readDoc(root, rel);
      presentDoc(rel, content);
      return true;
    } catch (e) {
      console.error("[kb] 打开文档失败:", e);
      setDocError(rel);
      return false;
    }
  }, [presentDoc]);

  /** 应用 tab 状态并同步持久化;root 未就绪时只更新内存(开库恢复用) */
  const applyTabs = useCallback(
    (next: { tabs: DocTab[]; activeId: string | null; changed: boolean }, persist = true) => {
      if (!next.changed) return;
      tabsRef.current = next.tabs;
      activeTabIdRef.current = next.activeId;
      setTabs(next.tabs);
      setActiveTabId(next.activeId);
      syncNav();
      const root = rootRef.current;
      if (persist && root) {
        markSelfWrite();
        const content = JSON.stringify(workspaceOf(next.tabs, next.activeId));
        kbBackend.writeWorkspace(root, content).catch((e) =>
          console.error("[kb] 保存标签页失败:", e),
        );
      }
    },
    [],
  );

  const clearCurrentDoc = useCallback(() => {
    pathRef.current = null;
    setCurrentPath(null);
    setMarkdown("");
    savedMdRef.current = "";
    setSaveState("saved");
  }, []);

  const resetTabs = useCallback(() => {
    applyTabs({ tabs: [], activeId: null, changed: true }, false);
    docCacheRef.current.clear();
  }, [applyTabs]);

  /**
   * 打开文档统一入口:
   * - existing-or-new:目录树/搜索/图谱,已有 tab 激活,没有则新 tab
   * - current:双链默认在当前 tab 内跳转;目标已有其它 tab 时激活既有 tab,避免同文档重复 tab
   */
  const openDoc = useCallback(
    async (rel: string, behavior: "existing-or-new" | "current" = "existing-or-new") => {
      const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
      if (rel === pathRef.current && active?.path === rel) return;
      prepareSwitch(); // 冲刷去抖 + 后台保存,不阻塞切换
      applyTabs(openInTabs(tabsRef.current, activeTabIdRef.current, rel, behavior));
      if (!(await loadDoc(rel))) return;
    },
    [applyTabs, loadDoc, prepareSwitch],
  );

  const activateTab = useCallback(
    async (tabId: string): Promise<boolean> => {
      const target = tabsRef.current.find((tab) => tab.id === tabId);
      if (!target) return false;
      if (target.id === activeTabIdRef.current && target.path === pathRef.current) return true;
      prepareSwitch();
      // 与 openInTabs 同口径:切到已有 tab 也记后退,左右导航才有内容
      applyTabs(openInTabs(tabsRef.current, activeTabIdRef.current, target.path, "existing-or-new"));
      if (!(await loadDoc(target.path))) return false;
      return true;
    },
    [applyTabs, loadDoc, prepareSwitch],
  );

  const closeTabById = useCallback(
    async (tabId: string): Promise<boolean> => {
      const target = tabsRef.current.find((tab) => tab.id === tabId);
      if (!target) return false;
      const closingActive = tabId === activeTabIdRef.current;
      if (closingActive) prepareSwitch();
      const change = closeTab(tabsRef.current, activeTabIdRef.current, tabId);
      applyTabs(change);
      if (closingActive) {
        const nextActive = change.tabs.find((tab) => tab.id === change.activeId);
        if (nextActive) {
          if (!(await loadDoc(nextActive.path))) return false;
        } else {
          clearCurrentDoc();
        }
      }
      return true;
    },
    [applyTabs, clearCurrentDoc, loadDoc, prepareSwitch],
  );

  const closeOthers = useCallback(
    async (tabId: string): Promise<boolean> => {
      const target = tabsRef.current.find((tab) => tab.id === tabId);
      if (!target) return false;
      if (activeTabIdRef.current !== tabId) return activateTab(tabId);
      applyTabs(closeOtherTabs(tabsRef.current, tabId));
      return true;
    },
    [activateTab, applyTabs],
  );

  const closeLeft = useCallback(
    async (tabId: string): Promise<boolean> => {
      const index = tabsRef.current.findIndex((tab) => tab.id === tabId);
      if (index < 0) return false;
      const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
      const activeIndex = active ? tabsRef.current.indexOf(active) : -1;
      const needsSwitch = activeIndex >= 0 && activeIndex < index;
      if (needsSwitch) prepareSwitch();
      applyTabs(closeTabsToLeft(tabsRef.current, activeTabIdRef.current, tabId));
      if (needsSwitch) {
        const target = tabsRef.current.find((tab) => tab.id === tabId);
        if (target && !(await loadDoc(target.path))) return false;
      }
      return true;
    },
    [applyTabs, loadDoc, prepareSwitch],
  );

  const closeRight = useCallback(
    async (tabId: string): Promise<boolean> => {
      const index = tabsRef.current.findIndex((tab) => tab.id === tabId);
      if (index < 0) return false;
      const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
      const activeIndex = active ? tabsRef.current.indexOf(active) : -1;
      const needsSwitch = activeIndex > index;
      if (needsSwitch) prepareSwitch();
      applyTabs(closeTabsToRight(tabsRef.current, activeTabIdRef.current, tabId));
      if (needsSwitch) {
        const target = tabsRef.current.find((tab) => tab.id === tabId);
        if (target && !(await loadDoc(target.path))) return false;
      }
      return true;
    },
    [applyTabs, loadDoc, prepareSwitch],
  );

  const reorderDocTabs = useCallback(
    (from: number, to: number) => {
      applyTabs(reorderTabs(tabsRef.current, activeTabIdRef.current, from, to));
    },
    [applyTabs],
  );

  const navBack = useCallback(async () => {
    const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    if (!active?.back.length) return;
    const cur = active.path;
    const target = active.back[active.back.length - 1];
    prepareSwitch();
    applyTabs({
      tabs: tabsRef.current.map((tab) =>
        tab.id === active.id
          ? { ...tab, path: target, back: tab.back.slice(0, -1), front: [cur, ...tab.front] }
          : tab,
      ),
      activeId: active.id,
      changed: true,
    });
    if (!(await loadDoc(target))) return;
  }, [applyTabs, loadDoc, prepareSwitch]);

  const navForward = useCallback(async () => {
    const active = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    if (!active?.front.length) return;
    const cur = active.path;
    const target = active.front[0];
    prepareSwitch();
    applyTabs({
      tabs: tabsRef.current.map((tab) =>
        tab.id === active.id
          ? { ...tab, path: target, back: [...tab.back, cur], front: tab.front.slice(1) }
          : tab,
      ),
      activeId: active.id,
      changed: true,
    });
    if (!(await loadDoc(target))) return;
  }, [applyTabs, loadDoc, prepareSwitch]);

  /** 双链跳转:解析目标 → 打开;未命中返回 null(上层提示「目标不存在或已移动」) */
  const openWikiLink = useCallback(
    async (target: string, newTab = false): Promise<string | null> => {
      const rel = resolveWikiTarget(flattenDocs(treeRef.current), target);
      if (!rel) return null;
      await openDoc(rel, newTab ? "existing-or-new" : "current");
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

  const claimOrphansBatch = useCallback(
    (pairs: { entry: OrphanMetaEntry; targetRel: string }[]) => {
      let next = metaRef.current;
      for (const { entry, targetRel } of pairs) {
        next = claimMetaKey(next, entry.path, targetRel, entry.isDir);
      }
      metaRef.current = next;
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

  const discardOrphansBatch = useCallback(
    (entries: OrphanMetaEntry[]) => {
      let next = metaRef.current;
      for (const entry of entries) next = discardMetaKey(next, entry.path, entry.isDir);
      metaRef.current = next;
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
      searchRef.current.build(docs, (p) => metaRef.current.docs[p]?.tags ?? []);
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

  /** 树变化后清理失效 tab;active 被外部删除且有未保存稿时仍先走外部改动确认。 */
  const reconcileTabs = useCallback(async () => {
    const activeBefore = tabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
    const valid = new Set(flattenDocs(treeRef.current).map((doc) => doc.path));
    const change = pruneTabs(tabsRef.current, activeTabIdRef.current, valid);
    if (
      activeBefore &&
      !valid.has(activeBefore.path) &&
      dirtyRef.current != null &&
      activeBefore.path === pathRef.current
    ) {
      setExternalChange(activeBefore.path);
      return;
    }
    if (!change.changed) return;
    const nextActive = change.tabs.find((tab) => tab.id === change.activeId);
    if (change.activeId !== activeTabIdRef.current) {
      if (nextActive) {
        if (!(await flushSave())) return;
        if (!(await loadDoc(nextActive.path))) return;
      } else {
        clearCurrentDoc();
      }
    }
    applyTabs(change);
  }, [applyTabs, clearCurrentDoc, flushSave, loadDoc]);

  /* ---------------- 文件监听(5.2.6) ---------------- */

  /** 外部改当前文档且本地干净 → 静默重载(强制读盘,不走 tab 缓存) */
  const reloadCurrent = useCallback(async (): Promise<boolean> => {
    const cur = pathRef.current;
    return cur ? loadDoc(cur, { bypassCache: true }) : false;
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
      void refreshTree().then(refreshOrphans).then(() => reconcileTabs()); // 外部改名/移动/删除 → 重扫失联 meta + 清理 tab
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

  // 乐观刷新/恢复回收站等没有 FS 事件兜底的树变化,也统一清理失效 tab
  useEffect(() => {
    if (!kbRoot) return;
    void reconcileTabs();
  }, [kbRoot, reconcileTabs, tree]);

  /** 外部改动弹窗结果(保留我的 / 载入磁盘版本) */
  const resolveExternal = useCallback(
    async (keep: boolean) => {
      setExternalChange(null);
      if (!keep) {
        dirtyRef.current = null;
        const ok = await reloadCurrent(); // 载入磁盘版:丢弃 dirty 重读
        if (!ok) await reconcileTabs(); // 文件已不存在:清掉/切换失效 tab
      }
      // 保留我的:继续编辑,下一轮自动保存会覆盖磁盘版本
    },
    [reconcileTabs, reloadCurrent],
  );

  /* ---------------- 开库/关库 ---------------- */

  const enterKb = useCallback(
    async (root: string) => {
      setOpeningKb(true);
      try {
        // 直接换库也必须先保住旧库未落盘内容;保存失败不切库
        if (rootRef.current && rootRef.current !== root && !(await flushSave())) return;
        resetTabs();
        dirtyRef.current = null;
        pathRef.current = null;
        setCurrentPath(null);
        setMarkdown("");
        savedMdRef.current = "";
        setSaveState("saved");
        snapRef.current.clear(); // 换库:快照节流状态不跨库复用
        await kbBackend.setRecent(root);
        setRecent(await kbBackend.getRecent());
        setKbRoot(root);
        rootRef.current = root;
        // 开库兜底:欢迎页期间调小 keep 也能在进库时裁到合规
        void kbBackend.pruneHistory(root, settingsRef.current.snapshotKeep).catch((e) => {
          console.error("[kb] 开库裁剪历史失败:", e);
        });
        void refreshTrashCount();
        // meta 先于树加载:排序/折叠要参与首帧渲染
        metaRef.current = parseMeta(await kbBackend.readMeta(root).catch(() => ""));
        setCollapsed(collapsedFolders(metaRef.current));
        const nodes = await kbBackend.scanTree(root).catch(() => [] as TreeNode[]);
        const valid = new Set(flattenDocs(nodes).map((doc) => doc.path));
        const sorted = sortTree(nodes, metaRef.current);
        treeRef.current = sorted;
        setTree(sorted);
        setOrphanMeta(findOrphanMeta(metaRef.current, sorted));
        // 搜索索引后台构建,不阻塞首帧(5.5.3)
        setIndexReady(false);
        void rebuildIndex();
        // 恢复标签页;首次无 workspace 时用 lastDoc/第一篇初始化一个 tab
        const workspace = parseWorkspace(
          await kbBackend.readWorkspace(root).catch(() => ""),
        );
        const workspacePaths = (workspace?.tabs ?? []).filter((path) => valid.has(path));
        const workspaceActive =
          workspace?.activePath && valid.has(workspace.activePath) ? workspace.activePath : null;
        const lastDoc = (await kbBackend.getRecent()).lastDoc;
        const firstDoc_ = firstDoc(nodes);
        const initialPath =
          workspaceActive ??
          workspacePaths[0] ??
          (lastDoc && valid.has(lastDoc) ? lastDoc : firstDoc_);
        if (initialPath) {
          const restored = workspacePaths.length
            ? restoreTabs(workspacePaths, workspaceActive)
            : restoreTabs([initialPath], initialPath);
          const activeRestored = restored.tabs.find((tab) => tab.id === restored.activeId);
          // active 读失败(权限/短暂外部变化)时尝试 workspace 中的后续 tab,不把整个恢复卡死
          const candidates = [
            ...(activeRestored ? [activeRestored.path] : []),
            ...restored.tabs.map((tab) => tab.path).filter((path) => path !== initialPath),
          ];
          for (const path of candidates) {
            if (await loadDoc(path)) {
              applyTabs(restoreTabs(restored.tabs.map((tab) => tab.path), path));
              break;
            }
          }
        } else {
          clearCurrentDoc();
          applyTabs({ tabs: [], activeId: null, changed: true });
        }
      } finally {
        setOpeningKb(false);
      }
    },
    [applyTabs, clearCurrentDoc, flushSave, loadDoc, rebuildIndex, refreshTrashCount, resetTabs],
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

  /** 新建流程结果:取消 / 成功(null) / 非空或已是砚知库(带 root) / 其它错误 */
  const pickAndCreate = useCallback(async (): Promise<
    | null
    | { kind: "cancelled" }
    | { kind: "not-empty" | "is-yanzhi"; root: string }
    | { kind: "error"; message: string }
  > => {
    const dir = await kbBackend.pickFolder();
    if (!dir) return { kind: "cancelled" };
    const result = await createKbAt(dir);
    if (result === "NOT_EMPTY") return { kind: "not-empty", root: dir };
    if (result === "IS_YANZHI") return { kind: "is-yanzhi", root: dir };
    if (result) return { kind: "error", message: result };
    return null;
  }, [createKbAt]);

  /** 打开库:取消返回 "cancelled";成功 null;失败错误文案。勿把取消当成功。 */
  const pickAndOpen = useCallback(async (): Promise<"cancelled" | string | null> => {
    const dir = await kbBackend.pickFolder();
    if (!dir) return "cancelled";
    return openKbAt(dir);
  }, [openKbAt]);

  const closeKb = useCallback(async () => {
    if (!(await flushSave())) return; // 保存失败留在当前库,避免丢最新稿
    resetTabs();
    fsUnRef.current?.();
    fsUnRef.current = null;
    setKbRoot(null);
    rootRef.current = null;
    setTree([]);
    setCurrentPath(null);
    setOrphanMeta([]);
    setTrashCount(0);
  }, [flushSave, resetTabs]);

  /* ---------------- 增删改(目录树操作) ---------------- */

  const createDoc = useCallback(
    async (folderRel: string, title: string, content?: string): Promise<string | null> => {
      const root = rootRef.current;
      if (!root) return null;
      try {
        markSelfWrite();
        const rel = await kbBackend.createDoc(root, folderRel, title, content);
        // 新条目排在所在文件夹末尾(meta 记序,树序唯一出处)
        metaRef.current = {
          ...metaRef.current,
          docs: {
            ...metaRef.current.docs,
            [rel]: { sortIndex: nextSortIndex(metaRef.current, findFolder(treeRef.current, folderRel)) },
          },
        };
        persistMeta();
        // 索引用真实正文(模板可能带 [[双链]]/待搜内容);空文档索引空串,标题索引自动取文件名
        searchRef.current.add(rel, content ?? "");
        wikiRefIdx.current.update(rel, content ?? "");
        await refreshTree();
        await openDoc(rel);
        return rel;
      } catch (e) {
        console.error("[kb] 新建文档失败:", e);
        return null;
      }
    },
    [openDoc, persistMeta, refreshTree],
  );

  const createFolder = useCallback(
    async (folderRel: string, name: string): Promise<string | null> => {
      const root = rootRef.current;
      if (!root) return null;
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
        return rel;
      } catch (e) {
        console.error("[kb] 新建文件夹失败:", e);
        return null;
      }
    },
    [persistMeta, refreshTree],
  );

  const removeEntry = useCallback(
    async (rel: string) => {
      const root = rootRef.current;
      if (!root) return;
      if (!(await flushSave())) return;
      try {
        markSelfWrite();
        await kbBackend.moveToTrash(root, rel);
        dropDocCache(rel);
        void refreshTrashCount();
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
        // tab 保留右/左邻文档策略,由 tree effect 的 reconcileTabs 统一处理
      } catch (e) {
        console.error("[kb] 删除失败:", e);
      }
    },
    [flushSave, persistMeta, refreshTree, refreshTrashCount, refreshTrashRefs],
  );

  /** 批量移入回收站:只处理 .md;一次 flush / 刷树 / 索引清理。 */
  const removeEntries = useCallback(
    async (rels: string[]): Promise<BatchResult> => {
      const root = rootRef.current;
      if (!root) return { ok: 0, failed: rels.length, errors: ["未打开知识库"] };
      if (!(await flushSave())) return { ok: 0, failed: rels.length, errors: ["自动保存失败,已取消批量删除"] };
      const unique = [...new Set(rels.filter((rel) => rel.toLowerCase().endsWith(".md")))];
      let ok = 0;
      const errors: string[] = [];
      for (const rel of unique) {
        try {
          markSelfWrite();
          await kbBackend.moveToTrash(root, rel);
          dropDocCache(rel);
          metaRef.current = removeMetaKeys(metaRef.current, rel, false);
          searchRef.current.remove(rel);
          wikiRefIdx.current.remove(rel);
          ok++;
        } catch (e) {
          errors.push(`「${rel}」移入回收站失败:${String(e)}`);
        }
      }
      if (ok) {
        persistMeta();
        void refreshTrashCount();
        void refreshTrashRefs();
        await refreshTree();
        // tab 保留右/左邻文档策略,由 tree effect 的 reconcileTabs 统一处理
      }
      return { ok, failed: unique.length - ok, errors };
    },
    [flushSave, persistMeta, refreshTree, refreshTrashCount, refreshTrashRefs],
  );

  /** 重命名 + 双链引用联动(5.1):flushSave 后由后端扫全库替换;
   * 当前文档的引用被改写时重载编辑器内容。文件夹改名会前缀重写
   * 当前文档路径与前进/后退历史,避免旧路径失效。 */
  const renameEntry = useCallback(
    async (rel: string, newTitle: string) => {
      const root = rootRef.current;
      if (!root) return null;
      if (!(await flushSave())) return null; // 磁盘替换引用前,当前文档最新内容必须先落盘
      try {
        markSelfWrite();
        const result = await kbBackend.renameEntry(root, rel, newTitle);
        // 兜底:若后端仍返回绝对路径,按旧 rel 重拼相对路径(Win canonicalize strip 失败实录)
        const newPath = coerceRelPath(rel, result.newPath);
        const resultNorm = { ...result, newPath };
        const isDir = !rel.endsWith(".md");
        metaRef.current = renameMetaKeys(metaRef.current, rel, newPath, isDir);
        // 冻结同级视觉序:无 sortIndex 时按名排序,改名会跳位
        const parentRel = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        metaRef.current = preserveOrderAfterRename(
          metaRef.current,
          findFolder(treeRef.current, parentRel),
          rel,
          newPath,
        );
        // 改名后的排序偏好立刻落盘(不去抖),避免随后 FS 事件重扫时丢序
        window.clearTimeout(metaWriteTimer.current);
        void kbBackend.writeMeta(root, serializeMeta(metaRef.current)).catch(() => {});
        rewriteSnapKeys(rel, newPath); // 快照节流状态跟随新路径
        rewriteDocCache(rel, newPath);
        // 索引 key 迁移:旧路径条目挪到新路径(内容从索引外重读太贵,直接重建该条)
        const affected = flattenDocs(treeRef.current)
          .map((d) => d.path)
          .filter((p) => p === rel || (isDir && p.startsWith(rel + "/")));
        for (const p of affected) searchRef.current.remove(p);
        scheduleIndexRebuild();
        // 路径前缀重写:自身改名,或所在文件夹(含祖先)改名
        const rewrite = (p: string) =>
          p === rel
            ? newPath
            : p.startsWith(rel + "/")
              ? newPath + p.slice(rel.length)
              : p;
        const cur = pathRef.current;
        const newCur = cur ? rewrite(cur) : null;
        // 乐观改树 + 当前路径同帧更新,避免 refresh 前高亮空窗、顺序闪跳
        const nextTree = sortTree(
          rewriteTreePaths(treeRef.current, rel, newPath),
          metaRef.current,
        );
        treeRef.current = nextTree;
        setTree(nextTree);
        if (newCur) {
          pathRef.current = newCur; // 串行连续改名必须立刻可见,不能等 setState 重渲染
          setCurrentPath(newCur);
          if (newCur !== rel) kbBackend.setLastDoc(newCur).catch(() => {});
        }
        applyTabs(rewriteTabPaths(tabsRef.current, activeTabIdRef.current, rel, newPath));
        markSelfWrite(); // 拉长静默窗,挡住 rename 触发的 FS 重扫抢在乐观树之前
        await refreshTree();
        // refresh 后 dual-check:确保高亮仍钉在新路径(防中途被旧 lastDoc/监听冲掉)
        if (newCur && pathRef.current === newCur) {
          setCurrentPath(newCur);
        }
        if (newCur && resultNorm.updatedFiles.includes(newCur)) {
          const content = await kbBackend.readDoc(root, newCur).catch(() => null);
          if (content != null) {
            dirtyRef.current = null;
            setMarkdown(content);
            savedMdRef.current = content;
            docCacheRef.current.set(newCur, content);
            setSaveState("saved");
          }
        }
        return resultNorm;
      } catch (e) {
        console.error("[kb] 重命名失败:", e);
        return null;
      }
    },
    [applyTabs, flushSave, persistMeta, refreshTree, rewriteSnapKeys, scheduleIndexRebuild],
  );

  /* ---------------- 移动(拖拽调整层级,5.1) ---------------- */

  const moveEntry = useCallback(
    async (srcRel: string, destFolderRel: string, orderedPaths?: string[]) => {
      const root = rootRef.current;
      if (!root) return null;
      if (!(await flushSave())) return null;
      try {
        markSelfWrite();
        const result = await kbBackend.moveEntry(root, srcRel, destFolderRel);
        if (result.newPath === srcRel) return result; // 已在目标位置,幂等
        const isDir = !srcRel.endsWith(".md");
        metaRef.current = renameMetaKeys(metaRef.current, srcRel, result.newPath, isDir);
        rewriteSnapKeys(srcRel, result.newPath); // 快照节流状态跟随新路径
        rewriteDocCache(srcRel, result.newPath);
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
        if (newCur && newCur !== cur) {
          pathRef.current = newCur;
          setCurrentPath(newCur);
        }
        applyTabs(rewriteTabPaths(tabsRef.current, activeTabIdRef.current, srcRel, result.newPath));
        await refreshTree();
        // 引用被联动改写的当前文档:重读落盘版,避免编辑器旧内容盖回
        if (newCur && result.updatedFiles.includes(newCur)) {
          const content = await kbBackend.readDoc(root, newCur).catch(() => null);
          if (content != null) {
            dirtyRef.current = null;
            setMarkdown(content);
            savedMdRef.current = content;
            setSaveState("saved");
          }
        }
        return result;
      } catch (e) {
        console.error("[kb] 移动失败:", e);
        return null;
      }
    },
    [applyTabs, flushSave, persistMeta, refreshTree, rewriteSnapKeys, scheduleIndexRebuild],
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

  /** 一次展开/折叠全部文件夹;遍历树后批量写 meta,只触发一次持久化 */
  const setAllCollapsed = useCallback(
    (nextCollapsed: boolean) => {
      const folderRels: string[] = [];
      const walk = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (!node.isDir) continue;
          folderRels.push(node.path);
          walk(node.children);
        }
      };
      walk(treeRef.current);
      if (folderRels.length === 0) return;
      setCollapsed(nextCollapsed ? new Set(folderRels) : new Set());
      metaRef.current = setFoldersCollapsed(metaRef.current, folderRels, nextCollapsed);
      persistMeta();
    },
    [persistMeta],
  );

  /** 面包屑定位:批量展开目标文件夹及其父级,一次写 meta */
  const expandFolders = useCallback(
    (folderRels: string[]) => {
      const unique = [...new Set(folderRels.filter(Boolean))];
      if (!unique.length) return;
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const rel of unique) next.delete(rel);
        return next;
      });
      metaRef.current = setFoldersCollapsed(metaRef.current, unique, false);
      persistMeta();
    },
    [persistMeta],
  );

  /* ---------------- 目录树内置图标(5.1 UI 偏好) ---------------- */

  /** 设置/清除文件或文件夹图标;meta 持久化,树引用刷新以驱动图标渲染 */
  const setTreeIcon = useCallback(
    (rel: string, isDir: boolean, icon: string | null) => {
      metaRef.current = setEntryIcon(metaRef.current, rel, isDir, icon);
      persistMeta();
      const sorted = sortTree(treeRef.current, metaRef.current);
      treeRef.current = sorted;
      setTree(sorted);
    },
    [persistMeta],
  );

  /* ---------------- 置顶与标签(6.3-2/3) ---------------- */

  /** 文档置顶/取消置顶:meta 偏好 + 树序即时重排(置顶组内仍按原 sortIndex 序) */
  const togglePinned = useCallback(
    (rel: string, pinned: boolean) => {
      metaRef.current = setDocPinned(metaRef.current, rel, pinned);
      persistMeta();
      const sorted = sortTree(treeRef.current, metaRef.current);
      treeRef.current = sorted;
      setTree(sorted);
    },
    [persistMeta],
  );

  /** 文档标签整体替换:meta 持久化 + 搜索索引即时更新(标签参与搜索);
   *  树序不变但引用刷新,驱动 allTags/currentTags 派生值 */
  const setTags = useCallback(
    (rel: string, tags: string[]) => {
      metaRef.current = setDocTags(metaRef.current, rel, tags);
      persistMeta();
      const sorted = sortTree(treeRef.current, metaRef.current);
      treeRef.current = sorted;
      setTree(sorted);
      if (rel === pathRef.current && searchRef.current.size > 0) {
        searchRef.current.add(rel, savedMdRef.current ?? "", tags);
      }
    },
    [persistMeta],
  );

  /* ---- 上次光标/滚动位置(打开文档时恢复;meta 层,不影响正文) ---- */

  /** 记录某文档的上次编辑位置(切文档/失焦时落 meta) */
  const saveCursor = useCallback(
    (rel: string, pos: number, scrollTop: number) => {
      const cur = metaRef.current.docs[rel]?.cursor;
      if (cur && cur.pos === pos && cur.scrollTop === scrollTop) return;
      const docs = {
        ...metaRef.current.docs,
        [rel]: { ...metaRef.current.docs[rel], cursor: { pos, scrollTop } },
      };
      metaRef.current = { ...metaRef.current, docs };
      persistMeta();
    },
    [persistMeta],
  );

  /** 读取某文档的上次编辑位置(无记录返回 null) */
  const getCursor = useCallback(
    (rel: string): { pos: number; scrollTop: number } | null =>
      metaRef.current.docs[rel]?.cursor ?? null,
    [],
  );

  /** V3 批量加/减标签:一次重建树与索引,避免逐篇多次渲染。 */
  const setTagsMany = useCallback(
    (rels: string[], add: string[], remove: string[]) => {
      const drop = new Set(remove);
      let changed = 0;
      let nextMeta = metaRef.current;
      for (const rel of rels) {
        if (!rel.endsWith(".md")) continue;
        const current = nextMeta.docs[rel]?.tags ?? [];
        const merged = [...current, ...add].filter((tag) => !drop.has(tag));
        const next = setDocTags(nextMeta, rel, merged).docs[rel]?.tags ?? [];
        if (next.length === current.length && next.every((tag, i) => tag === current[i])) continue;
        nextMeta = setDocTags(nextMeta, rel, next);
        changed++;
      }
      if (!changed) return 0;
      metaRef.current = nextMeta;
      persistMeta();
      const sorted = sortTree(treeRef.current, metaRef.current);
      treeRef.current = sorted;
      setTree(sorted);
      scheduleIndexRebuild();
      return changed;
    },
    [persistMeta, scheduleIndexRebuild],
  );

  /** 全库标签清单(树/meta 更新点位刷新) */
  const allTags = useMemo(() => allTagsOf(metaRef.current), [tree, kbRoot]);
  /** 全库标签 → 文档数(左侧筛选浮层展示) */
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const doc of Object.values(metaRef.current.docs)) {
      for (const tag of doc.tags ?? []) counts[tag] = (counts[tag] ?? 0) + 1;
    }
    return counts;
  }, [tree, kbRoot]);
  /** 当前文档标签 */
  const currentTags = useMemo(
    () => metaRef.current.docs[currentPath ?? ""]?.tags ?? [],
    [tree, currentPath],
  );
  /** 文件/文档 → 内置图标 ID(meta 偏好;目录树渲染用) */
  const entryIcons = useMemo(() => {
    const map = new Map<string, string>();
    for (const [rel, v] of Object.entries(metaRef.current.folders)) {
      if (v.icon) map.set(rel, v.icon);
    }
    for (const [rel, v] of Object.entries(metaRef.current.docs)) {
      if (v.icon) map.set(rel, v.icon);
    }
    return map;
  }, [tree, kbRoot]);
  /** 置顶文档路径集合(树序已在 sortTree 提前;此集合供图标与拖拽豁免) */
  const pinnedDocs = useMemo(() => {
    const s = new Set<string>();
    for (const [rel, v] of Object.entries(metaRef.current.docs)) if (v.pinned) s.add(rel);
    return s;
  }, [tree, kbRoot]);
  /** 带某标签的文档集合(左栏筛选过滤用) */
  const docsByTag = useCallback((tag: string): Set<string> => {
    const s = new Set<string>();
    for (const [rel, v] of Object.entries(metaRef.current.docs)) {
      if (v.tags?.includes(tag)) s.add(rel);
    }
    return s;
  }, []);

  /* ---------------- 回收站(5.1.1) ---------------- */

  const listTrash = useCallback(async (): Promise<TrashEntry[]> => {
    const root = rootRef.current;
    if (!root) return [];
    const entries = await kbBackend.listTrash(root);
    setTrashCount(topLevelTrashCount(entries));
    return entries;
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
      void refreshTrashCount();
      void rebuildIndex(); // 恢复可能带回多篇文档,重建最稳
      return finalRel;
    },
    [rebuildIndex, refreshTree, refreshTrashCount],
  );

  /** V3 批量恢复:默认在冲突时恢复为新名称,绝不静默覆盖库内文档。 */
  const restoreTrashMany = useCallback(
    async (rels: string[], strategy: "overwrite" | "rename" = "rename"): Promise<BatchResult> => {
      const root = rootRef.current;
      if (!root) throw new Error("未打开知识库");
      let ok = 0;
      const errors: string[] = [];
      for (const rel of rels) {
        try {
          markSelfWrite();
          await kbBackend.restoreTrash(root, rel, strategy);
          ok++;
        } catch (e) {
          errors.push(`恢复「${rel}」失败:${String(e)}`);
        }
      }
      await refreshTree();
      void refreshTrashCount();
      void rebuildIndex();
      void refreshTrashRefs();
      return { ok, failed: rels.length - ok, errors };
    },
    [rebuildIndex, refreshTree, refreshTrashRefs, refreshTrashCount],
  );

  /** 彻底删除/清空回收站(不可恢复);不碰库内文件 → 无需刷树/重建索引 */
  const purgeTrash = useCallback(async (rel: string): Promise<void> => {
    const root = rootRef.current;
    if (!root) throw new Error("未打开知识库");
    markSelfWrite();
    await kbBackend.purgeTrash(root, rel);
    void refreshTrashCount();
    void refreshTrashRefs();
  }, [refreshTrashCount, refreshTrashRefs]);

  const emptyTrash = useCallback(async (): Promise<void> => {
    const root = rootRef.current;
    if (!root) throw new Error("未打开知识库");
    markSelfWrite();
    await kbBackend.emptyTrash(root);
    setTrashCount(0);
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

  /** 斜杠菜单「附件」(6.1.5):任意类型文件选择 → assets;取消返回 null。
   *  返回编辑器词汇(href = 后端 src,attachment 节点 attrs 同名) */
  const importAttachmentsFromPicker = useCallback(
    async (): Promise<{ name: string; href: string }[] | null> => {
      const root = rootRef.current;
      const rel = pathRef.current;
      if (!root || !rel) return null;
      markSelfWrite();
      const items = await kbBackend.importAttachmentsFromPicker(root, rel);
      return items?.map(({ name, src }) => ({ name, href: src })) ?? null;
    },
    [],
  );

  /** 附件卡片点击(6.1.5):解析库内路径 → 唤起系统打开;结果三态见 KbBackend.openPath */
  const openAttachment = useCallback(
    async (src: string): Promise<"ok" | "missing" | "unsupported"> => {
      const root = rootRef.current;
      const rel = pathRef.current;
      if (!root || !rel) return "missing";
      return kbBackend.openPath(root, rel, src);
    },
    [],
  );

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

  // 首启(5.0.4):上次库仍有效 → 直开;否则欢迎页。
  // §8 通用-启动:「显示欢迎页」偏好下不自动直开(recent 列表照常恢复)
  useEffect(() => {
    void (async () => {
      try {
        const [state, raw] = await Promise.all([
          kbBackend.getRecent(),
          kbBackend.getSettings().catch(() => "{}"),
        ]);
        setRecent(state);
        const launch = parseSettings(raw).launch;
        if (state.last && launch === "last") {
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
    openingKb,
    bootError,
    kbRoot,
    tree,
    currentPath,
    tabs,
    activeTabId,
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
    activateTab,
    closeTabById,
    closeOthers,
    closeLeft,
    closeRight,
    reorderDocTabs,
    navBack,
    navForward,
    openKbAt,
    createKbAt,
    pickAndCreate,
    pickAndOpen,
    closeKb,
    /** 立即冲刷未落盘内容(关窗/退出/挂后台前调用) */
    flushSave,
    /** App 注册切文档前钩子(冲刷编辑器去抖稿) */
    setBeforeSwitch,
    createDoc,
    createFolder,
    removeEntry,
    removeEntries,
    renameEntry,
    moveEntry,
    search,
    rebuildIndex,
    resolveExternal,
    toggleCollapse,
    setAllCollapsed,
    expandFolders,
    persistSiblingOrder,
    setTreeIcon,
    entryIcons,
    togglePinned,
    setTags,
    setTagsMany,
    saveCursor,
    getCursor,
    allTags,
    tagCounts,
    currentTags,
    pinnedDocs,
    docsByTag,
    listTrash,
    restoreTrash,
    restoreTrashMany,
    purgeTrash,
    emptyTrash,
    trashCount,
    getBacklinks,
    refsVersion,
    orphanMeta,
    claimOrphan,
    claimOrphansBatch,
    discardOrphan,
    discardOrphansBatch,
    saveImageFiles,
    /** 最近一次打开失败的文档路径(供上层 toast;成功打开后清空) */
    docError,
    importImagesFromPicker,
    importAttachmentsFromPicker,
    openAttachment,
    importDocs,
    exportText,
    readAssetBase64,
    assetSrcResolver,
    /* ---- 历史快照(6.2) ---- */
    historyVersion,
    listHistory,
    readHistory,
    snapshotNow,
    restoreSnapshot,
  };
}

export { KbConflictError };
