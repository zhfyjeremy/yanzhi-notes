/**
 * 知识库后端双实现:
 * - tauri:pnpm tauri dev / 打包版,invoke → src-tauri/src/kb.rs(真文件系统)
 * - browser:pnpm dev 纯浏览器,localStorage mock(驱动脚本/编辑器管线开发用,无 fs)
 * 两者同构(KbBackend),上层代码不感知。
 * mock 的 trash/meta/assets/rename 语义与 Rust kb.rs 逐条对齐,跨端断裂会静默
 * undefined(serde camelCase 实录),改一边必须同步另一边。
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import type { DocContent, KbBackend, RecentState, RenameResult, TreeNode, TrashEntry } from "./types";
import { movePatternsFor, refPatternsFor, updateWikiRefs } from "./wiki-refs";
import { assetRelPosix, isExternalSrc } from "./asset-src";

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

const tauriBackend: KbBackend = {
  kind: "tauri",
  async pickFolder() {
    return invoke<string | null>("pick_folder");
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
  async createDoc(root, folderRel, title) {
    return invoke<string>("create_doc", { root, folderRel, title });
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
    const paths = await invoke<string[] | null>("pick_images");
    if (!paths?.length) return null;
    const srcs: string[] = [];
    for (const p of paths) {
      const r = await invoke<{ src: string }>("import_asset", { root, docRel, srcAbs: p });
      srcs.push(r.src);
    }
    return srcs;
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
    const paths = await invoke<string[] | null>("pick_docs");
    if (!paths?.length) return null;
    return invoke<string[]>("import_docs", { root, folderRel, srcPaths: paths });
  },
  async exportText(defaultName, filterExt, content) {
    return invoke<string | null>("export_text", { defaultName, filterExt, content });
  },
  async readAssetBase64(root, rel) {
    return invoke<{ data: string; mime: string } | null>("read_asset_base64", { root, rel });
  },
  async listenFsEvent(cb) {
    const { listen } = await import("@tauri-apps/api/event");
    const un = await listen<string[]>("kb-fs-event", (e) => cb(e.payload));
    return un;
  },
};

/* ---------------- browser mock:localStorage 里的假库 ---------------- */

const MOCK_KEY = "yz-mock-kb-v1";
const RECENT_KEY = "yz-mock-recent-v1";
const SETTINGS_KEY = "yz-mock-settings-v1";

interface MockFs {
  root: string; // 固定虚拟路径
  files: Record<string, string>; // rel -> md 内容
  folders: string[]; // rel 列表(含嵌套中间目录)
  meta: string; // .yanzhi/meta.json 原文
  trashFiles: Record<string, string>; // 原相对路径 -> md 内容
  trashFolders: string[]; // 被删文件夹原相对路径
  assets: Record<string, string>; // rel -> dataURL(浏览器 mock 的"图片盘")
}

const SEED_DOCS: Record<string, string> = {
  "开始使用.md": "# 开始使用\n\nmock 库:浏览器开发模式,数据在 localStorage,清空即重置。\n",
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
  async createDoc(_root, folderRel, title) {
    const fs = loadMock();
    let rel = (folderRel ? folderRel + "/" : "") + title + ".md";
    let n = 2;
    while (rel in fs.files) rel = `${folderRel ? folderRel + "/" : ""}${title} (${n++}).md`;
    fs.files[rel] = `# ${title}\n`;
    saveMock(fs);
    return rel;
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
      fs.files[newRel] = fs.files[src];
      delete fs.files[src];
    }
    // 引用联动(与 Rust move_entry 同构:路径前缀改写,名字不变裸名不动)
    const refs = movePatternsFor(src, newRel, isDir);
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
    const mime = e === "svg" ? "image/svg+xml" : `image/${e}`;
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
    saveMock(fs);
  },
  async emptyTrash() {
    const fs = loadMock();
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
  async listenFsEvent() {
    return () => {}; // mock 无外部改动
  },
};

export const kbBackend: KbBackend = isTauriEnv() ? tauriBackend : browserBackend;
