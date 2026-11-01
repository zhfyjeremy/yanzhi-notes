import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { YanzhiEditor } from "./editor/YanzhiEditor";
import { insertImage } from "./editor/extensions/image-card";
import type { WikiDocRef } from "./editor/wiki-link-command";
import { TocPanel } from "./editor/panel/TocPanel";
import { BacklinksPanel } from "./kb/BacklinksPanel";
import { HistoryPanel, formatSnapshotTime } from "./kb/HistoryPanel";
import { HistoryDialog } from "./kb/HistoryDialog";
import { DocTree } from "./kb/DocTree";
import { TagsPanel } from "./kb/TagsPanel";
import { filterTreeByTag } from "./kb/meta";
import { StatusBar } from "./kb/StatusBar";
import { TrashDialog } from "./kb/TrashDialog";
import { OrphanMetaDialog } from "./kb/OrphanMetaDialog";
import { SettingsDialog } from "./kb/SettingsDialog";
import { TemplatePicker } from "./kb/TemplatePicker";
import { TemplateManager } from "./kb/TemplateManager";
import { templateToContent, uniqueTemplateName } from "./kb/templates";
import { compressImageFile, isImageFile } from "./kb/image-compress";
import { useSettings } from "./settings";
import { WelcomePage } from "./kb/WelcomePage";
import { SingleFileWorkspace } from "./kb/SingleFileWorkspace";
import { useKb } from "./kb/useKb";
import { useSingleFile } from "./kb/useSingleFile";
import { isTauriEnv, kbBackend } from "./kb/backend";
import { setAssetResolver } from "./kb/asset-src";
import { buildExportHtml } from "./kb/export-html";
import { prepareSingleMarkdownForKb } from "./kb/assets";
import { flattenDocs, wikiTargetFor } from "./kb/wiki-refs";
import type { HistoryEntry } from "./kb/types";
import { formatShortcut, shortcutMatches } from "./shortcuts";
import type { BatchRenameItem, BatchResult } from "./kb/batch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * M3 主布局:无库 → 欢迎页;有库 → 三栏(目录树 / 编辑器+标题 / TOC)。
 * 标题 ↔ 文件名(PRD 9.2):标题输入框 = 文件名去 .md,改名落盘 debounce 800ms。
 */

const ILLEGAL_TITLE_CHARS = /[\\/:*?"<>|]/g;

const stripTitle = (raw: string): string =>
  raw.replace(ILLEGAL_TITLE_CHARS, "").trimStart().replace(/\.+$/, "");

const docBasename = (rel: string): string =>
  rel.split("/").pop()?.replace(/\.md$/i, "") ?? "";

type EditorScope = "kb" | "single";

function App() {
  const { settings, update: updateSettings } = useSettings();
  const kb = useKb(settings);
  const single = useSingleFile();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorScope, setEditorScope] = useState<EditorScope | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [title, setTitle] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [orphansOpen, setOrphansOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false); // 浏览器 dev 的 Dialog;Tauri 走独立窗口
  // 历史快照(6.2):对话框目标条目 + 打开时的当前正文(对比基准)
  const [historyEntry, setHistoryEntry] = useState<HistoryEntry | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyCurrent, setHistoryCurrent] = useState("");
  // 失效双链弹窗目标 + 「搜索同名文档」预置信号(5.2.1-5)
  const [wikiDead, setWikiDead] = useState<string | null>(null);
  const [searchPreset, setSearchPreset] = useState<{ term: string; seq: number } | null>(null);
  /* 标签筛选(6.3-2):左栏树只显示带该标签的文档;null = 未筛选 */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  /* 新建文档模板选择(7.5):知识库有模板时「新建文档」先经 TemplatePicker */
  const [tplPicker, setTplPicker] = useState<{ folder: string; name: string } | null>(null);
  const [tplNames, setTplNames] = useState<string[]>([]);
  const [tplMgrOpen, setTplMgrOpen] = useState(false);
  const [singlePending, setSinglePending] = useState<
    | { kind: "close"; nextWindow?: boolean }
    | { kind: "open-picker" }
    | { kind: "open-path"; path: string }
    | { kind: "open-kb-picker" }
    | { kind: "new-kb" }
    | { kind: "open-kb"; root: string; docRel?: string }
    | null
  >(null);
  const [singleAssetsConfirmOpen, setSingleAssetsConfirmOpen] = useState(false);
  const [singleSaveToKbOpen, setSingleSaveToKbOpen] = useState(false);
  const [singleSavedToKb, setSingleSavedToKb] = useState<{ root: string; rel: string } | null>(null);
  const [singleOutlineOpen, setSingleOutlineOpen] = useState(false);
  const singleAssetsAllowedRef = useRef(false);
  const singleAssetsResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const searchPresetSeq = useRef(0);
  // 全局搜索定位信号(seq 单调递增:同文档重复点击也能触发定位)
  const [locateSignal, setLocateSignal] = useState<{ term: string; seq: number } | null>(null);
  const locateSeq = useRef(0);
  const pendingLocate = useRef<string | null>(null);
  const renameTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const titleRef = useRef("");
  titleRef.current = title;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // 设置入口:浏览器 dev/E2E 用 Dialog;Tauri 独立窗口(open_aux_window 建窗/聚焦)。
  // tab 供菜单「关于砚知」直落关于分类
  const openSettings = useCallback((tab?: string) => {
    if (isTauriEnv()) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("open_aux_window", { label: "settings", tab: tab ?? null }).catch((e) => console.error(e)),
      );
    } else {
      setSettingsOpen(true);
    }
  }, []);

  const confirmSingleAssets = useCallback(() => {
    if (singleAssetsAllowedRef.current) return Promise.resolve(true);
    setSingleAssetsConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      singleAssetsResolveRef.current?.(false);
      singleAssetsResolveRef.current = resolve;
    });
  }, []);

  const runSinglePending = useCallback(
    async (pending: NonNullable<typeof singlePending>) => {
      setSinglePending(null);
      if (pending.kind === "close") {
        await single.close();
        if (pending.nextWindow && isTauriEnv()) {
          void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => void getCurrentWindow().destroy());
        }
        return;
      }
      if (pending.kind === "open-picker") {
        const result = await single.openPicker();
        if (result?.error) showToast(result.error);
        if (!result?.path) return;
        // 取消选择时留在当前知识库;选中文件后再关闭知识库,避免一次取消把用户甩到欢迎页
        if (kb.kbRoot) await kb.closeKb();
        return;
      }
      if (pending.kind === "open-path") {
        if (kb.kbRoot) await kb.closeKb();
        const err = await single.openFile(pending.path);
        if (err) showToast(err);
        return;
      }
      if (pending.kind === "open-kb-picker") {
        const err = await kb.pickAndOpen();
        if (err) {
          showToast(err);
          return;
        }
        await single.close();
        return;
      }
      if (pending.kind === "new-kb") {
        const result = await kb.pickAndCreate();
        if (result?.kind === "not-empty") setMenuPending({ root: result.root, yanzhi: false });
        else if (result?.kind === "is-yanzhi") setMenuPending({ root: result.root, yanzhi: true });
        else if (result?.kind === "error") showToast(result.message);
        if (result) return;
        await single.close();
        return;
      }
      await single.close();
      const err = await kb.openKbAt(pending.root);
      if (err) showToast(err);
      else if (pending.docRel) await kb.openDoc(pending.docRel);
    },
    [kb, showToast, single],
  );

  const requestSingleAction = useCallback(
    (pending: NonNullable<typeof singlePending>) => {
      if (single.active && single.dirty) setSinglePending(pending);
      else void runSinglePending(pending);
    },
    [runSinglePending, single.active, single.dirty],
  );

  const singlePendingDescription = useMemo(() => {
    if (!singlePending) return "";
    if (singlePending.kind === "close") return "关闭文件前可以先保存、放弃修改,或继续编辑。";
    if (singlePending.kind === "open-picker") return "打开新的 Markdown 文件前,先处理当前未保存修改。";
    if (singlePending.kind === "open-path") return "切换到新的 Markdown 文件前,先处理当前未保存修改。";
    if (singlePending.kind === "open-kb-picker") return "打开知识库前,先处理当前未保存修改。";
    if (singlePending.kind === "new-kb") return "新建知识库前,先处理当前未保存修改。";
    return "切换工作区前,先处理当前未保存修改。";
  }, [singlePending]);

  const saveAndRunSinglePending = useCallback(() => {
    const pending = singlePending;
    if (!pending) return;
    void single.save().then((ok) => {
      if (ok) void runSinglePending(pending);
      else showToast("保存失败,当前修改未丢弃");
    });
  }, [runSinglePending, showToast, single, singlePending]);

  const discardAndRunSinglePending = useCallback(() => {
    const pending = singlePending;
    if (!pending) return;
    void runSinglePending(pending);
  }, [runSinglePending, singlePending]);

  const allowSingleAssets = useCallback(() => {
    singleAssetsAllowedRef.current = true;
    setSingleAssetsConfirmOpen(false);
    singleAssetsResolveRef.current?.(true);
    singleAssetsResolveRef.current = null;
  }, []);

  const rejectSingleAssets = useCallback(() => {
    setSingleAssetsConfirmOpen(false);
    singleAssetsResolveRef.current?.(false);
    singleAssetsResolveRef.current = null;
  }, []);

  /* ---- 导入导出(5.6;入口 = 原生菜单「文件」) ---- */
  const onImportDocs = useCallback(() => {
    const folder = kb.currentPath?.includes("/")
      ? kb.currentPath.slice(0, kb.currentPath.lastIndexOf("/"))
      : "";
    void kb.importDocs(folder).then((rels) => {
      if (rels?.length) {
        showToast(`已导入 ${rels.length} 篇文档`);
        void kb.openDoc(rels[rels.length - 1]);
      }
    });
  }, [kb, showToast]);

  const onExportMd = useCallback(() => {
    if (!kb.currentPath) return;
    void kb.exportText(`${title || "未命名文档"}.md`, "md", kb.getMarkdownNow()).then((p) => {
      if (p) showToast(`已导出:${p}`);
    });
  }, [kb, showToast, title]);

  const onExportHtml = useCallback(() => {
    if (!kb.currentPath) return;
    void buildExportHtml({
      md: kb.getMarkdownNow(),
      title: title || "未命名文档",
      docRel: kb.currentPath,
      readAssetBase64: kb.readAssetBase64,
    }).then((html) =>
      kb.exportText(`${title || "未命名文档"}.html`, "html", html).then((p) => {
        if (p) showToast(`已导出:${p}`);
      }),
    );
  }, [kb, showToast, title]);

  const exportSingleMd = useCallback(() => {
    void kbBackend.exportText(single.fileName || "未命名文档.md", "md", single.getMarkdownNow()).then((p) => {
      if (p) showToast(`已导出:${p}`);
    });
  }, [showToast, single.fileName, single.getMarkdownNow]);

  const exportSingleHtml = useCallback(() => {
    void buildExportHtml({
      md: single.getMarkdownNow(),
      title: single.fileStem || "未命名文档",
      docRel: single.fileName,
      readAssetBase64: single.readAssetBase64,
    }).then((html) =>
      kbBackend.exportText(`${single.fileStem || "未命名文档"}.html`, "html", html).then((p) => {
        if (p) showToast(`已导出:${p}`);
      }),
    );
  }, [showToast, single.fileStem, single.fileName, single.getMarkdownNow, single.readAssetBase64]);

  const saveCurrentSingleToKb = useCallback(
    async (root: string) => {
      if (!single.filePath) return;
      const prepared = prepareSingleMarkdownForKb(single.filePath, single.getMarkdownNow());
      try {
        const rel = await kbBackend.saveSingleToKb(root, single.filePath, prepared.content, prepared.assetSrcs);
        setSingleSaveToKbOpen(false);
        setSingleSavedToKb({ root, rel });
      } catch (e) {
        showToast(`存入知识库失败:${String(e)}`);
      }
    },
    [showToast, single.filePath, single.getMarkdownNow],
  );

  const openSingleSavedKb = useCallback(
    async (info: { root: string; rel: string }) => {
      setSingleSavedToKb(null);
      if (single.dirty) {
        const saved = await single.save();
        if (!saved) {
          showToast("原文件保存失败,请先处理未保存修改");
          return;
        }
      }
      await single.close();
      const err = await kb.openKbAt(info.root);
      if (err) showToast(err);
      else await kb.openDoc(info.rel);
    },
    [kb, showToast, single],
  );

  const saveCurrentAsTemplate = useCallback(async () => {
    if (!kb.kbRoot || !kb.currentPath) {
      showToast("未打开文档,无法保存为模板");
      return;
    }
    try {
      const existing = await kbBackend.listTemplates(kb.kbRoot);
      const name = uniqueTemplateName(existing, docBasename(kb.currentPath));
      await kbBackend.writeTemplate(kb.kbRoot, name, kb.getMarkdownNow());
      window.dispatchEvent(new CustomEvent("yz-templates-changed"));
      if (isTauriEnv()) {
        void import("@tauri-apps/api/event").then(({ emit }) =>
          emit("yz-templates-changed"),
        );
      }
      showToast(`已保存为模板「${name}」`);
    } catch {
      showToast("保存模板失败");
    }
  }, [kb.currentPath, kb.getMarkdownNow, kb.kbRoot, showToast]);

  // 原生菜单(5.0.4-2):Rust 侧建菜单并发 kb-menu 事件。
  // 非空/已是砚知库的确认走 App 级弹窗(欢迎页按钮触发时仍用页内确认卡,两条路只走一条)
  const [menuPending, setMenuPending] = useState<{ root: string; yanzhi: boolean } | null>(null);
  useEffect(() => {
    if (!isTauriEnv()) return;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      un = await listen<{
        action: string;
        root?: string;
        path?: string;
        doc?: string;
        key?: string;
        value?: boolean;
      }>("kb-menu", (e) => {
        void (async () => {
          const { action, root, key, value, doc } = e.payload;
          const { path } = e.payload;
          if (action === "new") {
            if (single.active && single.dirty) {
              setSinglePending({ kind: "new-kb" });
              return;
            }
            const r = await kb.pickAndCreate();
            if (r?.kind === "not-empty") setMenuPending({ root: r.root, yanzhi: false });
            else if (r?.kind === "is-yanzhi") setMenuPending({ root: r.root, yanzhi: true });
            else if (r?.kind === "error") showToast(r.message);
          } else if (action === "open") {
            if (single.active && single.dirty) {
              setSinglePending({ kind: "open-kb-picker" });
              return;
            }
            const err = await kb.pickAndOpen();
            if (err) showToast(err);
          } else if (action === "open-recent" && root) {
            if (single.active && single.dirty) {
              setSinglePending({ kind: "open-kb", root });
              return;
            }
            const err = await kb.openKbAt(root);
            if (err) showToast(err);
          } else if (action === "open-single") {
            requestSingleAction({ kind: "open-picker" });
          } else if (action === "open-recent-single" && path) {
            requestSingleAction({ kind: "open-path", path });
          } else if (action === "save-single") {
            if (single.active) void single.save();
          } else if (action === "save-single-as") {
            if (single.active) void single.saveAs();
          } else if (action === "close-single") {
            if (single.active) requestSingleAction({ kind: "close" });
          } else if (action === "save-single-to-kb") {
            if (single.active) setSingleSaveToKbOpen(true);
          } else if (action === "import-md") {
            if (single.active) {
              showToast("单文件模式请先打开知识库再导入");
              return;
            }
            onImportDocs();
          } else if (action === "export-md" || action === "export-html") {
            // 无文档打开时导出静默无意义,给明确提示
            if (single.active) {
              if (action === "export-md") exportSingleMd();
              else exportSingleHtml();
            } else if (!kb.currentPath) showToast("未打开文档");
            else if (action === "export-md") onExportMd();
            else onExportHtml();
          } else if (action === "settings") {
            openSettings();
          } else if (action === "about") {
            openSettings("about");
          } else if (action === "help-keys") {
            if (isTauriEnv()) {
              void import("@tauri-apps/api/core").then(({ invoke }) =>
                invoke("open_aux_window", { label: "shortcuts", tab: null }).catch((e) => console.error(e)),
              );
            }
          } else if (action === "help-doc" && (doc === "quick-start" || doc === "markdown")) {
            if (isTauriEnv()) {
              void import("@tauri-apps/api/core").then(({ invoke }) =>
                invoke("open_aux_window", { label: "help", tab: doc }).catch((e) => console.error(e)),
              );
            }
          } else if (action === "graph") {
            if (single.active) {
              showToast("文档图谱需要打开知识库");
            } else if (isTauriEnv()) {
              void import("@tauri-apps/api/core").then(({ invoke }) =>
                invoke("open_aux_window", { label: "graph", tab: null }).catch((e) => console.error(e)),
              );
            }
          } else if (action === "view" && key && typeof value === "boolean") {
            // 显示菜单勾选项:目标值由 Rust 算好(!当前镜像),前端照单应用
            if (key === "panel") updateSettings({ showRightPanel: value });
            else if (key === "toolbar") updateSettings({ showToolbar: value });
            else if (key === "outline") updateSettings({ showOutline: value });
            else if (key === "backlinks") updateSettings({ showBacklinks: value });
            else if (key === "tags") updateSettings({ showTags: value });
            else if (key === "history") updateSettings({ showHistory: value });
            else if (key === "focus") setFocusMode(value);
          }
        })();
      });
    })();
    return () => un?.();
  }, [
    exportSingleHtml,
    exportSingleMd,
    kb.pickAndCreate,
    kb.pickAndOpen,
    kb.openKbAt,
    onImportDocs,
    onExportMd,
    onExportHtml,
    openSettings,
    requestSingleAction,
    single.active,
    single.dirty,
    single.save,
    single.saveAs,
    showToast,
    updateSettings,
  ]);

  // 显示菜单勾选态回写(状态源在前端:面板/工具栏/分区持久化在 settings,专注模式会话级)
  useEffect(() => {
    if (!isTauriEnv() || !kb.booted) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("set_view_state", {
        panel: settings.showRightPanel,
        toolbar: settings.showToolbar,
        focus: focusMode,
        outline: settings.showOutline,
        backlinks: settings.showBacklinks,
        tags: settings.showTags,
        history: settings.showHistory,
      }).catch(console.error),
    );
  }, [
    kb.booted,
    settings.showRightPanel,
    settings.showToolbar,
    settings.showOutline,
    settings.showBacklinks,
    settings.showTags,
    settings.showHistory,
    focusMode,
  ]);

  // 文档图谱(V3 ①):图谱窗点击节点 → 打开文档并把主窗拉回前台
  useEffect(() => {
    if (!isTauriEnv()) return;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      un = await listen<string>("yz-graph-open", (e) => {
        void (async () => {
          await kb.openDoc(e.payload);
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFocus();
        })();
      });
    })();
    return () => un?.();
  }, [kb.openDoc]);

  // 设置窗的「重建索引」动到主窗 KB 状态,经事件桥回来执行
  useEffect(() => {
    if (!isTauriEnv()) return;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      un = await listen<{ action: string }>("yz-settings-action", (e) => {
        if (e.payload?.action === "rebuild") {
          void kb.rebuildIndex().then(() => showToast("索引已重建"));
        } else if (e.payload?.action === "template-from-current") {
          void saveCurrentAsTemplate();
        }
      });
    })();
    return () => un?.();
  }, [kb.rebuildIndex, saveCurrentAsTemplate, showToast]);

  // 系统「打开方式」/启动参数带来的 Markdown;前端监听就绪后再消费
  useEffect(() => {
    if (!kb.booted) return;
    let un: (() => void) | undefined;
    let disposed = false;
    let retryTimer: number | undefined;
    const consume = () => {
      void kbBackend
        .takeStartupSingleFile()
        .then((path) => {
          if (path) requestSingleAction({ kind: "open-path", path });
        })
        .catch(() => undefined);
    };
    consume();
    // macOS Opened 可能早于前端监听注册;延迟后再取一次 Rust pending
    retryTimer = window.setTimeout(consume, 1600);
    if (isTauriEnv()) {
      void import("@tauri-apps/api/event").then(({ listen }) => {
        void listen<string>("yz-open-single-file", () => {
          // 事件只作唤醒;路径仍从 pending 取走,避免延迟重试重复打开
          consume();
        }).then((fn) => {
          if (disposed) fn();
          else un = fn;
        });
      });
    }
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      un?.();
    };
  }, [kb.booted, requestSingleAction]);

  // 单文件有未保存修改时拦下窗口关闭,给保存/放弃/继续编辑三选一
  useEffect(() => {
    if (!single.active) return;
    if (!isTauriEnv()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (single.dirty) e.preventDefault();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    let un: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      void getCurrentWindow().onCloseRequested((event) => {
        if (!single.dirty) return;
        event.preventDefault();
        setSinglePending({ kind: "close", nextWindow: true });
      }).then((fn) => {
        if (disposed) fn();
        else un = fn;
      });
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, [single.active, single.dirty]);

  // V3 全局快捷键(设置来自应用配置;查找/替换由 Editor 内监听)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 浏览器开发无原生应用菜单:仅在此环境用 ⌘/Ctrl+, 打开设置。
      // Tauri 由原生菜单 accelerator 接管,避免双触发。
      if (
        !isTauriEnv() &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === "Comma"
      ) {
        e.preventDefault();
        openSettings();
        return;
      }
      if (!isTauriEnv() && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        requestSingleAction({ kind: "open-picker" });
        return;
      }
      if (!isTauriEnv() && single.active && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        void single.save();
        return;
      }
      if (!isTauriEnv() && single.active && (e.metaKey || e.ctrlKey) && !e.altKey && e.shiftKey && e.code === "KeyS") {
        e.preventDefault();
        void single.saveAs();
        return;
      }
      if (shortcutMatches(e, settings.shortcuts.focus)) {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (shortcutMatches(e, settings.shortcuts.navBack)) {
        e.preventDefault();
        if (!single.active) void kb.navBack();
        return;
      }
      if (shortcutMatches(e, settings.shortcuts.navForward)) {
        e.preventDefault();
        if (!single.active) void kb.navForward();
        return;
      }
      if (shortcutMatches(e, settings.shortcuts.slashMenu)) {
        e.preventDefault();
        editor?.chain().focus().insertContent("/").run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, kb.navBack, kb.navForward, openSettings, requestSingleAction, settings.shortcuts, single.active, single.save, single.saveAs]);

  const handleSingleReady = useCallback((e: Editor) => {
    setEditor(e);
    setEditorScope("single");
  }, []);
  const handleKbReady = useCallback((e: Editor) => {
    setEditor(e);
    setEditorScope("kb");
  }, []);
  const handleScrollRef = useCallback((el: HTMLDivElement | null) => setScrollEl(el), []);

  // 图片 src 渲染解析注册(layout effect 先于子组件 passive effect 的 setContent,
  // 文档切换时新图片挂载前 resolver 已指向新文档;无库时置空回落原样返回)
  useLayoutEffect(() => {
    setAssetResolver(single.active ? single.assetSrcResolver : kb.kbRoot ? kb.assetSrcResolver : null);
  }, [single.active, single.assetSrcResolver, kb.kbRoot, kb.assetSrcResolver, kb.currentPath]);

  // 搜索结果点击 → 打开文档;载入完成后再发定位信号(编辑器 setContent 之后)
  const onSearchSelect = useCallback(
    (rel: string, term: string) => {
      pendingLocate.current = term;
      if (rel === kb.currentPath) {
        // 当前文档:markdown 不会变,直接发信号
        setLocateSignal({ term, seq: ++locateSeq.current });
        pendingLocate.current = null;
      } else {
        void kb.openDoc(rel);
      }
    },
    [kb.currentPath, kb.openDoc],
  );
  useEffect(() => {
    if (!editor || pendingLocate.current == null) return;
    const term = pendingLocate.current;
    pendingLocate.current = null;
    setLocateSignal({ term, seq: ++locateSeq.current });
  }, [editor, kb.markdown]);

  // 打开/切换文档 → 标题跟随文件名(9.2)
  const currentPath = kb.currentPath;
  const kbEditor = editorScope === "kb" ? editor : null;
  const singleEditor = editorScope === "single" ? editor : null;
  useEffect(() => {
    setTitle(single.active ? single.fileStem : currentPath ? docBasename(currentPath) : "");
  }, [single.active, single.fileStem, currentPath]);

  // 打开失败(文件被外部删除/权限):明确反馈,不静默(M4 异常恢复)
  useEffect(() => {
    if (kb.docError) showToast(`无法打开「${docBasename(kb.docError)}」:文件不存在或无法读取`);
  }, [kb.docError, showToast]);

  // 反向链接(5.4-2):refsVersion 在保存/删除/回收站变动时递增,驱动面板重算
  const backlinks = useMemo(
    () => kb.getBacklinks(kb.currentPath),
    [kb.currentPath, kb.refsVersion, kb.tree, kb.getBacklinks],
  );

  /* 标签筛选视图(6.3-2):树过滤为带该标签的文档(空文件夹隐藏);过滤态禁拖 */
  const shownTree = useMemo(
    () => (tagFilter ? filterTreeByTag(kb.tree, kb.docsByTag(tagFilter)) : kb.tree),
    [tagFilter, kb.tree, kb.docsByTag],
  );

  // 改名统一入口:标题框(文档)与目录树(文件夹)共用,引用联动时提示更新数
  const renameWithToast = useCallback(
    async (rel: string, name: string) => {
      const r = await kb.renameEntry(rel, name);
      if (r?.refCount) showToast(`已更新 ${r.refCount} 处双链引用`);
    },
    [kb.renameEntry, showToast],
  );

  // 拖入文件夹 / 跨组拖到目标旁 = 移动(5.1 调整层级);同名冲突等失败要浮出来,不能静默
  const moveWithToast = useCallback(
    async (src: string, dest: string, ordered?: string[]) => {
      const r = await kb.moveEntry(src, dest, ordered);
      if (r) {
        if (r.refCount) showToast(`已更新 ${r.refCount} 处双链引用`);
      } else {
        showToast("移动失败:目标位置已有同名条目,或目标在自身内部");
      }
    },
    [kb.moveEntry, showToast],
  );

  const batchMoveDocs = useCallback(
    async (rels: string[], destFolder: string): Promise<BatchResult> => {
      let ok = 0;
      let refCount = 0;
      const errors: string[] = [];
      for (const rel of rels) {
        const result = await kb.moveEntry(rel, destFolder);
        if (result) {
          ok++;
          refCount += result.refCount;
        } else {
          errors.push(`移动「${rel}」失败:目标位置已有同名条目`);
        }
      }
      if (refCount) showToast(`已更新 ${refCount} 处双链引用`);
      return { ok, failed: rels.length - ok, errors };
    },
    [kb.moveEntry, showToast],
  );

  const batchSetDocTags = useCallback(
    async (rels: string[], add: string[], remove: string[]): Promise<BatchResult> => {
      const changed = kb.setTagsMany(rels, add, remove);
      return {
        ok: changed,
        failed: 0,
        errors: changed ? [] : ["所选文档没有发生标签变化"],
      };
    },
    [kb.setTagsMany],
  );

  const batchRenameDocs = useCallback(
    async (items: BatchRenameItem[]): Promise<BatchResult> => {
      let ok = 0;
      let refCount = 0;
      const errors: string[] = [];
      for (const item of items) {
        if (item.rel === item.newRel) {
          ok++;
          continue;
        }
        const result = await kb.renameEntry(item.rel, item.newName);
        if (result) {
          ok++;
          refCount += result.refCount;
        } else {
          errors.push(`重命名「${item.rel}」失败`);
        }
      }
      if (refCount) showToast(`已更新 ${refCount} 处双链引用`);
      return { ok, failed: items.length - ok, errors };
    },
    [kb.renameEntry, showToast],
  );

  // 新建文档(7.5):知识库有模板(.yanzhi/templates/*.md)时先弹选择器;无模板零打扰直建。
  // 模板目录读取失败按无模板处理,不能挡住新建
  const handleCreateDoc = useCallback(
    async (folder: string, name: string) => {
      let names: string[] = [];
      if (kb.kbRoot) {
        try {
          names = await kbBackend.listTemplates(kb.kbRoot);
        } catch {
          /* noop */
        }
      }
      if (!names.length) {
        void kb.createDoc(folder, name);
        return;
      }
      setTplNames(names);
      setTplPicker({ folder, name });
    },
    [kb.kbRoot, kb.createDoc],
  );

  // 模板选择器确认:读模板原文 → 剥离首行 H1(标题由文件名承担,9.2)→ 建文档;
  // 读失败回退空白,不让用户卡在新建
  const confirmCreateFromTemplate = useCallback(
    async (name: string, template: string | null) => {
      const p = tplPicker;
      setTplPicker(null);
      if (!p) return;
      let content: string | undefined;
      if (template && kb.kbRoot) {
        try {
          content = templateToContent(await kbBackend.readTemplate(kb.kbRoot, template));
        } catch {
          /* noop:回退空白 */
        }
      }
      await kb.createDoc(p.folder, name, content);
    },
    [tplPicker, kb.kbRoot, kb.createDoc],
  );

  // 标题编辑 → 重命名文件(debounce;文件名与标题始终同步)
  const onTitleChange = (raw: string) => {
    setTitle(raw);
    window.clearTimeout(renameTimer.current);
    renameTimer.current = window.setTimeout(() => {
      const cleaned = stripTitle(titleRef.current);
      if (!cleaned || !currentPath || cleaned === docBasename(currentPath)) return;
      void renameWithToast(currentPath, cleaned);
    }, 800);
  };

  // `[[` 检索列表:树平铺 + 重名文档算好路径写法目标(PRD §517)
  const wikiDocRefs = useMemo<WikiDocRef[]>(() => {
    const docs = flattenDocs(kb.tree);
    return docs.map((d) => ({ name: d.name, path: d.path, target: wikiTargetFor(docs, d.path) }));
  }, [kb.tree]);

  const onOpenWikiLink = useCallback(
    (target: string) => {
      void kb.openWikiLink(target).then((rel) => {
        // 失效链接(5.2.1-5):提示 + 「搜索同名文档」快捷入口,不自动瞎跳
        if (!rel) setWikiDead(target);
      });
    },
    [kb.openWikiLink],
  );

  // 稳定函数引用(扩展 options 在 useEditor 时定型,内部闭包读 ref)
  const getWikiDocs = useCallback(() => wikiDocRefs, [wikiDocRefs]);

  /* ---- 图片落盘(5.3.7/9.3):粘贴/拖拽 → 可选压缩 → assets → 插入 ---- */
  const onImageFiles = useCallback(
    async (files: File[]): Promise<string[]> => {
      // §8 图片设置:WebP q85 压缩在哈希命名之前(同图同设置只存一份);关闭则原样落盘
      const prepared = settings.imageCompress
        ? await Promise.all(files.map((f) => compressImageFile(f)))
        : files;
      const srcs = await kb.saveImageFiles(prepared);
      if (editor) {
        for (let i = 0; i < srcs.length; i++) {
          insertImage(editor, {
            src: srcs[i],
            alt: prepared[i]?.name?.replace(/\.[^.]+$/, "") || null,
          });
        }
      }
      if (!srcs.length) showToast("图片保存失败");
      return srcs;
    },
    [editor, kb.saveImageFiles, showToast, settings.imageCompress],
  );
  const onPickImage = useCallback(() => kb.importImagesFromPicker(), [kb.importImagesFromPicker]);

  const onSingleImageFiles = useCallback(
    async (files: File[]): Promise<string[]> => {
      if (!(await confirmSingleAssets())) return [];
      const prepared = settings.imageCompress
        ? await Promise.all(files.map((f) => compressImageFile(f)))
        : files;
      const srcs = await single.saveImageFiles(prepared);
      if (editor) {
        for (let i = 0; i < srcs.length; i++) {
          insertImage(editor, {
            src: srcs[i],
            alt: prepared[i]?.name?.replace(/\.[^.]+$/, "") || null,
          });
        }
      }
      if (!srcs.length) showToast("图片保存失败");
      return srcs;
    },
    [confirmSingleAssets, editor, settings.imageCompress, showToast, single],
  );

  const onPickSingleImage = useCallback(async (): Promise<string[] | null> => {
    if (!(await confirmSingleAssets())) return null;
    return single.importImagesFromPicker();
  }, [confirmSingleAssets, single]);

  /* ---- 附件卡片(6.1.5):文件选择 → assets;点击卡片 → 系统打开 ---- */
  const onPickAttachment = useCallback(
    () => kb.importAttachmentsFromPicker(),
    [kb.importAttachmentsFromPicker],
  );

  const onPickSingleAttachment = useCallback(async (): Promise<{ name: string; href: string }[] | null> => {
    if (!(await confirmSingleAssets())) return null;
    return single.importAttachmentsFromPicker();
  }, [confirmSingleAssets, single]);

  const onOpenSingleAttachment = useCallback(
    (href: string) => {
      void single.openAttachment(href).then((r) => {
        if (r === "missing") showToast("附件文件不存在或已被移动");
        else if (r === "unsupported") showToast("当前环境不支持打开附件");
      });
    },
    [single, showToast],
  );
  const onOpenAttachment = useCallback(
    (href: string) => {
      void kb.openAttachment(href).then((r) => {
        if (r === "missing") showToast("附件文件不存在或已被移动");
        else if (r === "unsupported") showToast("当前环境不支持打开附件");
      });
    },
    [kb.openAttachment, showToast],
  );

  /* ---- 窗口级拖拽兜底(WebKit 行为对齐) ----
   * 1) 外部文件拖进窗口,WebKit 默认动作是「打开文件」= 整窗导航把应用盖掉,必须拦;
   * 2) WKWebView 的 drop 事件 target 不可靠(真机实录:文件到了 window,PM 的编辑器
   *    监听却收不到,事件不属于 .yz-editor-doc)——图片落点用滚动区**坐标**判定,
   *    不依赖 e.target;命中即插入(插入语义 = 当前光标处,与 PM 路径一致)。
   *    PM 自己接住的 drop 会 stopPropagation,不会走到这里重复插入 */
  useEffect(() => {
    const guard = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (import.meta.env.DEV && e.type === "drop") {
        console.log(
          "[app] window drop:",
          dt?.types && Array.from(dt.types).join(","),
          `files=${dt?.files?.length ?? 0}`,
          `x=${e.clientX} y=${e.clientY}`,
          e.target instanceof Element ? e.target.tagName : String(e.target),
        );
      }
      e.preventDefault();
      if (e.type !== "drop") return;
      const files = dt ? Array.from(dt.files) : [];
      const md = files.find((f) => /\.(md|markdown)$/i.test(f.name));
      if (md) {
        const path = (md as File & { path?: string }).path;
        if (path) requestSingleAction({ kind: "open-path", path });
        else showToast("无法获取拖入文件的原始路径,请使用「打开 Markdown 文件」");
        return;
      }
      const imgs = files.filter(isImageFile);
      if (!imgs.length) return;
      const r = scrollEl?.getBoundingClientRect();
      const hit =
        !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      // 坐标异常(0,0,WKWebView 合成事件形态)也放行:PM 没接住 + 有图片文件
      if (hit || (e.clientX === 0 && e.clientY === 0)) {
        void (single.active ? onSingleImageFiles(imgs) : onImageFiles(imgs));
      }
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, [scrollEl, onImageFiles, onSingleImageFiles, requestSingleAction, single.active, showToast]);

  if (!kb.booted) {
    return <main className="bg-background flex h-screen items-center justify-center" />;
  }

  if (single.active) {
    return (
      <SingleFileWorkspace
        single={single}
        editor={singleEditor}
        onReady={handleSingleReady}
        scrollRef={handleScrollRef}
        scrollEl={scrollEl}
        showToolbar={settings.showToolbar}
        cardBorder={settings.cardBorder}
        shortcuts={settings.shortcuts}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((v) => !v)}
        outlineOpen={singleOutlineOpen}
        onToggleOutline={() => setSingleOutlineOpen((v) => !v)}
        onOpenFile={() => requestSingleAction({ kind: "open-picker" })}
        onCloseFile={() => requestSingleAction({ kind: "close" })}
        onOpenKb={() => requestSingleAction({ kind: "open-kb-picker" })}
        onImageFiles={onSingleImageFiles}
        onPickImage={onPickSingleImage}
        onPickAttachment={onPickSingleAttachment}
        onOpenAttachment={onOpenSingleAttachment}
        toast={toast}
        pending={singlePending ? { description: singlePendingDescription, nextWindow: singlePending.kind === "close" && singlePending.nextWindow } : null}
        onCancelPending={() => setSinglePending(null)}
        onSavePending={saveAndRunSinglePending}
        onDiscardPending={discardAndRunSinglePending}
        assetsConfirmOpen={singleAssetsConfirmOpen}
        onAllowAssets={allowSingleAssets}
        onRejectAssets={rejectSingleAssets}
        saveToKbOpen={singleSaveToKbOpen}
        onSaveToKbOpenChange={setSingleSaveToKbOpen}
        recentRoots={kb.recent.recent}
        onSaveToKb={(root) => void saveCurrentSingleToKb(root)}
        savedToKb={singleSavedToKb}
        onStayAfterSaveToKb={() => setSingleSavedToKb(null)}
        onOpenSavedKb={(info) => void openSingleSavedKb(info)}
      />
    );
  }

  if (!kb.kbRoot) {
    return (
      <WelcomePage
        recent={kb.recent.recent}
        recentFiles={single.recentFiles.recent}
        bootError={kb.bootError}
        onPickCreate={kb.pickAndCreate}
        onForceCreate={(root) => kb.createKbAt(root, true)}
        onPickOpen={kb.pickAndOpen}
        onOpenRecent={kb.openKbAt}
        onPickSingleFile={() => single.openPicker().then((r) => r?.error ?? null)}
        onOpenRecentFile={single.openFile}
      />
    );
  }

  const saveLabel =
    kb.saveState === "saving"
      ? "保存中…"
      : kb.saveState === "dirty"
        ? "未保存"
        : kb.saveState === "error"
          ? "保存失败"
          : kb.savedAt
            ? `已自动保存 ${kb.savedAt}`
            : "就绪";

  return (
    <main className="app-shell bg-workspace text-foreground flex h-screen flex-col">
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {!focusMode && (
          <DocTree
            root={kb.kbRoot}
            tree={shownTree}
            currentPath={kb.currentPath}
            collapsed={kb.collapsed}
            indexReady={kb.indexReady}
            onToggleCollapse={kb.toggleCollapse}
            onOpenDoc={(rel) => void kb.openDoc(rel)}
            onCreateDoc={(folder, name) => void handleCreateDoc(folder, name)}
            onCreateFolder={(folder, name) => void kb.createFolder(folder, name)}
            onRenameEntry={(rel, name) => void renameWithToast(rel, name)}
            onRemoveEntry={(rel) => void kb.removeEntry(rel)}
            onReorder={kb.persistSiblingOrder}
            onMoveEntry={(src, dest, ordered) => void moveWithToast(src, dest, ordered)}
            onSearch={kb.search}
            onSearchSelect={onSearchSelect}
            searchPreset={searchPreset}
            onRebuildIndex={() => void kb.rebuildIndex()}
            onOpenTrash={() => setTrashOpen(true)}
            onOpenMarkdownFile={() => requestSingleAction({ kind: "open-picker" })}
            onBackHome={() => void kb.closeKb()}
            onOpenOtherKb={() => {
              void kb.pickAndOpen().then((err) => err && showToast(err));
            }}
            onCreateKb={() => {
              void kb.pickAndCreate().then((result) => {
                if (result?.kind === "not-empty") setMenuPending({ root: result.root, yanzhi: false });
                else if (result?.kind === "is-yanzhi") setMenuPending({ root: result.root, yanzhi: true });
                else if (result?.kind === "error") showToast(result.message);
              });
            }}
            trashCount={kb.trashCount}
            orphanCount={kb.orphanMeta.length}
            onOpenOrphans={() => setOrphansOpen(true)}
            pinnedSet={kb.pinnedDocs}
            onTogglePin={(rel, pinned) => kb.togglePinned(rel, pinned)}
            allTags={kb.allTags}
            tagCounts={kb.tagCounts}
            tagFilter={tagFilter}
            onTagFilter={setTagFilter}
            onBatchMove={batchMoveDocs}
            onBatchSetTags={batchSetDocTags}
            onBatchRename={batchRenameDocs}
            onToast={showToast}
          />
        )}
        <div className="border-border-subtle bg-editor flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-[0_10px_32px_-20px_color-mix(in_oklab,var(--foreground)_25%,transparent)]">
          {currentPath ? (
            /* 专注模式:导航按钮收起(纯 chrome,⌘[ ⌘] 仍可用),标题与正文同列对齐
             * (mx-auto max-w-3xl px-16,同 EditorContent 容器);常态:导航胶囊放在
             * 正文列左边界内侧,避免窄卡片时贴到纸张左缘 */
            <div className="w-full shrink-0 px-6 pt-7 pb-3">
              <div className="relative mx-auto max-w-3xl px-16">
                {!focusMode && (
                  <div
                    role="group"
                    aria-label="文档导航"
                    className="border-border-subtle bg-raised/55 absolute -left-1 top-1.5 flex items-center gap-0.5 rounded-lg border p-0.5 shadow-[0_1px_2px_color-mix(in_oklab,var(--workspace)_25%,transparent)]"
                  >
                    <Hint label={`后退 (${formatShortcut(settings.shortcuts.navBack)})`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground hover:bg-hover size-6 rounded-[5px]"
                        disabled={!kb.canBack}
                        onClick={() => void kb.navBack()}
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                    </Hint>
                    <Hint label={`前进 (${formatShortcut(settings.shortcuts.navForward)})`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground hover:bg-hover size-6 rounded-[5px]"
                        disabled={!kb.canFront}
                        onClick={() => void kb.navForward()}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </Hint>
                  </div>
                )}
                <input
                  className="w-full bg-transparent pb-1 text-[2rem] leading-tight font-semibold tracking-[-0.035em] outline-none placeholder:text-muted-foreground/45"
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="未命名文档"
                />
              </div>
            </div>
          ) : (
            <div className="h-[76px] shrink-0" />
          )}
          <YanzhiEditor
            markdown={kb.markdown}
            onReady={handleKbReady}
            scrollContainerRef={handleScrollRef}
            onMarkdownChange={kb.onMarkdownChange}
            wikiDocs={getWikiDocs}
            onOpenWikiLink={onOpenWikiLink}
            onImageFiles={onImageFiles}
            onPickImage={onPickImage}
            onPickAttachment={onPickAttachment}
            onOpenAttachment={onOpenAttachment}
            locateSignal={locateSignal}
            cardBorder={settings.cardBorder}
            showToolbar={settings.showToolbar && !focusMode}
            shortcuts={settings.shortcuts}
          />
        </div>
        {!focusMode && settings.showRightPanel && kbEditor && (
          <aside
            aria-label="右侧面板"
            className="border-border-subtle bg-sidebar flex w-[272px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-[0_10px_28px_-20px_color-mix(in_oklab,var(--foreground)_18%,transparent)]"
          >
            {kb.currentPath && settings.showTags && (
              <TagsPanel
                tags={kb.currentTags}
                allTags={kb.allTags}
                tagCounts={kb.tagCounts}
                activeFilter={tagFilter}
                onFilter={setTagFilter}
                onAdd={(ts) => kb.currentPath && kb.setTags(kb.currentPath, [...kb.currentTags, ...ts])}
                onRemove={(t) => kb.currentPath && kb.setTags(kb.currentPath, kb.currentTags.filter((x) => x !== t))}
              />
            )}
            {settings.showOutline && <TocPanel editor={kbEditor} scrollContainer={scrollEl} />}
            {settings.showBacklinks && (
              <BacklinksPanel
                rows={backlinks}
                onOpenSource={(rel) => {
                  // 跳到来源文档并高亮其内的引用写法(裸名最常见,作定位词)
                  if (kb.currentPath) onSearchSelect(rel, docBasename(kb.currentPath));
                }}
                onOpenTrash={() => setTrashOpen(true)}
              />
            )}
            {settings.showHistory && <HistoryPanel
              docRel={kb.currentPath}
              version={kb.historyVersion}
              intervalMin={settings.snapshotIntervalMin}
              listHistory={kb.listHistory}
              onSnapshot={async () => {
                const e = await kb.snapshotNow();
                showToast(e ? `已打快照 ${formatSnapshotTime(e.time)}` : "打快照失败");
                return e;
              }}
              onOpenEntry={(entry) => {
                setHistoryCurrent(kb.getMarkdownNow()); // 对比基准 = 打开时的最新正文
                setHistoryEntry(entry);
                setHistoryOpen(true);
              }}
            />}
            {/* 四分区全关:右栏留空壳会突兀,给个找回入口 */}
            {!settings.showOutline && !settings.showBacklinks && !settings.showHistory && !settings.showTags && (
              <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-xs">
                分区均已隐藏,可在菜单「显示」中开启
              </div>
            )}
          </aside>
        )}
      </div>
      <StatusBar
        editor={kbEditor}
        kbRoot={kb.kbRoot}
        saveLabel={saveLabel}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((v) => !v)}
        orphanCount={kb.orphanMeta.length}
        onOpenOrphans={() => setOrphansOpen(true)}
      />
      {toast &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="bg-popover text-popover-foreground pointer-events-none fixed bottom-10 left-1/2 z-[100] -translate-x-1/2 rounded-md px-3 py-1.5 text-sm shadow-md ring-1 ring-foreground/10"
          >
            {toast}
          </div>,
          document.body,
        )}
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        listTrash={kb.listTrash}
        restoreTrash={kb.restoreTrash}
        restoreTrashMany={kb.restoreTrashMany}
        purgeTrash={kb.purgeTrash}
        emptyTrash={kb.emptyTrash}
        onToast={showToast}
      />
      {/* 新建文档模板选择(7.5):仅知识库存在模板时出现 */}
      <TemplatePicker
        open={!!tplPicker}
        defaultName={tplPicker?.name ?? ""}
        templates={tplNames}
        onCancel={() => setTplPicker(null)}
        onConfirm={(name, tpl) => void confirmCreateFromTemplate(name, tpl)}
        onManage={() => {
          setTplPicker(null);
          setTplMgrOpen(true);
        }}
      />
      {/* 模板管理(7.5):onChanged 重拉列表,新建选择器与管理器永不分叉 */}
      <TemplateManager
        open={tplMgrOpen}
        onOpenChange={setTplMgrOpen}
        root={kb.kbRoot}
        onToast={showToast}
        onChanged={() => {
          if (kb.kbRoot) void kbBackend.listTemplates(kb.kbRoot).then(setTplNames).catch(() => undefined);
        }}
      />
      {/* 历史快照查看/对比/恢复(6.2);恢复前 useKb 会先为当前内容自动存快照 */}
      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        entry={historyEntry}
        currentMd={historyCurrent}
        loadContent={() =>
          historyEntry ? kb.readHistory(kb.currentPath ?? "", historyEntry.id) : Promise.resolve("")
        }
        onRestore={(content, entry) => {
          void kb.restoreSnapshot(content).then((ok) => {
            showToast(ok ? `已恢复到 ${formatSnapshotTime(entry.time)} 的快照` : "恢复失败");
          });
        }}
      />
      {/* 全局设置(8):浏览器 dev 的 Dialog 容器(Tauri 为独立窗口);改动即时生效,存应用目录 */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        onRebuildIndex={() => {
          void kb.rebuildIndex().then(() => showToast("索引已重建"));
        }}
        onCreateTemplateFromCurrent={() => void saveCurrentAsTemplate()}
      />
      {/* 菜单触发的库切换确认(5.0.2):非空目录 / 已是砚知库 */}
      <Dialog open={menuPending !== null} onOpenChange={(v) => !v && setMenuPending(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{menuPending?.yanzhi ? "已是砚知知识库" : "不是空文件夹"}</DialogTitle>
            <DialogDescription>
              {menuPending?.yanzhi
                ? `「${menuPending.root}」含 .yanzhi,建议直接打开它。`
                : `「${menuPending?.root}」不是空文件夹,建议选空文件夹,避免与其它资料混在一起。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setMenuPending(null)}>
              重选
            </Button>
            {menuPending?.yanzhi ? (
              <Button
                size="sm"
                onClick={() => {
                  const p = menuPending;
                  setMenuPending(null);
                  if (p) void kb.openKbAt(p.root).then((err) => err && showToast(err));
                }}
              >
                打开该知识库
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  const p = menuPending;
                  setMenuPending(null);
                  if (p) void kb.createKbAt(p.root, true).then((err) => err && showToast(err));
                }}
              >
                仍要在此创建
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 未识别条目整理(5.2.1):外部改名/移动后的失联 meta */}
      <OrphanMetaDialog
        open={orphansOpen}
        onOpenChange={setOrphansOpen}
        entries={kb.orphanMeta}
        tree={kb.tree}
        onClaim={(entry, target) => {
          kb.claimOrphan(entry, target);
          showToast(`已认领「${entry.path}」→「${target}」`);
        }}
        onClaimBatch={(pairs) => {
          kb.claimOrphansBatch(pairs);
          showToast(`已批量认领 ${pairs.length} 条偏好记录`);
        }}
        onDiscard={(entry) => {
          kb.discardOrphan(entry);
          showToast(`已丢弃「${entry.path}」的偏好记录`);
        }}
        onDiscardBatch={(entries) => {
          kb.discardOrphansBatch(entries);
          showToast(`已丢弃 ${entries.length} 条偏好记录`);
        }}
      />
      {/* 失效双链(5.2.1-5):提示 + 搜索同名文档快捷入口 */}
      <Dialog open={wikiDead !== null} onOpenChange={(v) => !v && setWikiDead(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>链接目标不存在</DialogTitle>
            <DialogDescription>
              「{wikiDead ?? ""}」不存在或已被移动(外部改名会让路径写法的链接失联)。
              可以搜索同名文档快速找到它。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setWikiDead(null)}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                // 裸名/路径写法都取最后一段作搜索词
                const name = (wikiDead ?? "").split("/").pop()?.replace(/\.md$/i, "") ?? "";
                if (name) setSearchPreset({ term: name, seq: ++searchPresetSeq.current });
                setWikiDead(null);
              }}
            >
              搜索同名文档
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 外部编辑器改了当前文档且本地有未保存修改(5.2.6) */}
      <Dialog open={kb.externalChange !== null} onOpenChange={() => void kb.resolveExternal(true)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>文件已在磁盘上被修改</DialogTitle>
            <DialogDescription>
              「{kb.externalChange ? docBasename(kb.externalChange) : ""}」被其他程序修改,
              而砚知里还有未保存的修改。保留哪一份?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void kb.resolveExternal(true)}>
              保留我的
            </Button>
            <Button onClick={() => void kb.resolveExternal(false)}>载入磁盘版本</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default App;
