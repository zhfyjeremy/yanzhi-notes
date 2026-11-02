import { useCallback, useEffect, useRef, useState } from "react";
import { kbBackend } from "./backend";
import type { RecentFilesState, SingleDraft } from "./types";

/** 单文件模式(docs/single-file-mode.md):显式保存,不做自动落盘 */
export type SingleFileSaveState = "saved" | "dirty" | "saving" | "error";

const SELF_WRITE_QUIET_MS = 1500;
const DRAFT_SAVE_MS = 1000;

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const parentPath = (path: string): string =>
  path.includes("/") || path.includes("\\")
    ? path.replace(/[\\/][^\\/]+$/, "")
    : "";

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

  const pathRef = useRef<string | null>(null);
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
        setFilePath(path);
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

  const getMarkdownNow = useCallback(() => dirtyRef.current ?? savedMdRef.current, []);

  const savingRef = useRef(false);
  const save = useCallback(async (): Promise<boolean> => {
    const path = pathRef.current;
    if (!path || savingRef.current) return false;
    savingRef.current = true;
    const content = getMarkdownNow();
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
      if (message.includes("不存在") || message.includes("移动")) setMissing(true);
      setSaveState("error");
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [externalChange, getMarkdownNow]);

  const savingAsRef = useRef(false);
  const saveAs = useCallback(async (): Promise<boolean> => {
    const path = pathRef.current;
    if (!path || savingAsRef.current) return false;
    savingAsRef.current = true;
    const content = getMarkdownNow();
    setSaveState("saving");
    try {
      const next = await kbBackend.saveSingleFileAs(baseName(path), content);
      if (!next) {
        setSaveState(dirtyRef.current == null ? "saved" : "dirty");
        return false;
      }
      markSelfWrite();
      await kbBackend.watchSingleFile(next).catch(() => undefined);
      await kbBackend.setRecentFile(next).catch(() => undefined);
      void refreshRecent();
      dirtyRef.current = null;
      savedMdRef.current = content;
      pathRef.current = next;
      setFilePath(next);
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
      console.error("[single] 另存失败:", e);
      setSaveState("error");
      return false;
    } finally {
      savingAsRef.current = false;
    }
  }, [getMarkdownNow, refreshRecent]);

  const close = useCallback(async () => {
    const path = pathRef.current;
    if (path) await kbBackend.closeSingleFile(path).catch(() => undefined);
    dirtyRef.current = null;
    savedMdRef.current = "";
    pathRef.current = null;
    setFilePath(null);
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
    (src: string) => (filePath ? kbBackend.resolveSingleAssetSrc(filePath, src) : src),
    [filePath],
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
    const path = pathRef.current;
    if (!path) return [];
    const srcs: string[] = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      try {
        srcs.push(await kbBackend.saveSingleAsset(path, ext, new Uint8Array(await file.arrayBuffer())));
      } catch (e) {
        console.error("[single] 图片保存失败:", e);
      }
    }
    return srcs;
  }, []);

  const importImagesFromPicker = useCallback(async (): Promise<string[] | null> => {
    const path = pathRef.current;
    if (!path) return null;
    return kbBackend.importSingleImagesFromPicker(path);
  }, []);

  const importAttachmentsFromPicker = useCallback(async (): Promise<{ name: string; href: string }[] | null> => {
    const path = pathRef.current;
    if (!path) return null;
    const items = await kbBackend.importSingleAttachmentsFromPicker(path);
    return items?.map(({ name, src }) => ({ name, href: src })) ?? null;
  }, []);

  const openAttachment = useCallback(async (href: string): Promise<"ok" | "missing" | "unsupported"> => {
    const path = pathRef.current;
    if (!path) return "missing";
    return kbBackend.openSingleAttachment(path, href);
  }, []);

  const readAssetBase64 = useCallback(async (src: string) => {
    const path = pathRef.current;
    if (!path) return null;
    return kbBackend.readSingleAssetBase64(path, src);
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
    active: filePath !== null,
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
    openError,
    openFile,
    openPicker,
    onMarkdownChange,
    getMarkdownNow,
    save,
    saveAs,
    close,
    resolveExternal,
    restoreDraft,
    discardDraft,
    assetSrcResolver,
    saveImageFiles,
    importImagesFromPicker,
    importAttachmentsFromPicker,
    openAttachment,
    readAssetBase64,
  };
}

export type SingleFileWorkspace = ReturnType<typeof useSingleFile>;
