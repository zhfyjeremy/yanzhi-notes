/**
 * 知识库后端双实现:
 * - tauri:pnpm tauri dev / 打包版,invoke → src-tauri/src/kb.rs(真文件系统)
 * - browser:pnpm dev 纯浏览器,localStorage mock(驱动脚本/编辑器管线开发用,无 fs)
 * 两者同构(KbBackend),上层代码不感知。
 * mock 的 trash/meta/assets/rename 语义与 Rust kb.rs 逐条对齐,跨端断裂会静默
 * undefined(serde camelCase 实录),改一边必须同步另一边。
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import type {
  AttachmentInfo,
  DocContent,
  HistoryEntry,
  KbBackend,
  RecentState,
  RecentFilesState,
  SingleDraft,
  RenameResult,
  TreeNode,
  TrashEntry,
} from "./types";
import { movePatternsFor, refPatternsFor, updateWikiRefs } from "./wiki-refs";
import { assetRelPosix, isExternalSrc } from "./asset-src";
import { migrateMarkdownAssetRefs } from "./assets";
import { STARTER_MD } from "./help-docs";
import { withNativeDialog } from "./dialog-gate";

export class KbNotEmptyError extends Error {
  constructor() {
    super("NOT_EMPTY");
  }
}

/** 选中的目录已是砚知库(含 .yanzhi,5.0.2-3):前端提示改用「打开」 */
export class KbIsYanzhiError extends Error {
  constructor() {
    super("IS_YANZHI");
  }
}

/** 真机 Tauri 环境(浏览器 vite dev 走 mock;原生菜单/事件监听须以此 gate) */
export const isTauriEnv = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/** restore_trash 原路径冲突(5.1.1):前端弹「覆盖/新名称/取消」三选一 */
export class KbConflictError extends Error {
  constructor() {
    super("CONFLICT");
  }
}

const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
};

const singleParent = (path: string): string =>
  path.includes("/") || path.includes("\\") ? path.replace(/[\\/][^\\/]+$/, "") : "";
const singleBase = (path: string): string => path.split(/[\\/]/).pop() ?? path;

const tauriBackend: KbBackend = {
  kind: "tauri",
  async pickFolder() {
    return (await withNativeDialog(() => invoke<string | null>("pick_folder"))) ?? null;
  },
  async createKb(root) {
    try {
      await invoke("create_kb", { root });
    } catch (e) {
      if (String(e).includes("NOT_EMPTY")) throw new KbNotEmptyError();
      if (String(e).includes("已是砚知知识库")) throw new KbIsYanzhiError();
      throw e;
    }
  },
  async forceCreateKb(root) {
    await invoke("force_create_kb", { root });
  },
  async openKb(root) {
    await invoke("open_kb", { root });
  },
  async scanTree(root) {
    return invoke<TreeNode[]>("scan_tree", { root });
  },
  async readDoc(root, rel) {
    return invoke<string>("read_doc", { root, rel });
  },
  async writeDoc(root, rel, content) {
    await invoke("write_doc", { root, rel, content });
  },
  async createDoc(root, folderRel, title, content) {
    return invoke<string>("create_doc", { root, folderRel, title, content: content ?? null });
  },
  async listTemplates(root) {
    return invoke<string[]>("list_templates", { root });
  },
  async readTemplate(root, name) {
    return invoke<string>("read_template", { root, name });
  },
  async writeTemplate(root, name, content) {
    await invoke("write_template", { root, name, content });
  },
  async deleteTemplate(root, name) {
    await invoke("delete_template", { root, name });
  },
  async openTemplatesDir(root) {
    await invoke("open_templates_dir", { root });
  },
  async createFolder(root, folderRel, name) {
    return invoke<string>("create_folder", { root, folderRel, name });
  },
  async moveToTrash(root, rel) {
    return invoke<string>("move_to_trash", { root, rel });
  },
  async renameEntry(root, rel, newTitle) {
    return invoke<RenameResult>("rename_entry", { root, rel, newTitle });
  },
  async moveEntry(root, src, destFolder) {
    return invoke<RenameResult>("move_entry", { root, src, destFolder });
  },
  async readMeta(root) {
    return invoke<string>("read_meta", { root });
  },
  async writeMeta(root, content) {
    await invoke("write_meta", { root, content });
  },
  async getRecent() {
    return invoke<RecentState>("get_recent");
  },
  async setRecent(root) {
    await invoke("set_recent", { root });
  },
  async pickSingleFile() {
    return (await withNativeDialog(() => invoke<string | null>("pick_single_file"))) ?? null;
  },
  async readSingleFile(path) {
    return invoke<string>("read_single_file", { path });
  },
  async writeSingleFile(path, content) {
    await invoke("write_single_file", { path, content });
  },
  async saveSingleFileAs(defaultName, content) {
    return (
      (await withNativeDialog(() =>
        invoke<string | null>("save_single_file_as", { defaultName, content }),
      )) ?? null
    );
  },
  async watchSingleFile(path) {
    await invoke("watch_single_file", { path });
  },
  async closeSingleFile(path) {
    await invoke("close_single_file", { path });
  },
  async getRecentFiles() {
    return invoke<RecentFilesState>("get_recent_files");
  },
  async setRecentFile(path) {
    await invoke("set_recent_file", { path });
  },
  async setLastDoc(rel) {
    await invoke("set_last_doc", { rel });
  },
  async getSettings() {
    return invoke<string>("get_settings");
  },
  async setSettings(content) {
    await invoke("set_settings", { content });
  },
  async readAllDocs(root) {
    return invoke<{ path: string; content: string }[]>("read_all_docs", { root });
  },
  async saveAsset(root, docRel, ext, bytes) {
    const r = await invoke<{ src: string }>("save_asset", {
      root,
      docRel,
      ext,
      // Vec<u8>:JSON 数组序列化,截图量级(<数 MB)可接受
      bytes: Array.from(bytes),
    });
    return r.src;
  },
  async importImagesFromPicker(root, docRel) {
    const paths =
      (await withNativeDialog(() => invoke<string[] | null>("pick_images"))) ?? null;
    if (!paths?.length) return null;
    const srcs: string[] = [];
    for (const p of paths) {
      const r = await invoke<{ src: string }>("import_asset", { root, docRel, srcAbs: p });
      srcs.push(r.src);
    }
    return srcs;
  },
  async importAttachmentsFromPicker(root, docRel): Promise<AttachmentInfo[] | null> {
    const paths =
      (await withNativeDialog(() => invoke<string[] | null>("pick_files"))) ?? null;
    if (!paths?.length) return null;
    const out: AttachmentInfo[] = [];
    for (const p of paths) {
      const r = await invoke<{ src: string }>("import_asset", { root, docRel, srcAbs: p });
      // 显示名 = 原文件名(用户认得),存储按 9.3 哈希命名
      out.push({ name: p.split(/[\\/]/).pop() || r.src, src: r.src });
    }
    return out;
  },
  async openPath(root, docRel, src) {
    const rel = assetRelPosix(docRel, src);
    if (!rel) return "missing" as const;
    try {
      await invoke("open_path", { root, rel });
      return "ok" as const;
    } catch {
      return "missing" as const;
    }
  },
  resolveAssetSrc(root, docRel, src) {
    if (isExternalSrc(src)) return src;
    const rel = assetRelPosix(docRel, src);
    if (!rel) return src;
    // convertFileSrc 是纯字符串拼接(asset: 协议),同步可用
    return convertFileSrc(`${root}/${rel}`);
  },
  async listTrash(root) {
    return invoke<TrashEntry[]>("list_trash", { root });
  },
  async restoreTrash(root, rel, strategy) {
    try {
      return await invoke<string>("restore_trash", { root, rel, strategy: strategy ?? null });
    } catch (e) {
      if (String(e).includes("CONFLICT")) throw new KbConflictError();
      throw e;
    }
  },
  async purgeTrash(root, rel) {
    await invoke<void>("purge_trash", { root, rel });
  },
  async emptyTrash(root) {
    await invoke<void>("empty_trash", { root });
  },
  async readAllTrashDocs(root) {
    return invoke<DocContent[]>("read_all_trash_docs", { root });
  },
  async importDocsFromPicker(root, folderRel) {
    const paths =
      (await withNativeDialog(() => invoke<string[] | null>("pick_docs"))) ?? null;
    if (!paths?.length) return null;
    return invoke<string[]>("import_docs", { root, folderRel, srcPaths: paths });
  },
  async exportText(defaultName, filterExt, content) {
    return (
      (await withNativeDialog(() =>
        invoke<string | null>("export_text", { defaultName, filterExt, content }),
      )) ?? null
    );
  },
  async readAssetBase64(root, rel) {
    return invoke<{ data: string; mime: string } | null>("read_asset_base64", { root, rel });
  },
  async listAssets(root) {
    return invoke<string[]>("list_assets", { root });
  },
  async deleteAssets(root, rels) {
    return invoke<number>("delete_assets", { root, rels });
  },
  async listHistory(root, rel) {
    return invoke<HistoryEntry[]>("list_history", { root, rel });
  },
  async readHistory(root, rel, id) {
    return invoke<string>("read_history", { root, rel, id });
  },
  async saveSnapshot(root, rel, content, auto, keep) {
    return invoke<HistoryEntry>("save_snapshot", { root, rel, content, auto, keep });
  },
  async pruneHistory(root, keep) {
    return invoke<number>("prune_history", { root, keep });
  },
  async listenFsEvent(cb) {
    const { listen } = await import("@tauri-apps/api/event");
    const un = await listen<string[]>("kb-fs-event", (e) => cb(e.payload));
    return un;
  },
  async listenSingleFileEvent(cb) {
    const { listen } = await import("@tauri-apps/api/event");
    const un = await listen<string>("yz-single-file-event", (e) => cb(e.payload));
    return un;
  },
  async saveSingleAsset(path, ext, bytes) {
    const r = await invoke<{ src: string }>("save_asset", {
      root: singleParent(path),
      docRel: singleBase(path),
      ext,
      bytes,
    });
    return r.src;
  },
  async importSingleImagesFromPicker(path) {
    const paths =
      (await withNativeDialog(() => invoke<string[] | null>("pick_images"))) ?? null;
    if (!paths?.length) return null;
    const out: string[] = [];
    for (const p of paths) {
      const r = await invoke<{ src: string }>("import_asset", {
        root: singleParent(path),
        docRel: singleBase(path),
        srcAbs: p,
      });
      out.push(r.src);
    }
    return out;
  },
  async importSingleAttachmentsFromPicker(path) {
    const paths = await invoke<string[] | null>("pick_files");
    if (!paths?.length) return null;
    const out: AttachmentInfo[] = [];
    for (const p of paths) {
      const r = await invoke<{ src: string }>("import_asset", {
        root: singleParent(path),
        docRel: singleBase(path),
        srcAbs: p,
      });
      out.push({ name: singleBase(p), src: r.src });
    }
    return out;
  },
  async openSingleAttachment(path, src) {
    const rel = assetRelPosix(singleBase(path), src);
    if (!rel) return "unsupported" as const;
    try {
      await invoke("open_path", { root: singleParent(path), rel });
      return "ok" as const;
    } catch {
      return "missing" as const;
    }
  },
  async readSingleAssetBase64(path, src) {
    const rel = assetRelPosix(singleBase(path), src);
    if (!rel) return null;
    return invoke<{ data: string; mime: string } | null>("read_asset_base64", {
      root: singleParent(path),
      rel,
    });
  },
  resolveSingleAssetSrc(path, src) {
    return this.resolveAssetSrc(singleParent(path), singleBase(path), src);
  },
  async saveSingleToKb(root, path, content, assetSrcs) {
    return invoke<string>("save_single_to_kb", { root, path, content, assetSrcs });
  },
  async saveSingleDraft(path, content) {
    await invoke("save_single_draft", { path, content });
  },
  async getSingleDraft(path) {
    return invoke<SingleDraft | null>("get_single_draft", { path });
  },
  async clearSingleDraft(path) {
    await invoke("clear_single_draft", { path });
  },
  async takeStartupSingleFile() {
    return invoke<string | null>("take_startup_single_file");
  },
};

/* ---------------- browser mock:localStorage 里的假库 ---------------- */

const MOCK_KEY = "yz-mock-kb-v1";
const RECENT_KEY = "yz-mock-recent-v1";
const SINGLE_FILES_KEY = "yz-mock-single-files-v1";
const SINGLE_RECENT_KEY = "yz-mock-single-recent-v1";
const SINGLE_ASSETS_KEY = "yz-mock-single-assets-v1";
const SINGLE_DRAFT_KEY = "yz-mock-single-draft-v1";
const SETTINGS_KEY = "yz-mock-settings-v1";

interface MockFs {
  root: string; // 固定虚拟路径
  files: Record<string, string>; // rel -> md 内容
  folders: string[]; // rel 列表(含嵌套中间目录)
  meta: string; // .yanzhi/meta.json 原文
  trashFiles: Record<string, string>; // 原相对路径 -> md 内容
  trashFolders: string[]; // 被删文件夹原相对路径
  assets: Record<string, string>; // rel -> dataURL(浏览器 mock 的"图片盘")
  history: Record<string, Record<string, string>>; // rel -> 快照文件名 -> 内容(6.2)
  templates: Record<string, string>; // 模板名 -> md 原文(7.5,= .yanzhi/templates)
}

const SEED_DOCS: Record<string, string> = {
  "开始使用.md": STARTER_MD,
  "随笔/第一篇.md": "# 第一篇\n\nmock 正文,砚知本地知识库。\n\n- 列表一\n- 列表二\n",
  "tech/notes.md": "# Notes\n\nmock tech note with yanzhi search.\n",
};

function freshMock(): MockFs {
  return {
    root: "/mock-kb",
    files: { ...SEED_DOCS },
    folders: ["随笔", "tech"],
    meta: '{"version":1,"docs":{},"folders":{}}',
    trashFiles: {},
    trashFolders: [],
    assets: {},
    history: {},
    templates: {},
  };
}

function loadMock(): MockFs {
  const raw = localStorage.getItem(MOCK_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<MockFs>;
      return { ...freshMock(), ...parsed };
    } catch {
      /* 损坏则重建 */
    }
  }
  const fresh = freshMock();
  saveMock(fresh);
  return fresh;
}

function saveMock(fs: MockFs): void {
  localStorage.setItem(MOCK_KEY, JSON.stringify(fs));
}

/** FNV-1a 64 → 完整 16 hex(与 Rust fnv1a_hex 同式,跨端同名同图不重拷) */
function fnv1aHex(bytes: Uint8Array): string {
  const MASK = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n & MASK;
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = (hash * 0x100000001b3n) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/* ---------------- mock 历史快照(与 Rust kb.rs 的文件名索引同构) ---------------- */

/** 快照文件名 →(时间, 自动?);`<unix_ms>-<a|m>-<fnv16>.md`,杂物键返回 null */
function parseHistId(id: string): { time: number; auto: boolean } | null {
  const m = /^(\d{13})-([am])-([0-9a-f]{16})\.md$/.exec(id);
  return m ? { time: Number(m[1]), auto: m[2] === "a" } : null;
}

const histSortDesc = (a: string, b: string): number => {
  const pa = parseHistId(a);
  const pb = parseHistId(b);
  return (pb?.time ?? 0) - (pa?.time ?? 0) || (a < b ? 1 : a > b ? -1 : 0);
};

/** 快照 key 跟随改名/移动迁移(与 Rust move_history_dir 同构;目标已存在则合并) */
function moveHistKeys(fs: MockFs, oldRel: string, newRel: string): void {
  const src = fs.history[oldRel];
  if (!src) return;
  fs.history[newRel] = { ...(fs.history[newRel] ?? {}), ...src };
  delete fs.history[oldRel];
}

/** 彻底删除时清掉对应快照(文件夹 = 连子孙 key) */
function dropHistKeys(fs: MockFs, rel: string): void {
  for (const k of Object.keys(fs.history)) {
    if (k === rel || k.startsWith(rel + "/")) delete fs.history[k];
  }
}

/** mock 树:文件夹在前字母序,与 Rust scan_dir 行为一致 */
function mockTree(fs: MockFs): TreeNode[] {
  const build = (prefix: string): TreeNode[] => {
    const folders = fs.folders
      .filter((f) => f.includes("/") === (prefix !== "") && (prefix === "" || f.startsWith(prefix + "/")))
      .filter((f) => f.slice(prefix ? prefix.length + 1 : 0).includes("/") === false)
      .map<TreeNode>((f) => {
        const name = f.split("/").pop()!;
        return { name, path: f, isDir: true, children: build(f) };
      });
    const docs = Object.keys(fs.files)
      .filter((p) => (prefix ? p.startsWith(prefix + "/") : !p.includes("/")))
      .filter((p) => p.slice(prefix ? prefix.length + 1 : 0).includes("/") === false)
      .map<TreeNode>((p) => ({
        name: p.split("/").pop()!.replace(/\.md$/i, ""),
        path: p,
        isDir: false,
        children: [],
      }));
    folders.sort((a, b) => a.name.localeCompare(b.name));
    docs.sort((a, b) => a.name.localeCompare(b.name));
    return [...folders, ...docs];
  };
  return build("");
}

function mockRecent(): RecentState {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "") as RecentState;
  } catch {
    return { last: null, recent: [] };
  }
}

function mockRecentFiles(): RecentFilesState {
  try {
    const parsed = JSON.parse(localStorage.getItem(SINGLE_RECENT_KEY) ?? "") as RecentFilesState;
    return { recent: Array.isArray(parsed.recent) ? parsed.recent.slice(0, 10) : [] };
  } catch {
    return { recent: [] };
  }
}

function loadSingleFiles(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SINGLE_FILES_KEY) ?? "{}") as Record<string, string>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveSingleFiles(files: Record<string, string>): void {
  localStorage.setItem(SINGLE_FILES_KEY, JSON.stringify(files));
}

function loadSingleAssets(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SINGLE_ASSETS_KEY) ?? "{}") as Record<string, string>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveSingleAssets(assets: Record<string, string>): void {
  localStorage.setItem(SINGLE_ASSETS_KEY, JSON.stringify(assets));
}

const parentOf = (rel: string): string => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

/** 与 Rust dedupe 同式:占用即追加 ` (n)`(只对活树判,回收站内容不算占用) */
function mockDedupe(fs: MockFs, rel: string): string {
  const dot = rel.lastIndexOf(".");
  const stem = dot > rel.lastIndexOf("/") ? rel.slice(0, dot) : rel;
  const ext = dot > rel.lastIndexOf("/") ? rel.slice(dot) : "";
  const exists = (r: string) =>
    r in fs.files ||
    fs.folders.includes(r) ||
    Object.keys(fs.files).some((p) => p.startsWith(r + "/"));
  let candidate = rel;
  let n = 2;
  while (exists(candidate)) candidate = `${stem} (${n++})${ext}`;
  return candidate;
}

/** mock 文件选择器:隐藏 input,await 用户选择(取消 reject → 调用方返回 null) */
function pickFilesViaInput(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    input.addEventListener("change", () => {
      input.remove();
      resolve(Array.from(input.files ?? []));
    });
    // 取消不触发 change;focus 回来且没选文件时清理(worst case 留一个隐藏 input,无碍)
    window.addEventListener(
      "focus",
      () => setTimeout(() => {
        if (document.body.contains(input)) {
          input.remove();
          reject(new Error("CANCEL"));
        }
      }, 1000),
      { once: true },
    );
    document.body.append(input);
    input.click();
  });
}

const browserBackend: KbBackend = {
  kind: "browser",
  async pickFolder() {
    return loadMock().root; // 无系统对话框,直接用 mock 根
  },
  async createKb() {
    /* mock 库始终存在,直接成功 */
  },
  async forceCreateKb() {},
  async openKb() {},
  async scanTree() {
    return mockTree(loadMock());
  },
  async readDoc(_root, rel) {
    const fs = loadMock();
    if (!(rel in fs.files)) throw new Error("文件不存在: " + rel);
    return fs.files[rel];
  },
  async writeDoc(_root, rel, content) {
    const fs = loadMock();
    fs.files[rel] = content;
    saveMock(fs);
  },
  async createDoc(_root, folderRel, title, content) {
    const fs = loadMock();
    let rel = (folderRel ? folderRel + "/" : "") + title + ".md";
    let n = 2;
    while (rel in fs.files) rel = `${folderRel ? folderRel + "/" : ""}${title} (${n++}).md`;
    // 与 Rust 同构:无内容建空文档(此前 mock 误写 `# title`,真机一直是空文件)
    fs.files[rel] = content ?? "";
    saveMock(fs);
    return rel;
  },
  async listTemplates() {
    return Object.keys(loadMock().templates).sort();
  },
  async readTemplate(_root, name) {
    const t = loadMock().templates[name];
    if (t === undefined) throw new Error("模板不存在: " + name);
    return t;
  },
  async writeTemplate(_root, name, content) {
    const fs = loadMock();
    fs.templates[name] = content;
    saveMock(fs);
  },
  async deleteTemplate(_root, name) {
    const fs = loadMock();
    if (!(name in fs.templates)) throw new Error("模板不存在: " + name);
    delete fs.templates[name];
    saveMock(fs);
  },
  async openTemplatesDir() {
    /* mock 无系统文件管理器,noop */
  },
  async createFolder(_root, folderRel, name) {
    const fs = loadMock();
    let rel = (folderRel ? folderRel + "/" : "") + name;
    let n = 2;
    while (fs.folders.includes(rel)) rel = `${folderRel ? folderRel + "/" : ""}${name} (${n++})`;
    fs.folders.push(rel);
    saveMock(fs);
    return rel;
  },
  async moveToTrash(_root, rel) {
    const fs = loadMock();
    if (rel in fs.files) {
      fs.trashFiles[rel] = fs.files[rel];
      delete fs.files[rel];
    } else if (fs.folders.includes(rel)) {
      // 整夹入站:子文件记到 trashFiles(原 key 不动),夹本身记 trashFolders
      fs.trashFolders.push(rel);
      for (const key of Object.keys(fs.files)) {
        if (key.startsWith(rel + "/")) {
          fs.trashFiles[key] = fs.files[key];
          delete fs.files[key];
        }
      }
      fs.folders = fs.folders.filter((f) => f !== rel && !f.startsWith(rel + "/"));
    }
    saveMock(fs);
    return rel;
  },
  async renameEntry(_root, rel, newTitle) {
    const fs = loadMock();
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const isDir = !(rel in fs.files);
    let newRel: string;
    if (!isDir) {
      newRel = (parent ? parent + "/" : "") + newTitle + ".md";
      if (newRel !== rel && newRel in fs.files) throw new Error("目标名称已存在");
      fs.files[newRel] = fs.files[rel];
      delete fs.files[rel];
    } else {
      // 文件夹:自身 + 其下所有条目改前缀
      newRel = (parent ? parent + "/" : "") + newTitle;
      if (fs.folders.includes(newRel)) throw new Error("目标名称已存在");
      fs.folders = fs.folders.map((f) =>
        f === rel ? newRel : f.startsWith(rel + "/") ? newRel + f.slice(rel.length) : f,
      );
      for (const key of Object.keys(fs.files)) {
        if (key === rel || key.startsWith(rel + "/")) {
          const newKey = newRel + key.slice(rel.length);
          fs.files[newKey] = fs.files[key];
          delete fs.files[key];
        }
      }
    }
    // 快照 key 跟随迁移(与 Rust move_history_dir 同构:文档/文件夹都走前缀改写)
    for (const key of Object.keys(fs.history)) {
      if (key === rel || key.startsWith(rel + "/")) {
        moveHistKeys(fs, key, newRel + key.slice(rel.length));
      }
    }
    // 引用联动(与 Rust rename_entry 同构)
    const refs = refPatternsFor(rel, newRel, isDir);
    const updatedFiles: string[] = [];
    let refCount = 0;
    for (const key of Object.keys(fs.files)) {
      const { content, count } = updateWikiRefs(fs.files[key], refs);
      if (count > 0) {
        fs.files[key] = content;
        updatedFiles.push(key);
        refCount += count;
      }
    }
    saveMock(fs);
    return { newPath: newRel, updatedFiles, refCount };
  },
  async moveEntry(_root, src, destFolder) {
    const fs = loadMock();
    const isDir = !(src in fs.files);
    const name = src.split("/").pop() ?? "";
    const newRel = (destFolder ? destFolder + "/" : "") + name;
    if (newRel === src) return { newPath: newRel, updatedFiles: [], refCount: 0 };
    if (destFolder === src || destFolder.startsWith(src + "/")) throw new Error("不能移动到自身内部");
    if (isDir ? fs.folders.includes(newRel) : newRel in fs.files) {
      throw new Error("目标位置已有同名条目");
    }
    let assetMigrated = false;
    if (isDir) {
      fs.folders = fs.folders.map((f) =>
        f === src ? newRel : f.startsWith(src + "/") ? newRel + f.slice(src.length) : f,
      );
      for (const key of Object.keys(fs.files)) {
        if (key === src || key.startsWith(src + "/")) {
          fs.files[newRel + key.slice(src.length)] = fs.files[key];
          delete fs.files[key];
        }
      }
    } else {
      const migrated = migrateMarkdownAssetRefs(fs.files[src], src, newRel);
      for (const copy of migrated.copies) {
        if (!(copy.to in fs.assets) && copy.from in fs.assets) fs.assets[copy.to] = fs.assets[copy.from];
      }
      fs.files[newRel] = migrated.content;
      assetMigrated = migrated.content !== fs.files[src];
      delete fs.files[src];
    }
    // 快照 key 跟随移动(与 Rust move_history_dir 同构)
    for (const key of Object.keys(fs.history)) {
      if (key === src || key.startsWith(src + "/")) {
        moveHistKeys(fs, key, newRel + key.slice(src.length));
      }
    }
    // 引用联动(与 Rust move_entry 同构:路径前缀改写,名字不变裸名不动)
    const refs = movePatternsFor(src, newRel, isDir);
    const updatedFiles: string[] = assetMigrated ? [newRel] : [];
    let refCount = 0;
    for (const key of Object.keys(fs.files)) {
      const { content, count } = updateWikiRefs(fs.files[key], refs);
      if (count > 0) {
        fs.files[key] = content;
        updatedFiles.push(key);
        refCount += count;
      }
    }
    saveMock(fs);
    return { newPath: newRel, updatedFiles, refCount };
  },
  async readMeta() {
    return loadMock().meta;
  },
  async writeMeta(_root, content) {
    const fs = loadMock();
    fs.meta = content;
    saveMock(fs);
  },
  async getRecent() {
    return mockRecent(); // 首启(无记录)返回 last:null → 欢迎页
  },
  async setRecent(root) {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify({ last: root, recent: [root] } satisfies RecentState),
    );
  },
  async pickSingleFile() {
    let files: File[];
    try {
      files = await pickFilesViaInput(".md,.markdown,text/markdown", false);
    } catch {
      return null;
    }
    const file = files[0];
    if (!file) return null;
    const path = `/mock-single/${file.name}`;
    const all = loadSingleFiles();
    all[path] = await file.text();
    saveSingleFiles(all);
    return path;
  },
  async readSingleFile(path) {
    const content = loadSingleFiles()[path];
    if (content === undefined) throw new Error(`文件不存在: ${path}`);
    return content;
  },
  async writeSingleFile(path, content) {
    const all = loadSingleFiles();
    if (!(path in all)) throw new Error(`文件不存在: ${path}`);
    all[path] = content;
    saveSingleFiles(all);
  },
  async saveSingleFileAs(defaultName, content) {
    const all = loadSingleFiles();
    let path = `/mock-single/${defaultName}`;
    let n = 2;
    while (path in all) {
      const dot = defaultName.lastIndexOf(".");
      path = `/mock-single/${dot > 0 ? `${defaultName.slice(0, dot)} (${n++})${defaultName.slice(dot)}` : `${defaultName} (${n++})`}`;
    }
    all[path] = content;
    saveSingleFiles(all);
    return path;
  },
  async watchSingleFile() {},
  async closeSingleFile() {},
  async getRecentFiles() {
    return mockRecentFiles();
  },
  async setRecentFile(path) {
    const state = mockRecentFiles();
    state.recent = [path, ...state.recent.filter((p) => p !== path)].slice(0, 10);
    localStorage.setItem(SINGLE_RECENT_KEY, JSON.stringify(state));
  },
  async setLastDoc(rel) {
    // recent.json 损坏时 mockRecent 已容错回默认,这里不再裸 parse(否则打开文档链路被炸)
    const state = mockRecent();
    state.lastDoc = rel;
    localStorage.setItem(RECENT_KEY, JSON.stringify(state));
  },
  async getSettings() {
    return localStorage.getItem(SETTINGS_KEY) ?? "{}";
  },
  async setSettings(content) {
    localStorage.setItem(SETTINGS_KEY, content);
  },
  async readAllDocs() {
    const fs = loadMock();
    return Object.entries(fs.files).map(([path, content]) => ({ path, content }));
  },
  async readAllTrashDocs() {
    const fs = loadMock();
    return Object.entries(fs.trashFiles).map(([path, content]) => ({ path, content }));
  },
  async saveAsset(_root, docRel, ext, bytes) {
    const fs = loadMock();
    const folder = parentOf(docRel);
    const e = ext || "png";
    // 附件(6.1.5)也走这里:非图片扩展名给通用二进制/文档 mime(mock 内仅存 dataURL,不消费)
    const mime = /^png|jpe?g|gif|webp|bmp|avif$/.test(e)
      ? `image/${e}`
      : e === "svg"
        ? "image/svg+xml"
        : e === "pdf"
          ? "application/pdf"
          : "application/octet-stream";
    const name = `${fnv1aHex(bytes)}.${e}`;
    const rel = folder ? `${folder}/assets/${name}` : `assets/${name}`;
    fs.assets[rel] = `data:${mime};base64,${bytesToBase64(bytes)}`;
    saveMock(fs);
    return `./assets/${name}`;
  },
  async importImagesFromPicker(_root, docRel) {
    let files: File[];
    try {
      files = await pickFilesViaInput("image/*", true);
    } catch {
      return null;
    }
    const srcs: string[] = [];
    for (const f of files) {
      const ext = (f.name.split(".").pop() ?? "png").toLowerCase();
      const bytes = new Uint8Array(await f.arrayBuffer());
      srcs.push(await browserBackend.saveAsset("", docRel, ext, bytes));
    }
    return srcs.length ? srcs : null;
  },
  async importAttachmentsFromPicker(_root, docRel): Promise<AttachmentInfo[] | null> {
    let files: File[];
    try {
      files = await pickFilesViaInput("", true);
    } catch {
      return null;
    }
    const out: AttachmentInfo[] = [];
    for (const f of files) {
      const ext = (f.name.split(".").pop() ?? "").toLowerCase();
      const bytes = new Uint8Array(await f.arrayBuffer());
      out.push({
        name: f.name,
        src: await browserBackend.saveAsset("", docRel, ext, bytes),
      });
    }
    return out.length ? out : null;
  },
  async openPath() {
    // 浏览器无系统打开通道;上层以 unsupported 文案区分「文件缺失」
    return "unsupported" as const;
  },
  resolveAssetSrc(_root, docRel, src) {
    if (isExternalSrc(src)) return src;
    const rel = assetRelPosix(docRel, src);
    if (!rel) return src;
    return loadMock().assets[rel] ?? src;
  },
  async listTrash() {
    const fs = loadMock();
    const entries: TrashEntry[] = Object.keys(fs.trashFiles).map((p) => ({
      path: p,
      isDir: false,
      docs: 0,
    }));
    for (const f of fs.trashFolders) {
      const docs = Object.keys(fs.trashFiles).filter((p) => p.startsWith(f + "/")).length;
      entries.push({ path: f, isDir: true, docs });
    }
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  },
  async restoreTrash(_root, rel, strategy) {
    const fs = loadMock();
    const isDir = fs.trashFolders.includes(rel);
    const exists = isDir
      ? fs.folders.includes(rel) || Object.keys(fs.files).some((p) => p.startsWith(rel + "/"))
      : rel in fs.files;
    let finalRel = rel;
    if (exists) {
      if (strategy === "overwrite") {
        if (isDir) {
          fs.folders = fs.folders.filter((f) => f !== rel && !f.startsWith(rel + "/"));
          for (const key of Object.keys(fs.files)) {
            if (key === rel || key.startsWith(rel + "/")) delete fs.files[key];
          }
        } else {
          delete fs.files[rel];
        }
      } else if (strategy === "rename") {
        finalRel = mockDedupe(fs, rel);
      } else {
        throw new KbConflictError();
      }
    }
    if (isDir) {
      const folder = finalRel;
      fs.folders.push(folder);
      for (const [k, v] of Object.entries(fs.trashFiles)) {
        if (k === rel || k.startsWith(rel + "/")) {
          fs.files[folder + k.slice(rel.length)] = v;
          delete fs.trashFiles[k];
        }
      }
      fs.trashFolders = fs.trashFolders.filter((f) => f !== rel);
    } else {
      fs.files[finalRel] = fs.trashFiles[rel];
      delete fs.trashFiles[rel];
    }
    if (finalRel !== rel) {
      // 冲突改新名恢复:快照 key 跟随(与 Rust restore_trash 同构)
      for (const key of Object.keys(fs.history)) {
        if (key === rel || key.startsWith(rel + "/")) {
          moveHistKeys(fs, key, finalRel + key.slice(rel.length));
        }
      }
    }
    saveMock(fs);
    return finalRel;
  },
  async purgeTrash(_root, rel) {
    const fs = loadMock();
    if (fs.trashFolders.includes(rel)) {
      // 整夹删除:文件夹自身 + 其下全部子条目(与 Rust remove_dir_all 对齐)
      fs.trashFolders = fs.trashFolders.filter((f) => f !== rel && !f.startsWith(rel + "/"));
      for (const key of Object.keys(fs.trashFiles)) {
        if (key === rel || key.startsWith(rel + "/")) delete fs.trashFiles[key];
      }
    } else if (rel in fs.trashFiles) {
      delete fs.trashFiles[rel];
    } else {
      throw new Error("回收站中不存在该条目");
    }
    dropHistKeys(fs, rel); // 彻底删除连快照一起清(与 Rust remove_history_dir 对齐)
    saveMock(fs);
  },
  async emptyTrash() {
    const fs = loadMock();
    for (const rel of [...fs.trashFolders, ...Object.keys(fs.trashFiles)]) dropHistKeys(fs, rel);
    fs.trashFiles = {};
    fs.trashFolders = [];
    saveMock(fs);
  },
  async importDocsFromPicker(_root, folderRel) {
    let files: File[];
    try {
      files = await pickFilesViaInput(".md,.markdown,text/markdown", true);
    } catch {
      return null;
    }
    if (!files.length) return null;
    const fs = loadMock();
    const rels: string[] = [];
    for (const f of files) {
      // mock 无本地 fs,图片迁移无法执行(Rust import_docs 才有);正文原样落库
      const content = await f.text();
      const title = f.name.replace(/\.(md|markdown)$/i, "");
      let rel = (folderRel ? folderRel + "/" : "") + title + ".md";
      let n = 2;
      while (rel in fs.files) rel = `${folderRel ? folderRel + "/" : ""}${title} (${n++}).md`;
      fs.files[rel] = content;
      rels.push(rel);
    }
    saveMock(fs);
    return rels;
  },
  async exportText(defaultName, _filterExt, content) {
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = defaultName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return defaultName;
  },
  async readAssetBase64(_root, rel) {
    const dataUrl = loadMock().assets[rel];
    if (!dataUrl) return null;
    const m = /^data:([^;,]*);base64,(.*)$/s.exec(dataUrl);
    if (!m) return null;
    return { mime: m[1], data: m[2] };
  },
  async listAssets() {
    return Object.keys(loadMock().assets).sort();
  },
  async deleteAssets(_root, rels) {
    const fs = loadMock();
    let removed = 0;
    for (const rel of rels) {
      if (!rel.split("/").includes("assets")) continue;
      if (rel in fs.assets) {
        delete fs.assets[rel];
        removed++;
      }
    }
    saveMock(fs);
    return removed;
  },
  async listHistory(_root, rel) {
    const h = loadMock().history[rel] ?? {};
    return Object.keys(h)
      .filter((k) => parseHistId(k))
      .sort(histSortDesc)
      .map<HistoryEntry>((id) => {
        const p = parseHistId(id)!;
        return { id, time: p.time, auto: p.auto, chars: [...h[id]].length };
      });
  },
  async readHistory(_root, rel, id) {
    const content = loadMock().history[rel]?.[id];
    if (content == null) throw new Error(`快照不存在: ${id}`);
    return content;
  },
  async saveSnapshot(_root, rel, content, auto, keep) {
    const fs = loadMock();
    const h = (fs.history[rel] ??= {});
    const time = Date.now();
    const id = `${time}-${auto ? "a" : "m"}-${fnv1aHex(new TextEncoder().encode(content))}.md`;
    h[id] = content;
    // 超上限清最旧(与 Rust save_snapshot 同口径,至少保留本次)
    for (const k of Object.keys(h).filter((k) => parseHistId(k)).sort(histSortDesc).slice(Math.max(1, keep))) {
      delete h[k];
    }
    saveMock(fs);
    return { id, time, auto, chars: [...content].length };
  },
  async pruneHistory(_root, keep) {
    const fs = loadMock();
    const n = Math.max(1, keep);
    let removed = 0;
    for (const rel of Object.keys(fs.history)) {
      const h = fs.history[rel];
      const drop = Object.keys(h).filter((k) => parseHistId(k)).sort(histSortDesc).slice(n);
      for (const k of drop) {
        delete h[k];
        removed++;
      }
      if (Object.keys(h).length === 0) delete fs.history[rel];
    }
    saveMock(fs);
    return removed;
  },
  async listenFsEvent() {
    return () => {}; // mock 无外部改动
  },
  async listenSingleFileEvent() {
    return () => {}; // mock 无外部改动
  },
  async saveSingleAsset(path, ext, bytes) {
    const name = `${fnv1aHex(bytes)}.${ext || "png"}`;
    const e = (ext || "png").toLowerCase();
    const mime = /^png|jpe?g|gif|webp|bmp|avif$/.test(e)
      ? `image/${e}`
      : e === "svg"
        ? "image/svg+xml"
        : "application/octet-stream";
    const assets = loadSingleAssets();
    assets[`${singleParent(path)}/assets/${name}`] = `data:${mime};base64,${bytesToBase64(bytes)}`;
    saveSingleAssets(assets);
    return `./assets/${name}`;
  },
  async importSingleImagesFromPicker(path) {
    let files: File[];
    try {
      files = await pickFilesViaInput("image/*", true);
    } catch {
      return null;
    }
    const out: string[] = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
      out.push(await browserBackend.saveSingleAsset(path, ext, new Uint8Array(await file.arrayBuffer())));
    }
    return out.length ? out : null;
  },
  async importSingleAttachmentsFromPicker(path) {
    let files: File[];
    try {
      files = await pickFilesViaInput("", true);
    } catch {
      return null;
    }
    const out: AttachmentInfo[] = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
      const src = await browserBackend.saveSingleAsset(path, ext, new Uint8Array(await file.arrayBuffer()));
      out.push({ name: file.name, src });
    }
    return out.length ? out : null;
  },
  async openSingleAttachment() {
    return "unsupported" as const;
  },
  async readSingleAssetBase64(path, src) {
    const rel = assetRelPosix(singleBase(path), src);
    if (!rel) return null;
    const dataUrl = loadSingleAssets()[`${singleParent(path)}/${rel}`];
    const m = /^data:([^;,]*);base64,(.*)$/s.exec(dataUrl ?? "");
    return m ? { mime: m[1], data: m[2] } : null;
  },
  resolveSingleAssetSrc(path, src) {
    if (isExternalSrc(src)) return src;
    const rel = assetRelPosix(singleBase(path), src);
    if (!rel) return src;
    return loadSingleAssets()[`${singleParent(path)}/${rel}`] ?? src;
  },
  async saveSingleToKb(_root, path, content, assetSrcs) {
    const fs = loadMock();
    const name = singleBase(path);
    let rel = name;
    let n = 2;
    while (rel in fs.files) rel = `${name.replace(/\.md$/i, "")} (${n++}).md`;
    fs.files[rel] = content;
    const assets = loadSingleAssets();
    for (const src of assetSrcs) {
      const data = assets[src];
      if (!data) continue;
      const fileName = singleBase(src);
      fs.assets[`assets/${fileName}`] = data;
    }
    saveMock(fs);
    return rel;
  },
  async saveSingleDraft(path, content) {
    localStorage.setItem(SINGLE_DRAFT_KEY, JSON.stringify({ path, content, savedAt: Date.now() }));
  },
  async getSingleDraft(path) {
    try {
      const draft = JSON.parse(localStorage.getItem(SINGLE_DRAFT_KEY) ?? "null") as SingleDraft | null;
      return draft?.path === path ? draft : null;
    } catch {
      return null;
    }
  },
  async clearSingleDraft(path) {
    const draft = await browserBackend.getSingleDraft(path);
    if (draft) localStorage.removeItem(SINGLE_DRAFT_KEY);
  },
  async takeStartupSingleFile() {
    return null;
  },
};

export const kbBackend: KbBackend = isTauriEnv() ? tauriBackend : browserBackend;
