import { useCallback, useEffect, useRef, useState } from "react";
import { kbBackend } from "./backend";
import type { RecentFilesState, SingleDraft } from "./types";
import {
  collectSingleAssetTargets,
  rewriteSingleAssetTargets,
} from "./assets";

/** 单文件模式(docs/single-file-mode.md):显式保存,不做自动落盘 */
export type SingleFileSaveState = "saved" | "dirty" | "saving" | "error";

const SELF_WRITE_QUIET_MS = 1500;
const DRAFT_SAVE_MS = 1000;

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const parentPath = (path: string): string =>
  path.includes("/") || path.includes("\\")
    ? path.replace(/[\\/][^\\/]+$/, "")
    : "";

/**
 * 资源跟着文件走:保存/另存为到新位置时,把正文引用到的本地资源复制到
 * 「<新文件名>.assets/」,并把引用改写到新目录。返回「旧引用 → 新引用」映射,
 * 编辑器里的节点不必改:读取/导出/保存按映射换算,图片渲染也按映射解析。
 */
async function relocateAssets(
  fromBase: string,
  toBase: string,
  content: string,
): Promise<{ map: Map<string, string>; content: string }> {
  const map = new Map<string, string>();
  for (const { target, abs } of collectSingleAssetTargets(fromBase, content)) {
    try {
      const src = await kbBackend.importSingleAssetFromPath(toBase, abs);
      if (src && src !== target) map.set(target, src);
    } catch (e) {
      console.error("[single] 迁移资源失败:", abs, e);
    }
  }
  return { map, content: rewriteSingleAssetTargets(content, map) };
}

export interface SingleFilePickResult {
  path?: string;
  error?: string;
}

export function useSingleFile() {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [saveState, setSaveState] = useState<SingleFileSaveState>("saved");
  const [isDirty, setIsDirty] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [externalChange, setExternalChange] = useState(false);
  const [missing, setMissing] = useState(false);
  const [recentFiles, setRecentFiles] = useState<RecentFilesState>({ recent: [] });
  const [openError, setOpenError] = useState<string | null>(null);
  /** 是否处于单文件态;active 但无 filePath = 尚未落盘的「未命名」缓冲区 */
  const [active, setActive] = useState(false);
  /**
   * 资源锚点:图片/附件以它所在目录为 assets 根。普通文件 = 自身路径;
   * 未命名缓冲区 = 应用缓存里的空壳 .md(先落资源,保存时再迁移到目标目录)。
   */
  const [assetBase, setAssetBase] = useState<string | null>(null);

  const pathRef = useRef<string | null>(null);
  const assetBaseRef = useRef<string | null>(null);
  const dirtyRef = useRef<string | null>(null);
  const savedMdRef = useRef("");
  const selfWriteUntil = useRef(0);
  const eventUnRef = useRef<(() => void) | null>(null);
  const draftTimer = useRef<number | undefined>(undefined);
  const [draft, setDraft] = useState<SingleDraft | null>(null);
  pathRef.current = filePath;

  const fileName = filePath ? baseName(filePath) : "";
  const fileStem = fileName.replace(/\.(md|markdown)$/i, "");
  const fileDir = filePath ? parentPath(filePath) : "";

  const markSelfWrite = () => {
    selfWriteUntil.current = Date.now() + SELF_WRITE_QUIET_MS;
  };

  const refreshRecent = useCallback(async () => {
    try {
      setRecentFiles(await kbBackend.getRecentFiles());
    } catch {
      setRecentFiles({ recent: [] });
    }
  }, []);

  const removeRecentFile = useCallback(async (path: string) => {
    try {
      await kbBackend.removeRecentFile(path);
      setRecentFiles(await kbBackend.getRecentFiles());
      return null;
    } catch (e) {
      console.error("[single] 移除最近 Markdown 失败:", e);
      return `无法移除「${baseName(path)}」:${String(e)}`;
    }
  }, []);

  const openFile = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const content = await kbBackend.readSingleFile(path);
        const savedDraft = await kbBackend.getSingleDraft(path).catch(() => null);
        await kbBackend.watchSingleFile(path).catch(() => undefined);
        await kbBackend.setRecentFile(path).catch(() => undefined);
        void refreshRecent();
        dirtyRef.current = null;
        window.clearTimeout(draftTimer.current);
        savedMdRef.current = content;
        pathRef.current = path;
        assetBaseRef.current = path;
        srcMapRef.current = new Map();
        setFilePath(path);
        setAssetBase(path);
        setActive(true);
        setMarkdown(content);
        setSaveState("saved");
        setIsDirty(false);
        setSavedAt("");
        setExternalChange(false);
        setMissing(false);
        setOpenError(null);
        setDraft(savedDraft && savedDraft.content !== content ? savedDraft : null);
        return null;
      } catch (e) {
        console.error("[single] 打开 Markdown 失败:", e);
        setOpenError(path);
        return `无法打开「${baseName(path)}」:${String(e)}`;
      }
    },
    [refreshRecent],
  );

  const openPicker = useCallback(async (): Promise<SingleFilePickResult | null> => {
    const picked = await kbBackend.pickSingleFile().catch((e) => {
      console.error("[single] 选择 Markdown 失败:", e);
      return null;
    });
    if (!picked) return null;
    const err = await openFile(picked);
    return err ? { error: err } : { path: picked };
  }, [openFile]);

  const onMarkdownChange = useCallback((content: string) => {
    dirtyRef.current = content;
    setSaveState("dirty");
    setIsDirty(true);
    setMissing(false);
    setDraft(null);
    window.clearTimeout(draftTimer.current);
    const changedPath = pathRef.current;
    draftTimer.current = window.setTimeout(() => {
      if (!changedPath || pathRef.current !== changedPath) return;
      const path = pathRef.current;
      void kbBackend.saveSingleDraft(path, content).catch(() => undefined);
    }, DRAFT_SAVE_MS);
  }, []);

  /** 另存为改写资源引用后,编辑器节点里仍是旧引用:所有出口按映射换算成磁盘上的写法 */
  const srcMapRef = useRef(new Map<string, string>());
  const applySrcMap = useCallback(
    (md: string) => (srcMapRef.current.size ? rewriteSingleAssetTargets(md, srcMapRef.current) : md),
    [],
  );
  const getMarkdownNow = useCallback(
    () => applySrcMap(dirtyRef.current ?? savedMdRef.current),
    [applySrcMap],
  );

  const savingRef = useRef(false);
  const savingAsRef = useRef(false);

  /**
   * 另存为:系统保存框;未命名缓冲区没有路径时也走这里 —— 它就是「选位置并落盘」。
   * 成功后缓冲区转为普通单文件(有路径、进最近打开、开始监听外部改动)。
   */
  const saveAs = useCallback(async (): Promise<boolean> => {
    if (savingAsRef.current || savingRef.current) return false;
    savingAsRef.current = true;
    const prevPath = pathRef.current;
    const prevBase = assetBaseRef.current;
    let content = getMarkdownNow();
    setSaveState("saving");
    try {
      const next = await kbBackend.saveSingleFileAs(prevPath ? baseName(prevPath) : "未命名.md", content);
      if (!next) {
        // 取消选位置:保留未保存状态与内容
        setSaveState(dirtyRef.current == null ? "saved" : "dirty");
        return false;
      }
      // 资源跟着文件走:复制到「<新文件名>.assets/」,引用改写到新目录后再落一次盘
      // (首次保存 = 从缓存锚点迁出;另存为 = 换目录/换名也一并迁)
      if (prevBase && prevBase !== next) {
        const moved = await relocateAssets(prevBase, next, content);
        for (const [from, to] of moved.map) srcMapRef.current.set(from, to);
        if (moved.content !== content) {
          content = moved.content;
          await kbBackend.writeSingleFile(next, content).catch((e) =>
            console.error("[single] 改写资源引用失败:", e),
          );
        }
      }
      markSelfWrite();
      await kbBackend.watchSingleFile(next).catch(() => undefined);
      await kbBackend.setRecentFile(next).catch(() => undefined);
      void refreshRecent();
      dirtyRef.current = null;
      savedMdRef.current = content;
      pathRef.current = next;
      assetBaseRef.current = next;
      setFilePath(next);
      setAssetBase(next);
      setActive(true);
      setSaveState("saved");
      setIsDirty(false);
      window.clearTimeout(draftTimer.current);
      setExternalChange(false);
      setMissing(false);
      if (prevPath) await kbBackend.clearSingleDraft(prevPath).catch(() => undefined);
      const now = new Date();
      setSavedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
      );
      return true;
    } catch (e) {
      console.error("[single] 另存失败:", e);
      setSaveState("error");
      return false;
    } finally {
      savingAsRef.current = false;
    }
  }, [getMarkdownNow, refreshRecent]);

  /** 保存:有路径写回原文件;未命名缓冲区没有路径 → 转为「选位置并落盘」 */
  const save = useCallback(async (): Promise<boolean> => {
    const path = pathRef.current;
    if (!path) return saveAs();
    if (savingRef.current) return false;
    savingRef.current = true;
    const content = getMarkdownNow();
    let routeToSaveAs = false;
    setSaveState("saving");
    try {
      // 原文件被删除/移动时不静默重建,引导用户另存为
      const disk = await kbBackend.readSingleFile(path);
      // watcher 漏发时的最后防线:磁盘版本变化且用户未选择保留我的 → 先提示冲突
      if (disk !== savedMdRef.current && !externalChange) {
        setExternalChange(true);
        setSaveState("dirty");
        return false;
      }
      markSelfWrite();
      await kbBackend.writeSingleFile(path, content);
      dirtyRef.current = null;
      savedMdRef.current = content;
      setSaveState("saved");
      setIsDirty(false);
      window.clearTimeout(draftTimer.current);
      setExternalChange(false);
      setMissing(false);
      await kbBackend.clearSingleDraft(path).catch(() => undefined);
      const now = new Date();
      setSavedAt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
      );
      return true;
    } catch (e) {
      console.error("[single] 保存失败:", e);
      const message = String(e);
      if (message.includes("不存在") || message.includes("移动")) {
        setMissing(true);
        // 原文件已被删除/移动:内容还在,直接引导「另存为」选新位置(文档口径)
        routeToSaveAs = true;
      }
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
    if (routeToSaveAs) return saveAs();
    return false;
  }, [externalChange, getMarkdownNow, saveAs]);

  /**
   * 新建「未命名」缓冲区:立即开始写,保存时再选位置。
   * 状态同步重置(不等后端),避免中间闪回知识库/欢迎页;旧文件的监听与草稿随后清理。
   */
  const newUntitled = useCallback(async () => {
    // 资源锚点:后端 save_asset 以「文件所在目录」为 assets 根,且要求文件真实存在;
    // 在缓存里落一个空壳 .md,贴图就能先写进来,保存时再迁移到目标目录。
    let base: string | null = null;
    try {
      base = await kbBackend.importDroppedMarkdown("未命名.md", "");
    } catch (e) {
      console.error("[single] 创建未命名缓冲区资源锚点失败:", e);
    }
    const prev = pathRef.current;
    dirtyRef.current = null;
    savedMdRef.current = "";
    pathRef.current = null;
    window.clearTimeout(draftTimer.current);
    setFilePath(null);
    setMarkdown("");
    setSaveState("saved");
    setIsDirty(false);
    setSavedAt("");
    setExternalChange(false);
    setMissing(false);
    setOpenError(null);
    setDraft(null);
    assetBaseRef.current = base;
    srcMapRef.current = new Map();
    setAssetBase(base);
    setActive(true);
    if (prev) {
      await kbBackend.closeSingleFile(prev).catch(() => undefined);
      await kbBackend.clearSingleDraft(prev).catch(() => undefined);
    }
  }, []);

  const close = useCallback(async () => {
    const path = pathRef.current;
    if (path) await kbBackend.closeSingleFile(path).catch(() => undefined);
    dirtyRef.current = null;
    savedMdRef.current = "";
    pathRef.current = null;
    assetBaseRef.current = null;
    srcMapRef.current = new Map();
    setFilePath(null);
    setAssetBase(null);
    setActive(false);
    setMarkdown("");
    setSaveState("saved");
    setIsDirty(false);
    setSavedAt("");
    setExternalChange(false);
    setMissing(false);
    window.clearTimeout(draftTimer.current);
    if (path) await kbBackend.clearSingleDraft(path).catch(() => undefined);
    setDraft(null);
  }, []);

  const reload = useCallback(async () => {
    const path = pathRef.current;
    if (!path) return;
    try {
      const content = await kbBackend.readSingleFile(path);
      dirtyRef.current = null;
      savedMdRef.current = content;
      setMarkdown(content);
      setSaveState("saved");
      setIsDirty(false);
      setMissing(false);
      setExternalChange(false);
    } catch {
      setMissing(true);
      setSaveState("error");
    }
  }, []);

  const resolveExternal = useCallback(
    async (keepMine: boolean) => {
      setExternalChange(false);
      if (!keepMine) await reload();
    },
    [reload],
  );

  const assetSrcResolver = useCallback(
    (src: string) =>
      assetBase ? kbBackend.resolveSingleAssetSrc(assetBase, srcMapRef.current.get(src) ?? src) : src,
    [assetBase],
  );

  const restoreDraft = useCallback(() => {
    if (!draft) return;
    onMarkdownChange(draft.content);
    setDraft(null);
  }, [draft, onMarkdownChange]);

  const discardDraft = useCallback(async () => {
    const path = pathRef.current;
    if (path) await kbBackend.clearSingleDraft(path).catch(() => undefined);
    setDraft(null);
  }, []);

  const saveImageFiles = useCallback(async (files: File[]): Promise<string[]> => {
    const path = assetBaseRef.current;
    if (!path) return [];
    const srcs: string[] = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      try {
        srcs.push(
          await kbBackend.saveSingleAsset(path, ext, new Uint8Array(await file.arrayBuffer()), file.name),
        );
      } catch (e) {
        console.error("[single] 图片保存失败:", e);
      }
    }
    return srcs;
  }, []);

  const importImagesFromPicker = useCallback(async (): Promise<string[] | null> => {
    const path = assetBaseRef.current;
    if (!path) return null;
    return kbBackend.importSingleImagesFromPicker(path);
  }, []);

  const importAttachmentsFromPicker = useCallback(async (): Promise<{ name: string; href: string }[] | null> => {
    const path = assetBaseRef.current;
    if (!path) return null;
    const items = await kbBackend.importSingleAttachmentsFromPicker(path);
    return items?.map(({ name, src }) => ({ name, href: src })) ?? null;
  }, []);

  const openAttachment = useCallback(async (href: string): Promise<"ok" | "missing" | "unsupported"> => {
    const path = assetBaseRef.current;
    if (!path) return "missing";
    return kbBackend.openSingleAttachment(path, srcMapRef.current.get(href) ?? href);
  }, []);

  const readAssetBase64 = useCallback(async (src: string) => {
    const path = assetBaseRef.current;
    if (!path) return null;
    return kbBackend.readSingleAssetBase64(path, srcMapRef.current.get(src) ?? src);
  }, []);

  /**
   * 「<文件名>.assets/」里没被正文引用的文件(手动清理用)。
   * 不自动删:删掉正文里的图只是去掉引用,文件留着,⌘Z 撤回永远完整;
   * 孤儿文件由「更多 → 清理未引用图片…」列出来交给用户确认。
   */
  const listUnreferencedAssets = useCallback(async (): Promise<{ files: string[]; unused: string[] }> => {
    const base = pathRef.current;
    if (!base) return { files: [], unused: [] };
    const files = await kbBackend.listSingleAssets(base).catch(() => [] as string[]);
    if (!files.length) return { files, unused: [] };
    // 同名比对不区分大小写(Windows);引用到别处目录的同名文件只会「多保留」,不会误删
    const referenced = new Set(
      collectSingleAssetTargets(base, getMarkdownNow())
        .map((t) => t.abs.split(/[\\/]/).pop()?.toLocaleLowerCase())
        .filter((n): n is string => !!n),
    );
    return { files, unused: files.filter((name) => !referenced.has(name.toLocaleLowerCase())) };
  }, [getMarkdownNow]);

  const deleteUnreferencedAssets = useCallback(async (names: string[]): Promise<number> => {
    const base = pathRef.current;
    if (!base || !names.length) return 0;
    return kbBackend.deleteSingleAssets(base, names);
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  useEffect(() => {
    let alive = true;
    void kbBackend.listenSingleFileEvent((path) => {
      if (!alive || path !== pathRef.current || Date.now() < selfWriteUntil.current) return;
      if (dirtyRef.current != null) {
        void kbBackend.readSingleFile(path).then(
          () => setExternalChange(true),
          () => {
            setMissing(true);
            setSaveState("error");
          },
        );
        return;
      }
      void reload();
    }).then((un) => {
      if (!alive) {
        un();
        return;
      }
      eventUnRef.current?.();
      eventUnRef.current = un;
    });
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(
    () => () => {
      eventUnRef.current?.();
      const path = pathRef.current;
      if (path) void kbBackend.closeSingleFile(path).catch(() => undefined);
    },
    [],
  );

  return {
    active,
    /** 尚未落盘的「未命名」缓冲区 */
    untitled: active && filePath === null,
    /** 资源锚点(assets 根 = 其所在目录);未命名时指向缓存里的空壳文件 */
    assetBasePath: assetBase,
    filePath,
    fileName,
    fileStem,
    fileDir,
    markdown,
    saveState,
    savedAt,
    dirty: isDirty,
    externalChange,
    missing,
    draft,
    recentFiles,
    removeRecentFile,
    openError,
    openFile,
    openPicker,
    newUntitled,
    onMarkdownChange,
    getMarkdownNow,
    save,
    saveAs,
    close,
    reload,
    resolveExternal,
    restoreDraft,
    discardDraft,
    assetSrcResolver,
    saveImageFiles,
    importImagesFromPicker,
    importAttachmentsFromPicker,
    openAttachment,
    readAssetBase64,
    listUnreferencedAssets,
    deleteUnreferencedAssets,
  };
}

export type SingleFileWorkspace = ReturnType<typeof useSingleFile>;
