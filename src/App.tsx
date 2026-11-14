import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ChevronLeft, ChevronRight, CircleCheck, Folder, Loader2 } from "lucide-react";
import { SourceModeToggle } from "./editor/SourceModeToggle";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { YanzhiEditor } from "./editor/YanzhiEditor";
import { EDITOR_COLUMN_CLASS } from "./editor/layout";
import { insertImage } from "./editor/extensions/image-card";
import type { WikiDocRef } from "./editor/wiki-link-command";
import { TocPanel } from "./editor/panel/TocPanel";
import { BacklinksPanel } from "./kb/BacklinksPanel";
import { HistoryPanel, formatSnapshotTime } from "./kb/HistoryPanel";
import { HistoryDialog } from "./kb/HistoryDialog";
import { DocTree } from "./kb/DocTree";
import { DocTabs, DocTabsEmptyState } from "./kb/DocTabs";
import { TagsPanel } from "./kb/TagsPanel";
import { filterTreeByTag } from "./kb/meta";
import { folderBreadcrumbs } from "./kb/breadcrumb";
import { StatusBar } from "./kb/StatusBar";
import { TrashDialog } from "./kb/TrashDialog";
import { OrphanMetaDialog } from "./kb/OrphanMetaDialog";
import { SettingsDialog } from "./kb/SettingsDialog";
import { TemplatePicker } from "./kb/TemplatePicker";
import { TemplateManager } from "./kb/TemplateManager";
import { templateToContent, uniqueTemplateName } from "./kb/templates";
import { compressImageFile, isImageFile } from "./kb/image-compress";
import { useSettings } from "./settings";
import { useAiSession } from "./ai/useAiSession";
import { useTitleAiSession } from "./ai/useTitleAiSession";
import { TitleAiControl } from "./ai/TitleAiControl";
import { buildTitleContext, markdownFingerprint } from "./ai/title-suggest";
import { WelcomePage } from "./kb/WelcomePage";
import { WorkspaceLoading } from "./kb/WorkspaceLoading";
import { SingleFileWorkspace } from "./kb/SingleFileWorkspace";
import { useKb } from "./kb/useKb";
import { useSingleFile } from "./kb/useSingleFile";
import { isTauriEnv, kbBackend } from "./kb/backend";
import { assetRelPosix, isExternalSrc, setAssetResolver } from "./kb/asset-src";
import { buildExportHtml } from "./kb/export-html";
import { collectHttpImageUrls, renderMermaidDataUrl } from "./export/prepare";
import { pmDocToPandocAst, type DocxExportStats } from "./export/pandoc-ast";
import { copyPlainText } from "./editor/clipboard";
import { prepareSingleMarkdownForKb } from "./kb/assets";
import { flattenDocs, resolveWikiTarget, wikiLinkTextFor, wikiTargetFor } from "./kb/wiki-refs";
import type { HistoryEntry } from "./kb/types";
import { formatShortcut, shortcutMatches } from "./shortcuts";
import { focusGlobalSearch } from "./kb/search-focus";
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
 * 标题 ↔ 文件名(PRD 9.2):标题输入框 = 文件名去 .md,失焦/Enter 立即改名落盘。
 */

const ILLEGAL_TITLE_CHARS = /[\\/:*?"<>|]/g;

const stripTitle = (raw: string): string =>
  raw.replace(ILLEGAL_TITLE_CHARS, "").trim().replace(/\.+$/, "");

const docBasename = (rel: string): string =>
  rel.split("/").pop()?.replace(/\.md$/i, "") ?? "";

type EditorScope = "kb" | "single";
type ToastKind = "info" | "success" | "error";

interface PendingDocxExport {
  doc: PMNode;
  defaultName: string;
  tags: string[];
  resourcePath: string | null;
  assetRoot: string | null;
  docRel: string | null;
  wikiDocs: { path: string; name: string }[];
  remoteImages: string[];
  remoteMode: "ask" | "always" | "never";
  pandocPath: string | null;
  referenceDocPath: string | null;
}

interface DocxReport {
  path: string;
  warnings: string[];
  stats: DocxExportStats;
  remoteEmbedded: number;
  remoteFailed: number;
}

const joinAbsPath = (root: string, rel: string): string =>
  `${root.replace(/[\\/]+$/, "")}/${rel}`;

function DocxRemoteConfirmDialog({
  pending,
  onCancel,
  onChoose,
}: {
  pending: PendingDocxExport;
  onCancel: () => void;
  onChoose: (download: boolean) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出时访问外链图片?</DialogTitle>
          <DialogDescription>
            文档包含 {pending.remoteImages.length} 个外链图片地址。选择下载嵌入后,砚知只会访问这些图片
            URL,不带 Cookie、不发送遥测;失败时会降级为普通链接。
          </DialogDescription>
        </DialogHeader>
        <ul className="border-border-subtle bg-raised max-h-40 overflow-auto rounded-md border p-2 font-mono text-xs">
          {pending.remoteImages.map((url) => (
            <li key={url} className="truncate" title={url}>
              {url}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消导出
          </Button>
          <Button variant="outline" size="sm" onClick={() => onChoose(false)}>
            不请求,导出链接
          </Button>
          <Button size="sm" onClick={() => onChoose(true)}>
            下载并嵌入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocxExportingOverlay() {
  return createPortal(
    <div
      className="bg-background/70 fixed inset-0 z-[95] flex items-center justify-center backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="正在导出 DOCX"
    >
      <div className="bg-raised text-foreground flex max-w-xs items-center gap-3 rounded-xl px-4 py-3 shadow-lg ring-1 ring-foreground/10">
        <Loader2 className="text-primary size-4 animate-spin" aria-hidden />
        <span className="min-w-0">
          <span className="block text-sm font-medium">正在导出 DOCX…</span>
          <span className="text-muted-foreground block text-xs">
            正在转换文档与嵌入资源，完成后会显示导出报告
          </span>
        </span>
      </div>
    </div>,
    document.body,
  );
}

function DocxReportDialog({ report, onClose }: { report: DocxReport; onClose: () => void }) {
  const details = [
    `本地图片:${report.stats.localImages}`,
    `外链图片:${report.stats.remoteImages} 个 / ${report.remoteEmbedded} 嵌入 / ${report.remoteFailed} 失败降级 / ${Math.max(0, report.stats.remoteImages - report.remoteEmbedded - report.remoteFailed)} 选择链接`,
    `Mermaid:${report.stats.mermaidRendered} 渲染 / ${report.stats.mermaidFailed} 保留源码`,
    `提示块:${report.stats.callouts}`,
    `折叠块:${report.stats.details}`,
    `Raw HTML:${report.stats.rawHtmlBlocks}`,
  ];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onFocusOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>DOCX 导出完成</DialogTitle>
          <DialogDescription className="break-all">{report.path}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ul className="text-muted-foreground space-y-1 text-xs">
            {details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {report.warnings.length > 0 && (
            <div className="border-border-subtle bg-raised max-h-44 overflow-auto rounded-md border p-2">
              <p className="mb-1 text-xs font-medium">降级与提示</p>
              <ul className="space-y-1 text-xs">
                {report.warnings.map((warning, i) => (
                  <li key={`${warning}-${i}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" onClick={onClose}>
            知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function App() {
  const { settings, update: updateSettings, ready: settingsReady } = useSettings();
  const kb = useKb(settings);
  const single = useSingleFile();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorScope, setEditorScope] = useState<EditorScope | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [sourceOutlineController, setSourceOutlineController] =
    useState<import("./editor/source-mode/MarkdownSourceEditor").MarkdownSourceOutlineController | null>(null);
  /* ---- 上次光标/滚动位置记忆(按文档;内存 Map + meta 落盘) ----
   * 内存 Map 记当前会话的位置(切文档时按旧路径取回);
   * 切文档/窗口失焦时写进 meta,下次开同一篇恢复到上次的位置。
   * 搜索结果跳转与双链跳转不恢复(用户要看的是命中处,不是上次位置)。 */
  const cursorMapRef = useRef(new Map<string, { pos: number; scrollTop: number }>());
  const prevPathRef = useRef<string | null>(null);
  const skipRestoreRelRef = useRef<string | null>(null);
  /** 编辑器正文已换成该 path 后才允许把选区记进去;避免切文档瞬间旧选区写到新 path */
  const loadedPathRef = useRef<string | null>(null);
  const editorFlushPendingRef = useRef<(() => void) | null>(null);
  const [title, setTitle] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [sourceMode, setSourceMode] = useState(false);
  const sourceModeRef = useRef(false);
  sourceModeRef.current = sourceMode;
  const sourceModeApiRef = useRef<((next: boolean) => void) | null>(null);
  const toggleSourceMode = useCallback(() => {
    sourceModeApiRef.current?.(!sourceModeRef.current);
  }, []);
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
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
  const [treeReveal, setTreeReveal] = useState<{ path: string; seq: number } | null>(null);
  const treeRevealSeq = useRef(0);
  /* 新建文档模板选择(7.5):知识库有模板时「新建文档」先经 TemplatePicker */
  const [tplPicker, setTplPicker] = useState<{ folder: string; name: string } | null>(null);
  const [tplNames, setTplNames] = useState<string[]>([]);
  const [tplMgrOpen, setTplMgrOpen] = useState(false);
  const [singlePending, setSinglePending] = useState<
    | { kind: "close"; nextWindow?: boolean }
    /** 关窗挂托盘 / 真退出前的未保存确认(不关闭当前单文件会话,除非随后进程退出) */
    | { kind: "app-leave"; leave: "tray" | "quit" }
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
  /** /ai 等入口未就绪时先提示,确认后再进设置,避免生硬直跳 */
  const [aiSetupPromptOpen, setAiSetupPromptOpen] = useState(false);
  const [titleAiPopoverOpen, setTitleAiPopoverOpen] = useState(false);
  // 单文件大纲默认展开(无目录树,大纲占左导航);与知识库右栏 showOutline 独立
  const [singleOutlineOpen, setSingleOutlineOpen] = useState(true);
  const singleAssetsAllowedRef = useRef(false);
  const singleAssetsResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const searchPresetSeq = useRef(0);
  // 全局搜索定位信号(seq 单调递增:同文档重复点击也能触发定位)
  const [locateSignal, setLocateSignal] = useState<{ term: string; seq: number } | null>(null);
  const locateSeq = useRef(0);
  const pendingLocate = useRef<string | null>(null);
  // 标题改名串行链:上一次 rename await 完再读最新路径,避免连续改名打到已失效的旧 rel
  const renameChain = useRef(Promise.resolve());
  const toastTimer = useRef<number | undefined>(undefined);
  const titleRef = useRef("");
  titleRef.current = title;
  const currentPathRef = useRef<string | null>(null);
  const prevTitlePathRef = useRef<string | null>(null);

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    setToast({ message, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const recordCodeLanguage = useCallback(
    (language: string) => {
      const next = [
        language,
        ...settings.recentCodeLanguages.filter((item) => item !== language),
      ].slice(0, 5);
      if (next.join("\0") !== settings.recentCodeLanguages.join("\0")) {
        updateSettings({ recentCodeLanguages: next });
      }
    },
    [settings.recentCodeLanguages, updateSettings],
  );

  // 设置入口:浏览器 dev/E2E 用 Dialog;Tauri 独立窗口(open_aux_window 建窗/聚焦)。
  // tab 供菜单「关于砚知」/AI 引导直落分类
  const [settingsTab, setSettingsTab] = useState("general");
  const openSettings = useCallback((tab?: string) => {
    if (tab) setSettingsTab(tab);
    if (isTauriEnv()) {
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("open_aux_window", { label: "settings", tab: tab ?? null }).catch((e) => console.error(e)),
      );
    } else {
      setSettingsOpen(true);
    }
  }, []);

  const promptAiSetup = useCallback(() => setAiSetupPromptOpen(true), []);

  // 双链建议只认知识库文档名;列表在树加载后写入 ref,避免 useAiSession 早于 wikiDocRefs
  const wikiDocsForAiRef = useRef<import("./editor/wiki-link-command").WikiDocRef[]>([]);
  const aiSession = useAiSession(settings, promptAiSetup, showToast, () => wikiDocsForAiRef.current);
  const titleAi = useTitleAiSession(settings, promptAiSetup, showToast);

  const confirmSingleAssets = useCallback(() => {
    if (singleAssetsAllowedRef.current) return Promise.resolve(true);
    setSingleAssetsConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      singleAssetsResolveRef.current?.(false);
      singleAssetsResolveRef.current = resolve;
    });
  }, []);

  /** 关窗挂托盘或真退出:知识库先冲刷;单文件 dirty 由调用方先弹确认 */
  const finishAppLeave = useCallback(
    async (leave: "tray" | "quit") => {
      if (!isTauriEnv()) {
        if (leave === "quit") window.close();
        return;
      }
      if (kb.kbRoot) await kb.flushSave();
      const { invoke } = await import("@tauri-apps/api/core");
      if (leave === "tray") {
        await invoke("set_close_to_tray", { enabled: true });
        await invoke("hide_main_window");
        return;
      }
      await invoke("quit_app");
    },
    [kb],
  );

  const requestAppLeave = useCallback(
    (leave: "tray" | "quit") => {
      if (single.active && single.dirty) {
        setSinglePending({ kind: "app-leave", leave });
        return;
      }
      void finishAppLeave(leave);
    },
    [finishAppLeave, single.active, single.dirty],
  );

  const runSinglePending = useCallback(
    async (pending: NonNullable<typeof singlePending>) => {
      setSinglePending(null);
      if (pending.kind === "app-leave") {
        await finishAppLeave(pending.leave);
        return;
      }
      if (pending.kind === "close") {
        await single.close();
        if (pending.nextWindow && isTauriEnv()) {
          void import("@tauri-apps/api/core").then(({ invoke }) => void invoke("quit_app"));
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
        if (err === "cancelled") return; // 取消选文件夹:留在单文件页
        if (err) {
          showToast(err);
          return;
        }
        await single.close();
        return;
      }
      if (pending.kind === "new-kb") {
        const result = await kb.pickAndCreate();
        if (result?.kind === "cancelled") return;
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
    [finishAppLeave, kb, showToast, single],
  );

  const requestSingleAction = useCallback(
    (pending: NonNullable<typeof singlePending>) => {
      if (single.active && single.dirty) setSinglePending(pending);
      else void runSinglePending(pending);
    },
    [runSinglePending, single.active, single.dirty],
  );

  /**
   * 知识库模式「立即保存」(原生菜单 ⌘S / 前端快捷键共用):
   * 冲刷自动保存的待写内容并给明确反馈——自动保存是 2s 去抖,
   * 用户按 ⌘S 是想要「已经存了」的确定感,原先按了毫无反应。
   */
  const saveKbNow = useCallback(() => {
    if (!kb.currentPath) {
      showToast("未打开文档");
      return;
    }
    const pending = kb.saveState === "dirty";
    void kb.flushSave().then(() => showToast(pending ? "已保存" : "已是最新"));
  }, [kb.currentPath, kb.flushSave, kb.saveState, showToast]);

  const singlePendingDescription = useMemo(() => {
    if (!singlePending) return "";
    if (singlePending.kind === "app-leave") {
      return singlePending.leave === "tray"
        ? "隐藏到后台前可以先保存、放弃修改,或继续编辑。"
        : "退出前可以先保存、放弃修改,或继续编辑。";
    }
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
    // 挂后台时放弃修改:重载磁盘版清 dirty,会话保留;真退出则直接走 leave
    if (pending.kind === "app-leave" && pending.leave === "tray") {
      void single.reload().then(() => runSinglePending(pending));
      return;
    }
    void runSinglePending(pending);
  }, [runSinglePending, single, singlePending]);

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

  /* ---- DOCX 语义导出(5.6):PM doc → Pandoc AST,不让 Pandoc 重解析 Markdown ---- */
  const [docxExportBusy, setDocxExportBusy] = useState(false);
  const [docxLoadingVisible, setDocxLoadingVisible] = useState(false);
  const [pendingDocxExport, setPendingDocxExport] = useState<PendingDocxExport | null>(null);
  const [docxReport, setDocxReport] = useState<DocxReport | null>(null);

  const runDocxExport = useCallback(
    async (
      pending: PendingDocxExport,
      downloadRemoteImages: boolean,
      outputPath: string,
    ) => {
      // Show loading immediately after the native Save dialog returns.
      // Keep it visible for at least 300ms so fast exports still give clear feedback.
      const loadingStartedAt = Date.now();
      setDocxExportBusy(true);
      setDocxLoadingVisible(true);
      const waitMinimumLoading = async () => {
        const remaining = 300 - (Date.now() - loadingStartedAt);
        if (remaining > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
      };
      try {
        const { ast, warnings, stats } = await pmDocToPandocAst(pending.doc, {
          tags: pending.tags,
          remoteImages: downloadRemoteImages ? "embed" : "link",
          renderMermaid: renderMermaidDataUrl,
          resolveWikiTarget: (target) => {
            const rel = resolveWikiTarget(pending.wikiDocs, target);
            return pending.assetRoot && rel ? joinAbsPath(pending.assetRoot, rel) : null;
          },
          resolveAssetPath: (href) => {
            if (!pending.assetRoot || !pending.docRel || isExternalSrc(href)) return href;
            const rel = assetRelPosix(pending.docRel, href);
            // 只解析库内/文档旁 assets,避免 Markdown 恶意相对路径让导出读取任意本机文件。
            if (!rel || !rel.split("/").includes("assets")) return "";
            return joinAbsPath(pending.assetRoot, rel);
          },
        });
        const result = await kbBackend.exportDocx({
          outputPath,
          ast,
          resourcePath: pending.resourcePath,
          remoteImages: pending.remoteImages,
          downloadRemoteImages,
          pandocPath: pending.pandocPath,
          referenceDocPath: pending.referenceDocPath,
        });
        if (!result) return;
        const allWarnings = [
          ...warnings.map((warning) => warning.message),
          ...result.warnings,
        ];
        const remoteLinked = Math.max(
          0,
          stats.remoteImages - result.remoteEmbedded - result.remoteFailed,
        );
        const hasExportIssues =
          allWarnings.length > 0 ||
          result.remoteFailed > 0 ||
          remoteLinked > 0 ||
          stats.mermaidFailed > 0 ||
          stats.rawHtmlBlocks > 0 ||
          stats.details > 0;
        await waitMinimumLoading();
        showToast("DOCX 导出成功", "success");
        if (hasExportIssues) {
          setDocxReport({
            path: result.path,
            warnings: allWarnings,
            stats,
            remoteEmbedded: result.remoteEmbedded,
            remoteFailed: result.remoteFailed,
          });
        }
      } catch (e) {
        console.error("[export-docx]", e);
        await waitMinimumLoading();
        showToast(`DOCX 导出失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setDocxLoadingVisible(false);
        setDocxExportBusy(false);
        setPendingDocxExport(null);
      }
    },
    [showToast],
  );

  const beginDocxExport = useCallback(
    async (pending: PendingDocxExport, downloadRemoteImages: boolean) => {
      let outputPath: string | null;
      try {
        outputPath = await kbBackend.pickDocxOutputPath(pending.defaultName);
      } catch (e) {
        showToast(`选择保存位置失败:${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (!outputPath) return;
      await runDocxExport(pending, downloadRemoteImages, outputPath);
    },
    [runDocxExport, showToast],
  );

  const startDocxExport = useCallback(async () => {
    if (docxExportBusy || !editor?.state.doc) return;
    const doc = editor.state.doc;
    try {
      const pandoc = await kbBackend.detectPandoc(settings.pandocPath);
      if (!pandoc.installed) {
        showToast(pandoc.error ?? "未检测到 Pandoc 3+");
        openSettings("export");
        return;
      }
    } catch (e) {
      showToast(`Pandoc 检测失败:${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const singleActive = single.active;
    const exportTitle = singleActive
      ? single.fileStem || "未命名文档"
      : title || docBasename(kb.currentPath ?? "") || "未命名文档";
    const assetRoot = singleActive
      ? single.filePath?.slice(0, Math.max(0, single.filePath.lastIndexOf("/"))) || null
      : kb.kbRoot;
    const docRel = singleActive ? single.fileName : kb.currentPath;
    const folderRel = docRel?.includes("/")
      ? docRel.slice(0, docRel.lastIndexOf("/"))
      : "";
    const resourcePath = assetRoot
      ? folderRel
        ? joinAbsPath(assetRoot, folderRel)
        : assetRoot
      : null;
    const pending: PendingDocxExport = {
      doc,
      defaultName: `${exportTitle}.docx`,
      tags: singleActive ? [] : kb.currentTags,
      resourcePath,
      assetRoot,
      docRel,
      wikiDocs: singleActive ? [] : flattenDocs(kb.tree),
      remoteImages: collectHttpImageUrls(doc),
      remoteMode: settings.docxRemoteImageMode,
      pandocPath: settings.pandocPath,
      referenceDocPath: settings.docxReferencePath,
    };

    if (pending.remoteImages.length > 0 && pending.remoteMode === "ask") {
      // 先完成外链授权,再弹保存位置;点击 Save 后才进入导出 loading。
      setPendingDocxExport(pending);
      return;
    }

    await beginDocxExport(
      pending,
      pending.remoteImages.length > 0 && pending.remoteMode !== "never",
    );
  }, [
    beginDocxExport,
    docxExportBusy,
    editor,
    kb.currentPath,
    kb.currentTags,
    kb.kbRoot,
    kb.tree,
    openSettings,
    runDocxExport,
    settings.docxReferencePath,
    settings.docxRemoteImageMode,
    settings.pandocPath,
    showToast,
    single.active,
    single.fileStem,
    single.fileName,
    single.filePath,
    title,
  ]);

  const onExportDocx = useCallback(() => {
    void startDocxExport();
  }, [startDocxExport]);

  const chooseDocxRemoteImages = useCallback(
    (download: boolean) => {
      const pending = pendingDocxExport;
      setPendingDocxExport(null);
      if (pending) {
        void beginDocxExport(
          pending,
          download,
        );
      }
    },
    [beginDocxExport, pendingDocxExport],
  );

  const cancelDocxExport = useCallback(() => setPendingDocxExport(null), []);

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
  // 用 ref 挂最新处理函数 + 只订阅一次:依赖项变动时旧的 async listen 清理抢不到 un,
  // 会泄漏多个 handler → 另存为/设置等一次点击弹出多个对话框/窗口(Windows 尤甚)。
  type KbMenuPayload = {
    action: string;
    root?: string;
    path?: string;
    doc?: string;
    key?: string;
    value?: boolean;
  };
  const onKbMenuRef = useRef<(payload: KbMenuPayload) => void>(() => {});
  onKbMenuRef.current = (payload) => {
    void (async () => {
      const { action, root, key, value, doc, path } = payload;
      if (action === "new") {
        if (single.active && single.dirty) {
          setSinglePending({ kind: "new-kb" });
          return;
        }
        const r = await kb.pickAndCreate();
        if (r?.kind === "cancelled") return;
        if (r?.kind === "not-empty") setMenuPending({ root: r.root, yanzhi: false });
        else if (r?.kind === "is-yanzhi") setMenuPending({ root: r.root, yanzhi: true });
        else if (r?.kind === "error") showToast(r.message);
      } else if (action === "open") {
        if (single.active && single.dirty) {
          setSinglePending({ kind: "open-kb-picker" });
          return;
        }
        const err = await kb.pickAndOpen();
        if (err && err !== "cancelled") showToast(err);
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
      } else if (action === "close-tab") {
        // 原生菜单加速键可能先于 webview keydown 被系统消费,这里保留同一动作出口
        if (!single.active && kb.activeTabId) {
          await commitTitleRename();
          await kb.closeTabById(kb.activeTabId);
        }
      } else if (action === "save-doc") {
        // 单文件=写回原文件;知识库=立即冲刷待写内容
        if (single.active) void single.save();
        else saveKbNow();
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
      } else if (action === "export-md" || action === "export-html" || action === "export-docx") {
        // 无文档打开时导出静默无意义,给明确提示
        if (single.active) {
          if (action === "export-md") exportSingleMd();
          else if (action === "export-html") exportSingleHtml();
          else onExportDocx();
        } else if (!kb.currentPath) showToast("未打开文档");
        else if (action === "export-md") onExportMd();
        else if (action === "export-html") onExportHtml();
        else onExportDocx();
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
        // 显示菜单勾选项:目标值由 Rust 算好(!当前镜像),前端照单应用。
        // 单文件时「大纲」只切左侧大纲,不改知识库右栏偏好。
        if (key === "panel") updateSettings({ showRightPanel: value });
        else if (key === "toolbar") updateSettings({ showToolbar: value });
        else if (key === "outline") {
          if (single.active) setSingleOutlineOpen(value);
          else updateSettings({ showOutline: value });
        } else if (key === "backlinks") updateSettings({ showBacklinks: value });
        else if (key === "tags") updateSettings({ showTags: value });
        else if (key === "history") updateSettings({ showHistory: value });
        else if (key === "focus") setFocusMode(value);
        else if (key === "source") sourceModeApiRef.current?.(value);
      }
    })();
  };
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const fn = await listen<KbMenuPayload>("kb-menu", (e) => {
        onKbMenuRef.current(e.payload);
      });
      if (disposed) fn();
      else un = fn;
    })();
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // 显示菜单勾选态回写(状态源在前端:面板/工具栏/分区持久化在 settings,专注模式会话级);
  // singleFile 同步灰掉知识库专属项;singleOutline 镜像单文件左侧大纲勾选
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
        singleFile: single.active,
        singleOutline: singleOutlineOpen,
        source: sourceMode,
        sourceEnabled: single.active || !!kb.currentPath,
      }).catch(console.error),
    );
  }, [
    kb.booted,
    kb.currentPath,
    settings.showRightPanel,
    settings.showToolbar,
    settings.showOutline,
    settings.showBacklinks,
    settings.showTags,
    settings.showHistory,
    focusMode,
    sourceMode,
    single.active,
    singleOutlineOpen,
  ]);

  // 标签页动作在下方定义;键盘 effect 先通过 ref 消费,避免依赖声明顺序
  const activateDocTabRef = useRef<(tabId: string) => void>(() => {});
  const switchRelativeTabRef = useRef<(delta: number) => void>(() => {});
  const closeActiveDocTabRef = useRef<() => void>(() => {});

  // 文档图谱(V3 ①):图谱窗点击节点 → 打开文档并把主窗拉回前台
  const openDocFromGraphRef = useRef<(rel: string) => void>(() => {});
  openDocFromGraphRef.current = (rel) => {
    void (async () => {
      await kb.openDoc(rel);
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setFocus();
    })();
  };
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const fn = await listen<string>("yz-graph-open", (e) => {
        openDocFromGraphRef.current(e.payload);
      });
      if (disposed) fn();
      else un = fn;
    })();
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // 设置窗的「重建索引」动到主窗 KB 状态,经事件桥回来执行
  const onSettingsActionRef = useRef<(action: string) => void>(() => {});
  onSettingsActionRef.current = (action) => {
    if (action === "rebuild") {
      void kb.rebuildIndex().then(() => showToast("索引已重建"));
    } else if (action === "template-from-current") {
      void saveCurrentAsTemplate();
    }
  };
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const fn = await listen<{ action: string }>("yz-settings-action", (e) => {
        if (e.payload?.action) onSettingsActionRef.current(e.payload.action);
      });
      if (disposed) fn();
      else un = fn;
    })();
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

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

  // 关主窗 / 退出:用 ref 挂最新处理,只订一次(同 kb-menu,避免 deps 抖动泄漏多 handler)
  const requestAppLeaveRef = useRef(requestAppLeave);
  requestAppLeaveRef.current = requestAppLeave;
  const closeToTrayRef = useRef(settings.closeToTray);
  closeToTrayRef.current = settings.closeToTray;
  const singleDirtyRef = useRef(single.active && single.dirty);
  singleDirtyRef.current = single.active && single.dirty;

  useEffect(() => {
    if (!isTauriEnv()) {
      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (singleDirtyRef.current) e.preventDefault();
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }
    let unClose: (() => void) | undefined;
    let unQuit: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      void getCurrentWindow()
        .onCloseRequested((event) => {
          event.preventDefault();
          requestAppLeaveRef.current(closeToTrayRef.current ? "tray" : "quit");
        })
        .then((fn) => {
          if (disposed) fn();
          else unClose = fn;
        });
    });
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen("yz-app-quit", () => {
        requestAppLeaveRef.current("quit");
      }).then((fn) => {
        if (disposed) fn();
        else unQuit = fn;
      });
    });
    return () => {
      disposed = true;
      unClose?.();
      unQuit?.();
    };
  }, []);

  // 设置开/关「关闭窗口时保持后台」→ 同步托盘生命周期
  useEffect(() => {
    if (!isTauriEnv()) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => {
      void invoke("set_close_to_tray", { enabled: settings.closeToTray }).catch(console.error);
    });
  }, [settings.closeToTray]);

  // V3 全局快捷键(设置来自应用配置;查找/替换由 Editor 内监听)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 菜单类快捷键(⌘/Ctrl+S/O/,):浏览器无原生菜单必须前端接;
      // Windows WebView2 获焦时常吞掉菜单 accelerator → 也必须前端接;
      // macOS Tauri 仍走原生菜单,避免与 accelerator 双触发(见 lib.rs 专注模式同理)。
      const bridgeMenuShortcuts = !isTauriEnv() || /Win/i.test(navigator.userAgent);
      if (
        bridgeMenuShortcuts &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === "Comma"
      ) {
        e.preventDefault();
        openSettings();
        return;
      }
      if (
        bridgeMenuShortcuts &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === "KeyO"
      ) {
        e.preventDefault();
        requestSingleAction({ kind: "open-picker" });
        return;
      }
      if (
        bridgeMenuShortcuts &&
        single.active &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === "KeyS"
      ) {
        e.preventDefault();
        void single.save();
        return;
      }
      // 知识库模式 ⌘S:立即冲刷自动保存待写内容(macOS 走原生菜单项,见 lib.rs yz_save_doc)
      if (
        bridgeMenuShortcuts &&
        !single.active &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.code === "KeyS"
      ) {
        e.preventDefault();
        saveKbNow();
        return;
      }
      if (
        bridgeMenuShortcuts &&
        single.active &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.shiftKey &&
        e.code === "KeyS"
      ) {
        e.preventDefault();
        void single.saveAs();
        return;
      }
      // 文档标签页(仅知识库模式):保留 ⌘[/] 给当前 tab 的前进/后退
      if (!single.active && (e.metaKey || e.ctrlKey)) {
        if (!e.altKey && !e.shiftKey && e.code === "KeyW") {
          e.preventDefault();
          closeActiveDocTabRef.current();
          return;
        }
        if (!e.altKey && e.shiftKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
          e.preventDefault();
          switchRelativeTabRef.current(e.code === "BracketLeft" ? -1 : 1);
          return;
        }
        // Ctrl+Tab 是浏览器惯例;直接定位补 Alt,避免占用编辑器既有 ⌘/Ctrl+1–6 标题快捷键
        if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "Tab") {
          e.preventDefault();
          switchRelativeTabRef.current(e.shiftKey ? -1 : 1);
          return;
        }
        if (e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
          e.preventDefault();
          const index = Number(e.code.slice(5)) - 1;
          const tab = kb.tabs[index];
          if (tab) activateDocTabRef.current(tab.id);
          return;
        }
      }
      if (shortcutMatches(e, settings.shortcuts.search)) {
        e.preventDefault();
        focusGlobalSearch();
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
    // capture:Ctrl+Tab 先于 TabIndent,应用级组合键也不会被编辑器先消化
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, kb.navBack, kb.navForward, kb.tabs, openSettings, requestSingleAction, saveKbNow, settings.shortcuts, single.active, single.save, single.saveAs]);

  const handleSingleReady = useCallback((e: Editor) => {
    setEditor(e);
    setEditorScope("single");
  }, []);
  const handleKbReady = useCallback((e: Editor) => {
    setEditor(e);
    setEditorScope("kb");
  }, []);
  const handleScrollRef = useCallback((el: HTMLDivElement | null) => setScrollEl(el), []);

  // 关闭最后一个标签页时卸载编辑器;主动清掉外层面板持有的实例,避免右栏继续消费已销毁 PM Editor
  useEffect(() => {
    if (single.active || !kb.kbRoot || kb.currentPath) return;
    setEditor(null);
    setEditorScope(null);
    setScrollEl(null);
    setSourceOutlineController(null);
  }, [kb.currentPath, kb.kbRoot, single.active]);

  // 图片 src 渲染解析注册(layout effect 先于子组件 passive effect 的 setContent,
  // 文档切换时新图片挂载前 resolver 已指向新文档;无库时置空回落原样返回)
  useLayoutEffect(() => {
    setAssetResolver(single.active ? single.assetSrcResolver : kb.kbRoot ? kb.assetSrcResolver : null);
  }, [single.active, single.assetSrcResolver, kb.kbRoot, kb.assetSrcResolver, kb.currentPath]);

  // 搜索结果点击 → 打开文档;载入完成后再发定位信号(编辑器 setContent 之后)
  const onSearchSelect = useCallback(
    (rel: string, term: string) => {
      // 标题/路径命中但正文未命中时只打开文档,不触发文档内查找。
      if (!term) {
        if (rel !== kb.currentPath) void kb.openDoc(rel);
        return;
      }
      pendingLocate.current = term;
      if (rel === kb.currentPath) {
        // 当前文档:markdown 不会变,直接发信号
        setLocateSignal({ term, seq: ++locateSeq.current });
        pendingLocate.current = null;
      } else {
        skipRestoreRelRef.current = rel; // 跳命中处,不恢复上次位置
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
  currentPathRef.current = currentPath;
  const kbEditor = editorScope === "kb" ? editor : null;
  const singleEditor = editorScope === "single" ? editor : null;

  const kbRootName = useMemo(() => {
    const root = kb.kbRoot ?? "";
    const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? root;
  }, [kb.kbRoot]);

  const revealFolderInTree = useCallback(
    (path: string) => {
      setFocusMode(false);
      setTagFilter(null);
      if (path) {
        const parts = path.split("/");
        kb.expandFolders(parts.map((_, i) => parts.slice(0, i + 1).join("/")));
      }
      setTreeReveal({ path, seq: ++treeRevealSeq.current });
    },
    [kb.expandFolders],
  );

  useEffect(() => {
    if (!settingsReady || !kb.kbRoot || !currentPath) return;
    const previous = settings.recentDocs[kb.kbRoot] ?? [];
    if (previous[0] === currentPath) return;
    updateSettings({
      recentDocs: {
        ...settings.recentDocs,
        [kb.kbRoot]: [currentPath, ...previous.filter((path) => path !== currentPath)].slice(0, 12),
      },
    });
  }, [currentPath, kb.kbRoot, settings.recentDocs, settingsReady, updateSettings]);
  useEffect(() => {
    if (single.active) {
      setTitle(single.fileStem);
      prevTitlePathRef.current = null;
      return;
    }
    if (!currentPath) {
      setTitle("");
      prevTitlePathRef.current = null;
      return;
    }
    const stem = docBasename(currentPath);
    const prev = prevTitlePathRef.current;
    prevTitlePathRef.current = currentPath;
    // 同目录文档改名落地:不覆盖用户已继续键入的内容(否则 debounce 期间的输入会被打回)
    const parentOf = (rel: string) => rel.slice(0, rel.lastIndexOf("/") + 1);
    const isSelfRename =
      prev != null &&
      prev !== currentPath &&
      parentOf(prev) === parentOf(currentPath) &&
      prev.endsWith(".md") &&
      currentPath.endsWith(".md");
    if (isSelfRename) {
      setTitle((prevTitle) => {
        const cleaned = stripTitle(prevTitle);
        const oldStem = docBasename(prev);
        if (!cleaned || cleaned === oldStem || cleaned === stem) return stem;
        return prevTitle;
      });
      return;
    }
    setTitle(stem);
  }, [single.active, single.fileStem, currentPath]);

  // 窗口标题随文档走:标题栏显示「文档名 - 砚知」,减少顶栏只有产品名的单调感
  useEffect(() => {
    if (!isTauriEnv()) return;
    const docLabel = stripTitle(title).trim() || (single.active ? single.fileStem : currentPath ? docBasename(currentPath) : "");
    const winTitle = docLabel ? `${docLabel} - 砚知` : "砚知";
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      void getCurrentWindow().setTitle(winTitle);
    });
  }, [title, currentPath, single.active, single.fileStem]);

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
      return r;
    },
    [kb.renameEntry, showToast],
  );

  const startTitleAi = useCallback(() => {
    const path = currentPathRef.current;
    if (!path?.endsWith(".md")) return;
    const markdown = kb.getMarkdownNow();
    if (buildTitleContext(markdown).chars < 8) {
      showToast("先写一点内容，再让 AI 起标题");
      return;
    }
    setTitleAiPopoverOpen(true);
    void titleAi.run({ markdown, sourcePath: path });
  }, [kb.getMarkdownNow, titleAi, showToast]);

  const applyTitleAi = useCallback(
    (candidate: string) => {
      const state = titleAi.state;
      if (state.phase !== "result") return;
      const path = currentPathRef.current;
      if (!path || path !== state.sourcePath) {
        showToast("文档已切换，请重新生成标题");
        return;
      }
      if (markdownFingerprint(buildTitleContext(kb.getMarkdownNow()).text) !== state.fingerprint) {
        showToast("文档内容已变化，请重新生成标题");
        return;
      }

      titleAi.clearResult();
      setTitleAiPopoverOpen(false);
      setTitle(candidate);
      titleRef.current = candidate;
      renameChain.current = renameChain.current
        .then(async () => {
          if (currentPathRef.current !== path) return;
          const result = await kb.renameEntry(path, candidate);
          if (!result) {
            if (currentPathRef.current === path) setTitle(docBasename(path));
            showToast("AI 标题重命名失败");
            return;
          }
          if (currentPathRef.current === path) {
            currentPathRef.current = result.newPath;
            setTitle(docBasename(result.newPath));
          }
          const finalTitle = docBasename(result.newPath);
          const messages: string[] = [];
          if (result.refCount) messages.push(`已更新 ${result.refCount} 处双链引用`);
          if (finalTitle !== candidate) messages.push(`同名冲突，已使用「${finalTitle}」`);
          else if (result.newPath === path) messages.push("标题未变化");
          if (messages.length) showToast(messages.join("，"));
        })
        .catch((e) => {
          console.error("[title-ai-rename]", e);
          if (currentPathRef.current === path) setTitle(docBasename(path));
          showToast("AI 标题重命名失败");
        });
    },
    [kb, titleAi, showToast],
  );

  const changeTitleAiPopoverOpen = useCallback(
    (open: boolean) => {
      setTitleAiPopoverOpen(open);
      // 请求中关掉气泡 = 取消;结果/错误仅收起,点图标可再看候选。
      if (!open && titleAi.state.phase === "running") void titleAi.cancel();
    },
    [titleAi],
  );

  // 取消/应用/关总开关回到 idle 时收起空弹层。
  useEffect(() => {
    if (titleAi.state.phase === "idle") setTitleAiPopoverOpen(false);
  }, [titleAi.state.phase]);

  // 切换文档后旧请求不再可用;直接取消，避免继续占用用户配置的模型服务。
  useEffect(() => {
    if (titleAi.state.phase === "idle") return;
    if (currentPath === titleAi.state.sourcePath) return;
    setTitleAiPopoverOpen(false);
    if (titleAi.state.phase === "running") void titleAi.cancel();
    else titleAi.clearResult();
  }, [currentPath, titleAi]);

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

  const batchTrashDocs = useCallback(
    (rels: string[]) => kb.removeEntries(rels),
    [kb.removeEntries],
  );

  // 新建文档(7.5):知识库有模板(.yanzhi/templates/*.md)时先弹选择器;无模板零打扰直建。
  // 目标文件夹先展开并退出标签筛选;创建后 openDoc 高亮/打开新文档,不自动进入重命名。
  const expandForCreate = useCallback(
    (folderRel: string) => {
      if (folderRel && kb.collapsed.has(folderRel)) kb.toggleCollapse(folderRel);
      // 标签筛选会隐藏没有标签的新文档;新建是显式导航意图,先退出筛选保证可见。
      setTagFilter(null);
    },
    [kb.collapsed, kb.toggleCollapse],
  );

  const handleCreateDoc = useCallback(
    async (folder: string, name: string) => {
      expandForCreate(folder);
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
    [expandForCreate, kb.createDoc, kb.kbRoot],
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
    [tplPicker, kb.createDoc, kb.kbRoot],
  );

  // 标题编辑:输入只改本地;失焦/Enter 立即落盘改名(切文档前也会先冲刷)
  const commitTitleRename = useCallback(() => {
    renameChain.current = renameChain.current
      .then(async () => {
        if (single.active) return;
        const cleaned = stripTitle(titleRef.current).trim();
        const path = currentPathRef.current;
        if (!cleaned || !path || cleaned === docBasename(path)) return;
        const r = await renameWithToast(path, cleaned);
        if (r?.newPath && currentPathRef.current === path) {
          currentPathRef.current = r.newPath;
          // 与磁盘最终名对齐(含同名去重后缀),并驱动左侧树名/高亮
          setTitle(docBasename(r.newPath));
        }
      })
      .catch((e) => console.error("[title-rename]", e));
    return renameChain.current;
  }, [renameWithToast, single.active]);

  const openDocAfterTitle = useCallback(
    async (rel: string) => {
      await commitTitleRename();
      await kb.openDoc(rel);
    },
    [commitTitleRename, kb.openDoc],
  );

  const activateDocTab = useCallback(
    async (tabId: string) => {
      await commitTitleRename();
      await kb.activateTab(tabId);
    },
    [commitTitleRename, kb.activateTab],
  );
  const closeDocTab = useCallback(
    async (tabId: string) => {
      if (tabId === kb.activeTabId) await commitTitleRename();
      await kb.closeTabById(tabId);
    },
    [commitTitleRename, kb.activeTabId, kb.closeTabById],
  );
  const closeOtherDocTabs = useCallback(
    async (tabId: string) => {
      await commitTitleRename();
      await kb.closeOthers(tabId);
    },
    [commitTitleRename, kb.closeOthers],
  );
  const closeLeftDocTabs = useCallback(
    async (tabId: string) => {
      await commitTitleRename();
      await kb.closeLeft(tabId);
    },
    [commitTitleRename, kb.closeLeft],
  );
  const closeRightDocTabs = useCallback(
    async (tabId: string) => {
      await commitTitleRename();
      await kb.closeRight(tabId);
    },
    [commitTitleRename, kb.closeRight],
  );
  const switchRelativeDocTab = useCallback(
    (delta: number) => {
      const index = kb.tabs.findIndex((tab) => tab.id === kb.activeTabId);
      if (index < 0 || kb.tabs.length < 2) return;
      const next = (index + delta + kb.tabs.length) % kb.tabs.length;
      void activateDocTab(kb.tabs[next].id);
    },
    [activateDocTab, kb.activeTabId, kb.tabs],
  );
  activateDocTabRef.current = tabId => void activateDocTab(tabId);
  switchRelativeTabRef.current = switchRelativeDocTab;
  closeActiveDocTabRef.current = () => {
    if (kb.activeTabId) void closeDocTab(kb.activeTabId);
  };

  // `[[` 检索列表 / 复制双链引用都基于完整树:标签筛选视图不能丢失重名消歧信息。
  const wikiDocs = useMemo(() => flattenDocs(kb.tree), [kb.tree]);
  const recentDocItems = useMemo(() => {
    const root = kb.kbRoot;
    if (!root) return [];
    const byPath = new Map(wikiDocs.map((doc) => [doc.path, doc] as const));
    return (settings.recentDocs[root] ?? []).flatMap((path) => {
      const doc = byPath.get(path);
      if (!doc) return [];
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      return [{ path, name: doc.name, dir }];
    });
  }, [kb.kbRoot, settings.recentDocs, wikiDocs]);
  const docNames = useMemo(() => new Map(wikiDocs.map((doc) => [doc.path, doc.name] as const)), [wikiDocs]);
  const breadcrumbFolders = useMemo(
    () => (currentPath ? folderBreadcrumbs(currentPath) : []),
    [currentPath],
  );
  const wikiDocRefs = useMemo<WikiDocRef[]>(
    () => wikiDocs.map((d) => ({ name: d.name, path: d.path, target: wikiTargetFor(wikiDocs, d.path) })),
    [wikiDocs],
  );
  wikiDocsForAiRef.current = wikiDocRefs;

  const canCopyWikiRef = useCallback(
    (rel: string) => wikiLinkTextFor(wikiDocs, rel) !== null,
    [wikiDocs],
  );
  const copyWikiRef = useCallback(
    async (rel: string) => {
      const text = wikiLinkTextFor(wikiDocs, rel);
      if (!text) {
        showToast("标题或路径包含双链不兼容字符");
        return;
      }
      try {
        await copyPlainText(text);
        showToast("双链引用已复制");
      } catch (e) {
        console.error("[copy-wiki-ref]", e);
        showToast("复制失败，请重试");
      }
    },
    [showToast, wikiDocs],
  );

  /** 本地优先:从目录树直接定位到系统文件管理器中的真实文件/文件夹 */
  const revealTreeEntry = useCallback(
    (rel: string) => {
      if (!kb.kbRoot) return;
      const abs = `${kb.kbRoot.replace(/[\\/]+$/, "")}/${rel}`;
      if (!isTauriEnv()) {
        showToast(`文件位置:${abs}`);
        return;
      }
      void import("@tauri-apps/plugin-opener")
        .then(({ revealItemInDir }) => revealItemInDir(abs))
        .catch(() => showToast("无法打开文件所在位置"));
    },
    [kb.kbRoot, showToast],
  );

  const onOpenWikiLink = useCallback(
    (target: string, options?: { newTab?: boolean }) => {
      void kb.openWikiLink(target, options?.newTab ?? false).then((rel) => {
        if (rel) skipRestoreRelRef.current = rel; // 跳目标文档,不恢复上次位置
        // 失效链接(5.2.1-5):提示 + 「搜索同名文档」快捷入口,不自动瞎跳
        if (!rel) setWikiDead(target);
      });
    },
    [kb.openWikiLink],
  );

  // 稳定函数引用(扩展 options 在 useEditor 时定型,内部闭包读 ref)
  const getWikiDocs = useCallback(() => wikiDocRefs, [wikiDocRefs]);

  /* ---- 上次光标/滚动位置:记录 / 落盘 / 恢复 ---- */
  // 记录:选区或滚动变化 → 内存 Map。仅当正文已加载到该 path 才写入。
  useEffect(() => {
    if (!editor) return;
    const record = () => {
      const rel = loadedPathRef.current;
      if (!rel) return;
      cursorMapRef.current.set(rel, {
        pos: editor.state.selection.from,
        scrollTop: scrollEl?.scrollTop ?? 0,
      });
    };
    editor.on("selectionUpdate", record);
    editor.on("update", record);
    const el = scrollEl;
    el?.addEventListener("scroll", record, { passive: true });
    return () => {
      // 切走前把旧文档当前位置再记一笔(此时 loadedPath 可能已清空,用闭包外的 map 键)
      const rel = loadedPathRef.current;
      if (rel) {
        cursorMapRef.current.set(rel, {
          pos: editor.state.selection.from,
          scrollTop: el?.scrollTop ?? 0,
        });
      }
      editor.off("selectionUpdate", record);
      editor.off("update", record);
      el?.removeEventListener("scroll", record);
    };
  }, [editor, scrollEl]);

  // 切文档:旧文档的位置落 meta;并清掉 loaded 标记,等编辑器换文后再放开记录。
  // 此时编辑器正文尚未 setContent,选区仍属旧文档,先快照再落盘。
  useEffect(() => {
    const prev = prevPathRef.current;
    const rel = kb.currentPath;
    if (prev && prev !== rel) {
      if (editor && !editor.isDestroyed && loadedPathRef.current === prev) {
        cursorMapRef.current.set(prev, {
          pos: editor.state.selection.from,
          scrollTop: scrollEl?.scrollTop ?? 0,
        });
      }
      const c = cursorMapRef.current.get(prev);
      if (c) kb.saveCursor(prev, c.pos, c.scrollTop);
      loadedPathRef.current = null;
    }
    prevPathRef.current = rel;
  }, [kb.currentPath, kb.saveCursor, editor, scrollEl]);

  // 窗口失焦:当前文档位置落 meta(关窗/切应用不丢位置)
  useEffect(() => {
    const onBlur = () => {
      const rel = loadedPathRef.current ?? kb.currentPath;
      if (!rel) return;
      const c = cursorMapRef.current.get(rel);
      if (c) kb.saveCursor(rel, c.pos, c.scrollTop);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [kb.currentPath, kb.saveCursor]);

  /** 打开文档后取回上次位置(内存优先,再回落 meta);搜索/双链跳转不恢复 */
  const getRestoreCursor = useCallback(
    (rel: string) => {
      if (skipRestoreRelRef.current === rel) {
        skipRestoreRelRef.current = null;
        return null;
      }
      return cursorMapRef.current.get(rel) ?? kb.getCursor(rel) ?? null;
    },
    [kb.getCursor],
  );

  const onEditorContentReady = useCallback((path: string) => {
    loadedPathRef.current = path;
  }, []);

  // 切文档前:冲刷去抖稿 + 同步快照滚动/光标(必须在 path/正文切换前,否则会被新文档或 setContent 冲掉)
  useEffect(() => {
    kb.setBeforeSwitch(() => {
      editorFlushPendingRef.current?.();
      const rel = loadedPathRef.current;
      if (!rel || !editor || editor.isDestroyed) return;
      cursorMapRef.current.set(rel, {
        pos: editor.state.selection.from,
        scrollTop: scrollEl?.scrollTop ?? 0,
      });
    });
    return () => kb.setBeforeSwitch(null);
  }, [kb.setBeforeSwitch, editor, scrollEl]);

  /* ---- 图片落盘(5.3.7/9.3):粘贴/拖拽 → 可选压缩 → assets → 插入 ---- */
  const onImageFiles = useCallback(
    async (files: File[]): Promise<string[]> => {
      // §8 图片设置:JPG/PNG 智能压缩在哈希命名之前(同图同设置只存一份);关闭则原样落盘
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
  /** 图片工具条「从文件替换」:选图 → 落 assets → 返回新 src(取消 null) */
  const onReplaceImage = useCallback(async (): Promise<string | null> => {
    const srcs = await kb.importImagesFromPicker();
    return srcs?.[0] ?? null;
  }, [kb.importImagesFromPicker]);

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

  if (!kb.booted || kb.openingKb) {
    return <WorkspaceLoading />;
  }

  if (single.active) {
    return (
      <>
      <SingleFileWorkspace
        single={single}
        editor={singleEditor}
        onReady={handleSingleReady}
        scrollRef={handleScrollRef}
        scrollEl={scrollEl}
        showToolbar={settings.showToolbar}
        sourceMode={sourceMode}
        onToggleSource={toggleSourceMode}
        onSourceModeChange={setSourceMode}
        sourceModeApiRef={sourceModeApiRef}
        tabIndentSize={settings.tabIndentSize}
        cardBorder={settings.cardBorder}
        tableCellCopy={settings.tableCellCopy}
        onToggleTableCellCopy={() =>
          updateSettings({ tableCellCopy: !settings.tableCellCopy })
        }
        typewriterMode={settings.typewriterMode}
        onToggleTypewriter={() => updateSettings({ typewriterMode: !settings.typewriterMode })}
        shortcuts={settings.shortcuts}
        codeLanguageRecents={settings.recentCodeLanguages}
        onCodeLanguageUsed={recordCodeLanguage}
        onExportDocx={onExportDocx}
        aiReady={settings.aiEnabled && settings.aiVerified}
        aiSession={aiSession}
        onNeedAiSettings={promptAiSetup}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((v) => !v)}
        outlineOpen={singleOutlineOpen}
        onToggleOutline={() => setSingleOutlineOpen((v) => !v)}
        onOpenFile={() => requestSingleAction({ kind: "open-picker" })}
        onCloseFile={() => requestSingleAction({ kind: "close" })}
        onOpenKb={() => requestSingleAction({ kind: "open-kb-picker" })}
        onBackHome={() => requestSingleAction({ kind: "close" })}
        onNewKb={() => requestSingleAction({ kind: "new-kb" })}
        onOpenRecentKb={(root) => requestSingleAction({ kind: "open-kb", root })}
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
      {pendingDocxExport && (
        <DocxRemoteConfirmDialog
          pending={pendingDocxExport}
          onCancel={cancelDocxExport}
          onChoose={chooseDocxRemoteImages}
        />
      )}
      {docxLoadingVisible && <DocxExportingOverlay />}
      {docxReport && (
        <DocxReportDialog report={docxReport} onClose={() => setDocxReport(null)} />
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        initialTab={settingsTab}
        onRebuildIndex={() => {
          void kb.rebuildIndex().then(() => showToast("索引已重建"));
        }}
        onCreateTemplateFromCurrent={() => void saveCurrentAsTemplate()}
      />
      </>
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
      {/* 顶距略收:紧贴系统菜单栏,两侧/底保留呼吸 */}
      <div className="shell-main flex min-h-0 flex-1 gap-3 px-3 pt-2 pb-3">
        {!focusMode && (
          <DocTree
            root={kb.kbRoot}
            tree={shownTree}
            // 用已切换的 tab 路径高亮:不等 readDoc/长文解析,点选立刻亮
            currentPath={
              kb.tabs.find((tab) => tab.id === kb.activeTabId)?.path ?? kb.currentPath
            }
            collapsed={kb.collapsed}
            indexReady={kb.indexReady}
            onToggleCollapse={kb.toggleCollapse}
            onSetAllCollapsed={kb.setAllCollapsed}
            iconMap={kb.entryIcons}
            onSetEntryIcon={kb.setTreeIcon}
            onOpenDoc={(rel) => void openDocAfterTitle(rel)}
            onRevealEntry={revealTreeEntry}
            onCreateDoc={(folder, name) => void handleCreateDoc(folder, name)}
            onCreateFolder={(folder, name) => kb.createFolder(folder, name)}
            onRenameEntry={(rel, name) => void renameWithToast(rel, name)}
            onRemoveEntry={(rel) => void kb.removeEntry(rel)}
            onReorder={kb.persistSiblingOrder}
            onMoveEntry={(src, dest, ordered) => void moveWithToast(src, dest, ordered)}
            onSearch={kb.search}
            onSearchSelect={onSearchSelect}
            revealFolder={treeReveal}
            recentDocs={recentDocItems}
            canCopyWikiRef={canCopyWikiRef}
            onCopyWikiRef={copyWikiRef}
            searchPreset={searchPreset}
            onRebuildIndex={() => void kb.rebuildIndex()}
            onOpenTrash={() => setTrashOpen(true)}
            onOpenMarkdownFile={() => requestSingleAction({ kind: "open-picker" })}
            onBackHome={() => void kb.closeKb()}
            onOpenOtherKb={() => {
              void kb.pickAndOpen().then((err) => {
                if (err && err !== "cancelled") showToast(err);
              });
            }}
            onCreateKb={() => {
              void kb.pickAndCreate().then((result) => {
                if (!result || result.kind === "cancelled") return;
                if (result.kind === "not-empty") setMenuPending({ root: result.root, yanzhi: false });
                else if (result.kind === "is-yanzhi") setMenuPending({ root: result.root, yanzhi: true });
                else if (result.kind === "error") showToast(result.message);
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
            onBatchTrash={batchTrashDocs}
            onToast={showToast}
          />
        )}
        <div className="shell-panel border-border-subtle bg-editor flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-[0_14px_40px_-22px_color-mix(in_oklab,var(--foreground)_32%,transparent)]">
          {!focusMode && (
            <DocTabs
              tabs={kb.tabs}
              activeId={kb.activeTabId}
              names={docNames}
              icons={kb.entryIcons}
              saveState={kb.saveState}
              onActivate={(tabId) => void activateDocTab(tabId)}
              onClose={(tabId) => void closeDocTab(tabId)}
              onCloseOthers={(tabId) => void closeOtherDocTabs(tabId)}
              onCloseLeft={(tabId) => void closeLeftDocTabs(tabId)}
              onCloseRight={(tabId) => void closeRightDocTabs(tabId)}
              onReorder={kb.reorderDocTabs}
              onReveal={revealTreeEntry}
            />
          )}
          {currentPath ? (
            /* 专注模式:导航按钮收起(纯 chrome,⌘[ ⌘] 仍可用);标题与正文同列对齐 */
            <div className="w-full shrink-0 px-6 pt-2 pb-0">
              <div className={`mx-auto ${EDITOR_COLUMN_CLASS} px-16`}>
                <div className="flex h-5 min-w-0 items-center gap-1">
                  {!focusMode && (
                    <div
                      role="group"
                      aria-label="文档导航"
                      className="chrome-nav text-muted-foreground flex shrink-0 items-center"
                    >
                      <Hint label={`后退 (${formatShortcut(settings.shortcuts.navBack)})`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground/80 hover:text-foreground hover:bg-hover size-5 rounded-md"
                          disabled={!kb.canBack}
                          onClick={() => void kb.navBack()}
                        >
                          <ChevronLeft className="size-3.5" />
                        </Button>
                      </Hint>
                      <Hint label={`前进 (${formatShortcut(settings.shortcuts.navForward)})`}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground/80 hover:text-foreground hover:bg-hover size-5 rounded-md"
                          disabled={!kb.canFront}
                          onClick={() => void kb.navForward()}
                        >
                          <ChevronRight className="size-3.5" />
                        </Button>
                      </Hint>
                    </div>
                  )}
                  <nav
                    aria-label="文档位置"
                    className="text-muted-foreground/75 flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[11px]"
                  >
                    <button
                      type="button"
                      className="hover:bg-hover hover:text-foreground flex min-w-0 shrink items-center gap-1 rounded px-1 py-0.5"
                      onClick={() => revealFolderInTree("")}
                      title={kb.kbRoot}
                    >
                      <Folder className="size-3 shrink-0 opacity-80" />
                      <span className="max-w-32 truncate">{kbRootName}</span>
                    </button>
                    {breadcrumbFolders.map((crumb) => (
                      <span key={crumb.path} className="flex min-w-0 shrink items-center gap-0.5">
                        <ChevronRight className="text-muted-foreground/40 size-3 shrink-0" />
                        <button
                          type="button"
                          className="hover:bg-hover hover:text-foreground max-w-36 truncate rounded px-1 py-0.5"
                          onClick={() => revealFolderInTree(crumb.path)}
                          title={crumb.path}
                        >
                          {crumb.label}
                        </button>
                      </span>
                    ))}
                  </nav>
                  <SourceModeToggle active={sourceMode} onToggle={toggleSourceMode} />
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1">
                  {/* 按标题内容撑开宽度,AI 贴在文字旁而不是栏尾 */}
                  <div className="relative min-w-[4ch] max-w-[calc(100%-1.75rem)]">
                    <span
                      aria-hidden
                      className="invisible block max-w-full truncate text-3xl leading-snug font-semibold tracking-[-0.03em] whitespace-pre"
                    >
                      {title || "未命名文档"}
                    </span>
                    <input
                      className="absolute inset-0 w-full bg-transparent text-3xl leading-snug font-semibold tracking-[-0.03em] outline-none placeholder:text-muted-foreground/45"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onBlur={() => void commitTitleRename()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="未命名文档"
                    />
                  </div>
                  <div className="shrink-0">
                    <TitleAiControl
                      state={titleAi.state}
                      ready={titleAi.ready}
                      currentTitle={title}
                      stale={
                        titleAi.state.phase !== "idle" &&
                        (currentPath !== titleAi.state.sourcePath ||
                          markdownFingerprint(buildTitleContext(kb.getMarkdownNow()).text) !==
                            titleAi.state.fingerprint)
                      }
                      popoverOpen={titleAiPopoverOpen}
                      onPopoverOpenChange={changeTitleAiPopoverOpen}
                      onStart={startTitleAi}
                      onNeedSettings={promptAiSetup}
                      onApply={applyTitleAi}
                      onCancel={() => {
                        setTitleAiPopoverOpen(false);
                        void titleAi.cancel();
                      }}
                      onDismiss={() => {
                        titleAi.clearResult();
                        setTitleAiPopoverOpen(false);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-12 shrink-0" />
          )}
          {currentPath ? (
            <YanzhiEditor
              markdown={kb.markdown}
              onReady={handleKbReady}
              scrollContainerRef={handleScrollRef}
              onSourceOutlineController={setSourceOutlineController}
              onMarkdownChange={kb.onMarkdownChange}
              wikiDocs={getWikiDocs}
              onOpenWikiLink={onOpenWikiLink}
              onImageFiles={onImageFiles}
              onPickImage={onPickImage}
              onReplaceImage={onReplaceImage}
              getRestoreCursor={getRestoreCursor}
              contentPath={kb.currentPath}
              onContentReady={onEditorContentReady}
              flushPendingRef={editorFlushPendingRef}
              onExportMd={onExportMd}
              onExportHtml={onExportHtml}
              onExportDocx={onExportDocx}
              onPickAttachment={onPickAttachment}
              onOpenAttachment={onOpenAttachment}
              locateSignal={locateSignal}
              cardBorder={settings.cardBorder}
              tableCellCopy={settings.tableCellCopy}
              onToggleTableCellCopy={() =>
                updateSettings({ tableCellCopy: !settings.tableCellCopy })
              }
              showToolbar={settings.showToolbar && !focusMode}
              sourceModeApiRef={sourceModeApiRef}
              onSourceModeChange={setSourceMode}
              tabIndentSize={settings.tabIndentSize}
              typewriter={focusMode && settings.typewriterMode}
              shortcuts={settings.shortcuts}
              codeLanguageRecents={settings.recentCodeLanguages}
              onCodeLanguageUsed={recordCodeLanguage}
              aiReady={settings.aiEnabled && settings.aiVerified}
              aiSession={aiSession}
              onNeedAiSettings={promptAiSetup}
            />
          ) : (
            <DocTabsEmptyState
              recentDocs={recentDocItems}
              onCreateDoc={() => void handleCreateDoc("", "未命名文档")}
              onOpenDoc={(rel) => void openDocAfterTitle(rel)}
            />
          )}
        </div>
        {!focusMode && settings.showRightPanel && kbEditor && (
          <aside
            aria-label="右侧面板"
            className="shell-panel border-border-subtle bg-sidebar flex w-[272px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-[0_10px_28px_-20px_color-mix(in_oklab,var(--foreground)_18%,transparent)]"
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
            {settings.showOutline && <TocPanel editor={kbEditor} scrollContainer={scrollEl} sourceOutlineController={sourceOutlineController} />}
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
        typewriterMode={settings.typewriterMode}
        onToggleTypewriter={() => updateSettings({ typewriterMode: !settings.typewriterMode })}
        orphanCount={kb.orphanMeta.length}
        onOpenOrphans={() => setOrphansOpen(true)}
        aiHost={
          titleAi.state.phase === "running"
            ? titleAi.state.host
            : aiSession.state.phase === "running"
              ? aiSession.state.host
              : null
        }
        onCancelAi={() => {
          if (titleAi.state.phase === "running") {
            setTitleAiPopoverOpen(false);
            void titleAi.cancel();
          } else {
            void aiSession.cancel();
          }
        }}
        sourceMode={sourceMode}
        onToggleSource={kb.currentPath ? toggleSourceMode : undefined}
      />
      {toast &&
        createPortal(
          <div
            role={toast.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`bg-popover text-popover-foreground pointer-events-none fixed bottom-10 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-md px-3 py-1.5 text-sm shadow-md ring-1 ${
              toast.kind === "success"
                ? "text-[var(--callout-success)] ring-[color-mix(in_oklab,var(--callout-success)_35%,transparent)]"
                : toast.kind === "error"
                  ? "text-[var(--destructive)] ring-[color-mix(in_oklab,var(--destructive)_35%,transparent)]"
                  : "ring-foreground/10"
            }`}
          >
            {toast.kind === "success" && <CircleCheck className="size-4" aria-hidden />}
            {toast.message}
          </div>,
          document.body,
        )}
      {docxLoadingVisible && <DocxExportingOverlay />}
      {pendingDocxExport && (
        <DocxRemoteConfirmDialog
          pending={pendingDocxExport}
          onCancel={cancelDocxExport}
          onChoose={chooseDocxRemoteImages}
        />
      )}
      {docxReport && (
        <DocxReportDialog report={docxReport} onClose={() => setDocxReport(null)} />
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
        initialTab={settingsTab}
        onRebuildIndex={() => {
          void kb.rebuildIndex().then(() => showToast("索引已重建"));
        }}
        onCreateTemplateFromCurrent={() => void saveCurrentAsTemplate()}
      />
      {/* /ai 等未配置时先确认再进设置,避免选动作后生硬直跳 */}
      <Dialog open={aiSetupPromptOpen} onOpenChange={setAiSetupPromptOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>使用 AI 前需要先配置</DialogTitle>
            <DialogDescription>
              {settings.aiEnabled
                ? "还差一步:在设置里填好 API Key 并测试连接通过后,即可使用润色、续写等能力。砚知不中转、不代扣费。"
                : "AI 助手默认关闭。开启并完成连接测试后,即可在选区、右键与 /ai 中使用。砚知不中转、不代扣费。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAiSetupPromptOpen(false)}>
              稍后再说
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setAiSetupPromptOpen(false);
                openSettings("ai");
              }}
            >
              去配置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
