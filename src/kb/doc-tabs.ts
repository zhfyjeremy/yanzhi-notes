import type { WorkspaceState } from "./types";

/**
 * 文档标签页纯状态变换:运行时 tab 只引用文档路径,不持有编辑器实例或正文。
 * 历史栈属于单个 tab;持久化时只落 path 顺序与 active path。
 */

export interface DocTab {
  /** 会话内稳定 id;重命名/移动时 id 不变、path 跟随磁盘路径 */
  id: string;
  path: string;
  back: string[];
  front: string[];
}

export type OpenDocBehavior = "existing-or-new" | "current";

export interface TabsChange {
  tabs: DocTab[];
  activeId: string | null;
  changed: boolean;
}

let tabSeq = 0;
const nextTabId = (path: string) => `${path}:${Date.now().toString(36)}:${++tabSeq}`;

export function parseWorkspace(raw: string): Pick<WorkspaceState, "tabs" | "activePath"> | null {
  try {
    const value = JSON.parse(raw) as Partial<WorkspaceState>;
    if (!Array.isArray(value.tabs)) return null;
    const seen = new Set<string>();
    const tabs: string[] = [];
    for (const item of value.tabs) {
      if (typeof item !== "string" || !item || seen.has(item)) continue;
      seen.add(item);
      tabs.push(item);
    }
    return {
      tabs,
      activePath: typeof value.activePath === "string" && seen.has(value.activePath)
        ? value.activePath
        : null,
    };
  } catch {
    return null;
  }
}

export function workspaceOf(tabs: DocTab[], activeId: string | null): WorkspaceState {
  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  return { version: 1, tabs: tabs.map((tab) => tab.path), activePath: active?.path ?? null };
}

export function restoreTabs(paths: string[], activePath: string | null): TabsChange {
  const seen = new Set<string>();
  const tabs = paths.filter((path) => {
    if (!path || seen.has(path)) return false;
    seen.add(path);
    return true;
  }).map((path) => ({ id: `restore:${path}`, path, back: [], front: [] }));
  const activeId = activePath && seen.has(activePath)
    ? tabs.find((tab) => tab.path === activePath)!.id
    : (tabs[0]?.id ?? null);
  return { tabs, activeId, changed: true };
}

/** 离开 fromPath 进入目标 tab 时写入后退栈,并清空前进栈(浏览器式)。 */
function pushBack(tab: DocTab, fromPath: string | null | undefined): DocTab {
  if (!fromPath || fromPath === tab.path) return tab;
  const last = tab.back[tab.back.length - 1];
  if (last === fromPath) return { ...tab, front: [] };
  return { ...tab, back: [...tab.back, fromPath], front: [] };
}

export function openInTabs(
  tabs: DocTab[],
  activeId: string | null,
  path: string,
  behavior: OpenDocBehavior = "existing-or-new",
): TabsChange {
  const active = activeId ? tabs.find((tab) => tab.id === activeId) : undefined;
  const fromPath = active?.path ?? null;
  const existing = tabs.find((tab) => tab.path === path);

  // 目标已有 tab:激活它,并把上一篇记进该 tab 的后退历史
  if (existing) {
    if (existing.id === activeId) return { tabs, activeId, changed: false };
    return {
      tabs: tabs.map((tab) => (tab.id === existing.id ? pushBack(tab, fromPath) : tab)),
      activeId: existing.id,
      changed: true,
    };
  }

  // current:在当前 tab 内跳转(双链默认),旧路径进后退栈
  if (behavior === "current" && active) {
    return {
      tabs: tabs.map((tab) =>
        tab.id === activeId
          ? { ...tab, path, back: [...tab.back, active.path], front: [] }
          : tab,
      ),
      activeId,
      changed: true,
    };
  }

  // 新 tab:带上离开页,便于立刻后退
  const tab: DocTab = {
    id: nextTabId(path),
    path,
    back: fromPath && fromPath !== path ? [fromPath] : [],
    front: [],
  };
  return { tabs: [...tabs, tab], activeId: tab.id, changed: true };
}

export function closeTab(tabs: DocTab[], activeId: string | null, tabId: string): TabsChange {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return { tabs, activeId, changed: false };
  const next = tabs.filter((tab) => tab.id !== tabId);
  const activeIdAfter = activeId === tabId
    ? (next[index]?.id ?? next[index - 1]?.id ?? null)
    : activeId;
  return { tabs: next, activeId: activeIdAfter, changed: true };
}

export function closeOtherTabs(tabs: DocTab[], tabId: string): TabsChange {
  const target = tabs.find((tab) => tab.id === tabId);
  if (!target || tabs.length === 1) return { tabs, activeId: target?.id ?? tabId, changed: false };
  return { tabs: [target], activeId: target.id, changed: true };
}

export function closeTabsToLeft(tabs: DocTab[], activeId: string | null, tabId: string): TabsChange {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return { tabs, activeId, changed: false };
  const next = tabs.slice(index);
  const active = tabs.find((tab) => tab.id === activeId);
  const activeRemoved = !!active && tabs.indexOf(active) < index;
  return {
    tabs: next,
    activeId: activeRemoved ? tabId : activeId,
    changed: next.length !== tabs.length,
  };
}

export function closeTabsToRight(tabs: DocTab[], activeId: string | null, tabId: string): TabsChange {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return { tabs, activeId, changed: false };
  const next = tabs.slice(0, index + 1);
  const active = tabs.find((tab) => tab.id === activeId);
  const activeRemoved = !!active && tabs.indexOf(active) > index;
  return {
    tabs: next,
    activeId: activeRemoved ? tabId : activeId,
    changed: next.length !== tabs.length,
  };
}

export function reorderTabs(
  tabs: DocTab[],
  activeId: string | null,
  from: number,
  to: number,
): TabsChange {
  if (from === to || from < 0 || to < 0 || from >= tabs.length || to >= tabs.length) {
    return { tabs, activeId, changed: false };
  }
  const next = [...tabs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { tabs: next, activeId, changed: true };
}

export function neighborTabId(tabs: DocTab[], index: number): string | null {
  return tabs[index]?.id ?? tabs[index - 1]?.id ?? null;
}

const rewritePath = (path: string, oldRel: string, newRel: string) =>
  path === oldRel
    ? newRel
    : path.startsWith(oldRel + "/")
      ? newRel + path.slice(oldRel.length)
      : path;

export function rewriteTabPaths(
  tabs: DocTab[],
  activeId: string | null,
  oldRel: string,
  newRel: string,
): TabsChange {
  if (oldRel === newRel) return { tabs, activeId, changed: false };
  return {
    tabs: tabs.map((tab) => ({
      ...tab,
      path: rewritePath(tab.path, oldRel, newRel),
      back: tab.back.map((path) => rewritePath(path, oldRel, newRel)),
      front: tab.front.map((path) => rewritePath(path, oldRel, newRel)),
    })),
    activeId,
    changed: tabs.some((tab) =>
      tab.path === oldRel ||
      tab.path.startsWith(oldRel + "/") ||
      tab.back.some((p) => p === oldRel || p.startsWith(oldRel + "/")) ||
      tab.front.some((p) => p === oldRel || p.startsWith(oldRel + "/")),
    ),
  };
}

const keepValid = (paths: string[], valid: Set<string>) =>
  paths.filter((path) => valid.has(path));

export function pruneTabs(tabs: DocTab[], activeId: string | null, validPaths: Set<string>): TabsChange {
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId);
  const keptRaw = tabs.filter((tab) => validPaths.has(tab.path));
  const deduped = new Map<string, DocTab>();
  for (const tab of keptRaw) {
    const prev = deduped.get(tab.path);
    if (!prev || tab.id === activeId) deduped.set(tab.path, { ...tab, back: keepValid(tab.back, validPaths), front: keepValid(tab.front, validPaths) });
    else deduped.set(tab.path, { ...prev, back: keepValid(prev.back, validPaths), front: keepValid(prev.front, validPaths) });
  }
  const next = [...deduped.values()];
  const activeDropped = activeIndex >= 0 && !validPaths.has(tabs[activeIndex].path);
  const activeIdAfter = activeDropped
    ? neighborTabId(next, Math.min(activeIndex, next.length - 1))
    : (next.find((tab) => tab.id === activeId)?.id ?? activeId);
  return {
    tabs: next,
    activeId: activeIdAfter,
    changed:
      next.length !== tabs.length ||
      next.some((tab, i) => tab.path !== tabs[i]?.path) ||
      next.some((tab) => {
        const before = tabs.find((item) => item.id === tab.id);
        return (
          !!before &&
          (before.back.length !== tab.back.length ||
           before.front.length !== tab.front.length ||
           before.back.some((path, i) => path !== tab.back[i]) ||
           before.front.some((path, i) => path !== tab.front[i]))
        );
      }) ||
      activeIdAfter !== activeId,
  };
}

export function relativeTabIndex(tabs: DocTab[], activeId: string | null, delta: number): number | null {
  const index = tabs.findIndex((tab) => tab.id === activeId);
  if (index < 0 || tabs.length < 2) return null;
  return (index + delta + tabs.length) % tabs.length;
}
