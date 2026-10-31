import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { StatusBar } from "./kb/StatusBar";
import { TrashDialog } from "./kb/TrashDialog";
import { OrphanMetaDialog } from "./kb/OrphanMetaDialog";
import { SettingsDialog } from "./kb/SettingsDialog";
import { compressImageFile, isImageFile } from "./kb/image-compress";
import { useSettings } from "./settings";
import { WelcomePage } from "./kb/WelcomePage";
import { useKb } from "./kb/useKb";
import { isTauriEnv } from "./kb/backend";
import { setAssetResolver } from "./kb/asset-src";
import { buildExportHtml } from "./kb/export-html";
import { flattenDocs, wikiTargetFor } from "./kb/wiki-refs";
import type { HistoryEntry } from "./kb/types";
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

function App() {
  const { settings, update: updateSettings } = useSettings();
  const kb = useKb(settings);
  const [editor, setEditor] = useState<Editor | null>(null);
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

  // 原生菜单(5.0.4-2):Rust 侧建菜单并发 kb-menu 事件。
  // 非空/已是砚知库的确认走 App 级弹窗(欢迎页按钮触发时仍用页内确认卡,两条路只走一条)
  const [menuPending, setMenuPending] = useState<{ root: string; yanzhi: boolean } | null>(null);
  useEffect(() => {
    if (!isTauriEnv()) return;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      un = await listen<{ action: string; root?: string; key?: string; value?: boolean }>("kb-menu", (e) => {
        void (async () => {
          const { action, root, key, value } = e.payload;
          if (action === "new") {
            const r = await kb.pickAndCreate();
            if (r?.kind === "not-empty") setMenuPending({ root: r.root, yanzhi: false });
            else if (r?.kind === "is-yanzhi") setMenuPending({ root: r.root, yanzhi: true });
            else if (r?.kind === "error") showToast(r.message);
          } else if (action === "open") {
            const err = await kb.pickAndOpen();
            if (err) showToast(err);
          } else if (action === "open-recent" && root) {
            const err = await kb.openKbAt(root);
            if (err) showToast(err);
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
          } else if (action === "view" && key && typeof value === "boolean") {
            // 显示菜单勾选项:目标值由 Rust 算好(!当前镜像),前端照单应用
            if (key === "panel") updateSettings({ showRightPanel: value });
            else if (key === "toolbar") updateSettings({ showToolbar: value });
            else if (key === "focus") setFocusMode(value);
          }
        })();
      });
    })();
    return () => un?.();
  }, [kb.pickAndCreate, kb.pickAndOpen, kb.openKbAt, openSettings, updateSettings, showToast]);

  // 显示菜单勾选态回写(状态源在前端:面板/工具栏持久化在 settings,专注模式会话级)
  useEffect(() => {
    if (!isTauriEnv() || !kb.booted) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("set_view_state", {
        panel: settings.showRightPanel,
        toolbar: settings.showToolbar,
        focus: focusMode,
      }).catch(console.error),
    );
  }, [kb.booted, settings.showRightPanel, settings.showToolbar, focusMode]);

  // 设置窗的「重建索引」动到主窗 KB 状态,经事件桥回来执行
  useEffect(() => {
    if (!isTauriEnv()) return;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      un = await listen<{ action: string }>("yz-settings-action", (e) => {
        if (e.payload?.action === "rebuild") {
          void kb.rebuildIndex().then(() => showToast("索引已重建"));
        }
      });
    })();
    return () => un?.();
  }, [kb.rebuildIndex, showToast]);

  // 专注模式:⌘/Ctrl+Shift+F 切换;双链历史:⌘[/⌘] 或 Alt+←/→
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFocusMode((v) => !v);
        return;
      }
      if (mod && !e.shiftKey && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        void kb.navBack();
        return;
      }
      if (mod && !e.shiftKey && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        void kb.navForward();
        return;
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        void kb.navBack();
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        void kb.navForward();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kb.navBack, kb.navForward]);

  const handleReady = useCallback((e: Editor) => setEditor(e), []);
  const handleScrollRef = useCallback((el: HTMLDivElement | null) => setScrollEl(el), []);

  // 图片 src 渲染解析注册(layout effect 先于子组件 passive effect 的 setContent,
  // 文档切换时新图片挂载前 resolver 已指向新文档;无库时置空回落原样返回)
  useLayoutEffect(() => {
    setAssetResolver(kb.kbRoot ? kb.assetSrcResolver : null);
  }, [kb.kbRoot, kb.assetSrcResolver, kb.currentPath]);

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
  useEffect(() => {
    setTitle(currentPath ? docBasename(currentPath) : "");
  }, [currentPath]);

  // 打开失败(文件被外部删除/权限):明确反馈,不静默(M4 异常恢复)
  useEffect(() => {
    if (kb.docError) showToast(`无法打开「${docBasename(kb.docError)}」:文件不存在或无法读取`);
  }, [kb.docError, showToast]);

  // 反向链接(5.4-2):refsVersion 在保存/删除/回收站变动时递增,驱动面板重算
  const backlinks = useMemo(
    () => kb.getBacklinks(kb.currentPath),
    [kb.currentPath, kb.refsVersion, kb.tree, kb.getBacklinks],
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
      const imgs = dt ? Array.from(dt.files).filter(isImageFile) : [];
      if (!imgs.length) return;
      const r = scrollEl?.getBoundingClientRect();
      const hit =
        !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      // 坐标异常(0,0,WKWebView 合成事件形态)也放行:PM 没接住 + 有图片文件
      if (hit || (e.clientX === 0 && e.clientY === 0)) void onImageFiles(imgs);
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, [scrollEl, onImageFiles]);

  /* ---- 导入导出(5.6) ---- */
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

  if (!kb.booted) {
    return <main className="bg-background flex h-screen items-center justify-center" />;
  }

  if (!kb.kbRoot) {
    return (
      <WelcomePage
        recent={kb.recent.recent}
        bootError={kb.bootError}
        onPickCreate={kb.pickAndCreate}
        onForceCreate={(root) => kb.createKbAt(root, true)}
        onPickOpen={kb.pickAndOpen}
        onOpenRecent={kb.openKbAt}
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
    <main className="bg-background text-foreground flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        {!focusMode && (
          <DocTree
            root={kb.kbRoot}
            tree={kb.tree}
            currentPath={kb.currentPath}
            collapsed={kb.collapsed}
            indexReady={kb.indexReady}
            onToggleCollapse={kb.toggleCollapse}
            onOpenDoc={(rel) => void kb.openDoc(rel)}
            onCreateDoc={(folder, name) => void kb.createDoc(folder, name)}
            onCreateFolder={(folder, name) => void kb.createFolder(folder, name)}
            onRenameEntry={(rel, name) => void renameWithToast(rel, name)}
            onRemoveEntry={(rel) => void kb.removeEntry(rel)}
            onReorder={kb.persistSiblingOrder}
            onMoveEntry={(src, dest, ordered) => void moveWithToast(src, dest, ordered)}
            onSearch={kb.search}
            onSearchSelect={onSearchSelect}
            searchPreset={searchPreset}
            onRebuildIndex={() => void kb.rebuildIndex()}
            onOpenSettings={() => openSettings()}
            onOpenTrash={() => setTrashOpen(true)}
            orphanCount={kb.orphanMeta.length}
            onOpenOrphans={() => setOrphansOpen(true)}
            onImportDocs={onImportDocs}
            onExportMd={onExportMd}
            onExportHtml={onExportHtml}
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          {currentPath ? (
            /* 专注模式:导航按钮收起(纯 chrome,⌘[ ⌘] 仍可用),标题与正文同列对齐
             * (mx-auto max-w-3xl px-16,同 EditorContent 容器);常态:按钮 + 标题一行 */
            <div className="w-full shrink-0 px-6 pt-6 pb-2">
              {focusMode ? (
                <div className="mx-auto max-w-3xl px-16">
                  <input
                    className="bg-background w-full pb-1 text-3xl font-bold outline-none placeholder:text-muted-foreground/50"
                    value={title}
                    onChange={(e) => onTitleChange(e.target.value)}
                    placeholder="未命名文档"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="mb-1 flex items-center gap-0.5">
                    <Hint label="后退 (⌘[ / Alt+←)">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-7"
                        disabled={!kb.canBack}
                        onClick={() => void kb.navBack()}
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                    </Hint>
                    <Hint label="前进 (⌘] / Alt+→)">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground size-7"
                        disabled={!kb.canFront}
                        onClick={() => void kb.navForward()}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </Hint>
                  </div>
                  <input
                    className="bg-background min-w-0 flex-1 px-10 pb-1 text-3xl font-bold outline-none placeholder:text-muted-foreground/50"
                    value={title}
                    onChange={(e) => onTitleChange(e.target.value)}
                    placeholder="未命名文档"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="h-[76px] shrink-0" />
          )}
          <YanzhiEditor
            markdown={kb.markdown}
            onReady={handleReady}
            scrollContainerRef={handleScrollRef}
            onMarkdownChange={kb.onMarkdownChange}
            wikiDocs={getWikiDocs}
            onOpenWikiLink={onOpenWikiLink}
            onImageFiles={onImageFiles}
            onPickImage={onPickImage}
            locateSignal={locateSignal}
            cardBorder={settings.cardBorder}
            showToolbar={settings.showToolbar && !focusMode}
          />
        </div>
        {!focusMode && settings.showRightPanel && editor && (
          <aside className="bg-muted/40 flex w-60 shrink-0 flex-col">
            <TocPanel editor={editor} scrollContainer={scrollEl} />
            <BacklinksPanel
              rows={backlinks}
              onOpenSource={(rel) => {
                // 跳到来源文档并高亮其内的引用写法(裸名最常见,作定位词)
                if (kb.currentPath) onSearchSelect(rel, docBasename(kb.currentPath));
              }}
              onOpenTrash={() => setTrashOpen(true)}
            />
            <HistoryPanel
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
            />
          </aside>
        )}
      </div>
      <StatusBar
        editor={editor}
        kbRoot={kb.kbRoot}
        saveLabel={saveLabel}
        focusMode={focusMode}
        onToggleFocus={() => setFocusMode((v) => !v)}
        orphanCount={kb.orphanMeta.length}
        onOpenOrphans={() => setOrphansOpen(true)}
      />
      {toast && (
        <div className="bg-popover text-popover-foreground pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-md px-3 py-1.5 text-sm shadow-md ring-1 ring-foreground/10">
          {toast}
        </div>
      )}
      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        listTrash={kb.listTrash}
        restoreTrash={kb.restoreTrash}
        purgeTrash={kb.purgeTrash}
        emptyTrash={kb.emptyTrash}
        onToast={showToast}
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
        onDiscard={(entry) => {
          kb.discardOrphan(entry);
          showToast(`已丢弃「${entry.path}」的偏好记录`);
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
