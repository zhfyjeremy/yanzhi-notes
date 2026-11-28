import { useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  CircleCheck,
  Ellipsis,
  FileClock,
  FilePlus,
  FileText,
  FileX,
  FolderCheck,
  FolderInput,
  FolderOpen,
  FolderPlus,
  House,
  ImagePlus,
  PanelLeft,
  Save,
  SaveAll,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SingleAssetCleanupDialog } from "./SingleAssetCleanupDialog";
import { Hint } from "@/components/hint";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Editor } from "@tiptap/react";
import type { MutableRefObject } from "react";
import { YanzhiEditor } from "../editor/YanzhiEditor";
import { SourceModeToggle } from "../editor/SourceModeToggle";
import { EDITOR_COLUMN_CLASS } from "../editor/layout";
import { TocPanel } from "../editor/panel/TocPanel";
import type { MarkdownSourceOutlineController } from "../editor/source-mode/MarkdownSourceEditor";
import { StatusBar } from "./StatusBar";
import type { ShortcutBindings } from "../shortcuts";
import type { CodeThemeId } from "../settings";
import { kbBackend } from "./backend";
import type { SingleFileWorkspace as SingleFileState } from "./useSingleFile";
import { cn } from "@/lib/utils";

const folderName = (root: string) => {
  const parts = root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
};

interface SingleFileWorkspaceProps {
  single: SingleFileState;
  editor: Editor | null;
  onReady: (editor: Editor) => void;
  scrollRef: (el: HTMLDivElement | null) => void;
  scrollEl: HTMLDivElement | null;
  showToolbar: boolean;
  sourceMode: boolean;
  onToggleSource: () => void;
  onSourceModeChange: (active: boolean) => void;
  sourceModeApiRef: MutableRefObject<((next: boolean) => void) | null>;
  tabIndentSize: number;
  cardBorder: boolean;
  codeTheme: CodeThemeId;
  tableCellCopy: boolean;
  onToggleTableCellCopy: () => void;
  typewriterMode: boolean;
  onToggleTypewriter: () => void;
  shortcuts: ShortcutBindings;
  codeLanguageRecents: string[];
  onCodeLanguageUsed: (language: string) => void;
  /** 导出当前文档(DOCX) */
  onExportDocx?: () => void;
  /** 导出当前文档(Markdown),与知识库模式右键菜单保持一致 */
  onExportMd?: () => void;
  /** 导出当前文档(离线 HTML),与知识库模式右键菜单保持一致 */
  onExportHtml?: () => void;
  onExportPdf?: () => void;
  aiReady: boolean;
  aiSession: import("../ai/useAiSession").AiSession;
  onNeedAiSettings: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onOpenFile: () => void;
  onNewFile: () => void;
  onCloseFile: () => void;
  onOpenKb: () => void;
  /** 返回欢迎页(关闭当前单文件,走未保存确认) */
  onBackHome: () => void;
  onNewKb: () => void;
  /** 打开最近知识库(路径已知,不走选文件夹) */
  onOpenRecentKb: (root: string) => void;
  onImageFiles: (files: File[]) => Promise<string[]>;
  onPickImage: () => Promise<string[] | null>;
  onPickAttachment: () => Promise<{ name: string; href: string }[] | null>;
  onOpenAttachment: (href: string) => void;
  toast: { message: string; kind: "info" | "success" | "error" } | null;
  pending: { description: string; nextWindow?: boolean } | null;
  onCancelPending: () => void;
  onSavePending: () => void;
  onDiscardPending: () => void;
  assetsConfirmOpen: boolean;
  onAllowAssets: () => void;
  onRejectAssets: () => void;
  saveToKbOpen: boolean;
  onSaveToKbOpenChange: (open: boolean) => void;
  recentRoots: string[];
  onSaveToKb: (root: string) => void;
  savedToKb: { root: string; rel: string } | null;
  onStayAfterSaveToKb: () => void;
  onOpenSavedKb: (info: { root: string; rel: string }) => void;
}

export function SingleFileWorkspace(props: SingleFileWorkspaceProps) {
  const { single } = props;
  const [cleanupOpen, setCleanupOpen] = useState(false);
  // 源码态大纲:PM 树只是隐藏镜像,标题/定位必须走 CodeMirror 侧控制器(知识库模式同口径)
  const [sourceOutlineController, setSourceOutlineController] =
    useState<MarkdownSourceOutlineController | null>(null);
  // 标题与正文同滚动列(语雀式);单文件无文档图标,重命名仍走「另存为」
  const singleDocHeader = (
    <h1 className="min-w-0 truncate text-3xl leading-snug font-semibold tracking-[-0.03em]">
      {single.fileStem || "未命名文档"}
    </h1>
  );
  const saveLabel =
    single.saveState === "saving"
      ? "保存中…"
      : single.saveState === "dirty"
        ? "未保存"
        : single.saveState === "error"
          ? single.missing
            ? "文件已丢失"
            : "保存失败"
          : single.savedAt
            ? `已保存 ${single.savedAt}`
            : "就绪";

  return (
    <>
      <main className="app-shell bg-workspace text-foreground flex h-screen flex-col">
        <div className="shell-main flex min-h-0 flex-1 gap-3 px-3 pt-2 pb-3">
          {/* 单文件无目录树:大纲放左侧占导航位,比右栏更贴「先结构后正文」 */}
          {!props.focusMode && props.outlineOpen && props.editor && (
            <aside
              aria-label="单文件大纲"
              className="shell-panel border-border-subtle bg-sidebar flex w-[240px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-[0_10px_28px_-20px_color-mix(in_oklab,var(--foreground)_18%,transparent)]"
            >
              <TocPanel
                editor={props.editor}
                scrollContainer={props.scrollEl}
                sourceOutlineController={sourceOutlineController}
              />
            </aside>
          )}

          <section className="shell-panel border-border-subtle bg-editor flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-[0_14px_40px_-22px_color-mix(in_oklab,var(--foreground)_32%,transparent)]">
            {!props.focusMode && (
              <header className="w-full shrink-0 px-6 pt-4 pb-3">
                {/* 单行:身份条/源码切换 + 主操作;低频动作收进「更多」。
                    标题已移入正文同一滚动列(docHeader),与知识库编辑区同布局。 */}
                <div className={`mx-auto flex w-full ${EDITOR_COLUMN_CLASS} items-center gap-3 px-16`}>
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px]">
                    {/* 工作区切换唯一入口:含最近库直开(原右上「打开知识库 ▾」并入此处) */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="bg-selection text-primary hover:bg-selection/80 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-colors outline-none"
                        >
                          <FileText className="size-3" />
                          单文件
                          <ChevronDown className="size-3 opacity-70" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-52">
                        <DropdownMenuItem onClick={props.onBackHome}>
                          <House className="size-4" />
                          返回欢迎页
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {props.recentRoots.length > 0 ? (
                          <>
                            <DropdownMenuLabel className="text-muted-foreground text-[10px] font-normal">
                              最近知识库
                            </DropdownMenuLabel>
                            {props.recentRoots.slice(0, 5).map((root) => (
                              <DropdownMenuItem
                                key={root}
                                title={root}
                                onClick={() => props.onOpenRecentKb(root)}
                              >
                                <FolderOpen className="size-4" />
                                <span className="min-w-0 truncate">{folderName(root)}</span>
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem onClick={props.onOpenKb}>
                              <FolderOpen className="size-4" />
                              浏览其它位置…
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem onClick={props.onOpenKb}>
                            <FolderOpen className="size-4" />
                            打开知识库…
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={props.onNewKb}>
                          <FolderPlus className="size-4" />
                          新建知识库…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={props.onOpenFile}>
                          <FileText className="size-4" />
                          打开其它文件…
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={props.onNewFile}>
                          <FilePlus className="size-4" />
                          新建 Markdown 文件…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <span
                      className={cn(
                        "text-muted-foreground min-w-0 flex-1 truncate",
                        !single.filePath && "opacity-75",
                      )}
                      title={single.filePath ?? "尚未保存到磁盘;按 ⌘/Ctrl+S 选择存储位置"}
                    >
                      {single.filePath || "尚未保存到磁盘"}
                    </span>
                    <SourceModeToggle active={props.sourceMode} onToggle={props.onToggleSource} />
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                      <Hint label={props.outlineOpen ? "隐藏大纲" : "显示大纲"}>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-pressed={props.outlineOpen}
                          className={cn(
                            "size-8",
                            props.outlineOpen && "bg-selection text-foreground",
                          )}
                          onClick={props.onToggleOutline}
                        >
                          <PanelLeft className="size-4" />
                        </Button>
                      </Hint>
                      <Button
                        size="sm"
                        className="h-8 px-3"
                        disabled={single.saveState === "saving"}
                        onClick={() => void single.save()}
                      >
                        <Save className="size-3.5" />
                        {single.untitled ? "保存…" : single.saveState === "dirty" ? "保存*" : "保存"}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="size-8"
                            aria-label="更多操作"
                          >
                            <Ellipsis className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem onClick={() => void single.saveAs()}>
                            <SaveAll className="size-4" />
                            另存为…
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!single.filePath}
                            title={single.filePath ? undefined : "请先保存文件,再存入知识库"}
                            onClick={() => props.onSaveToKbOpenChange(true)}
                          >
                            <FolderInput className="size-4" />
                            存入知识库…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={!single.filePath}
                            title={single.filePath ? undefined : "请先保存文件"}
                            onClick={() => setCleanupOpen(true)}
                          >
                            <Trash2 className="size-4" />
                            清理未引用图片…
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={props.onCloseFile}>
                            <X className="size-4" />
                            关闭文件
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                  </div>
                </div>
              </header>
            )}

            {/* 文件被删除/移动:非阻塞提示条(外部改动/草稿仍是弹窗,这种持续状态用条更合适) */}
            {single.missing && (
              <div className="px-6 pb-2">
                <div className="border-destructive/25 bg-destructive/5 text-destructive mx-auto flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-xs">
                  <FileX className="size-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    「{single.fileStem || "文件"}」已被删除或移动,编辑内容仍保留在这里;另存为新位置即可继续。
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:text-destructive h-7 shrink-0"
                    onClick={() => void single.saveAs()}
                  >
                    <SaveAll className="size-3.5" />
                    另存为…
                  </Button>
                </div>
              </div>
            )}

            <YanzhiEditor
              markdown={single.markdown}
              onMarkdownChange={single.onMarkdownChange}
              onReady={props.onReady}
              scrollContainerRef={props.scrollRef}
              docHeader={singleDocHeader}
              onImageFiles={props.onImageFiles}
              onPickImage={props.onPickImage}
              onPickAttachment={props.onPickAttachment}
              onOpenAttachment={props.onOpenAttachment}
              cardBorder={props.cardBorder}
              codeTheme={props.codeTheme}
              tableCellCopy={props.tableCellCopy}
              onToggleTableCellCopy={props.onToggleTableCellCopy}
              showToolbar={props.showToolbar && !props.focusMode}
              sourceModeApiRef={props.sourceModeApiRef}
              onSourceOutlineController={setSourceOutlineController}
              onSourceModeChange={props.onSourceModeChange}
              tabIndentSize={props.tabIndentSize}
              typewriter={props.focusMode && props.typewriterMode}
              shortcuts={props.shortcuts}
              codeLanguageRecents={props.codeLanguageRecents}
              onCodeLanguageUsed={props.onCodeLanguageUsed}
              onExportMd={props.onExportMd}
              onExportHtml={props.onExportHtml}
              onExportDocx={props.onExportDocx}
              onExportPdf={props.onExportPdf}
              aiReady={props.aiReady}
              aiSession={props.aiSession}
              onNeedAiSettings={props.onNeedAiSettings}
            />
          </section>
        </div>
        <StatusBar
          editor={props.editor}
          saveLabel={saveLabel}
          focusMode={props.focusMode}
          onToggleFocus={props.onToggleFocus}
          typewriterMode={props.typewriterMode}
          onToggleTypewriter={props.onToggleTypewriter}
          aiHost={props.aiSession.state.phase === "running" ? props.aiSession.state.host : null}
          onCancelAi={() => void props.aiSession.cancel()}
          sourceMode={props.sourceMode}
          onToggleSource={props.onToggleSource}
        />
      </main>

      <ConfirmDialog
        open={props.pending !== null}
        onOpenChange={(v) => !v && props.onCancelPending()}
        tone="warning"
        icon={<Save className="size-5" aria-hidden="true" />}
        title="未保存的单文件修改"
        description={
          props.pending?.nextWindow
            ? "关闭窗口前可以先保存、放弃修改，或继续编辑。"
            : props.pending?.description
        }
        footer={
          <>
            <Button variant="ghost" onClick={props.onCancelPending}>继续编辑</Button>
            <Button variant="outline" onClick={props.onDiscardPending}>不保存</Button>
            <Button onClick={props.onSavePending}>保存并继续</Button>
          </>
        }
      />

      <ConfirmDialog
        open={single.externalChange}
        onOpenChange={(v) => !v && void single.resolveExternal(true)}
        tone="warning"
        icon={<FileX className="size-5" aria-hidden="true" />}
        title="文件在磁盘上已被修改"
        description={`「${single.fileName}」被其它程序修改，而当前编辑内容也有未保存变化。`}
        footer={
          <>
            <Button variant="ghost" onClick={() => void single.resolveExternal(true)}>保留我的</Button>
            <Button onClick={() => void single.resolveExternal(false)}>载入磁盘版本</Button>
          </>
        }
      />

      <ConfirmDialog
        open={single.draft !== null}
        onOpenChange={(v) => !v && void single.discardDraft()}
        tone="info"
        icon={<FileClock className="size-5" aria-hidden="true" />}
        title="发现未保存草稿"
        description={`上次编辑「${single.fileName}」时留下一份应用内草稿，尚未写回原文件。`}
        footer={
          <>
            <Button variant="ghost" onClick={() => void single.discardDraft()}>使用磁盘版本</Button>
            <Button onClick={single.restoreDraft}>恢复草稿</Button>
          </>
        }
      />

      <ConfirmDialog
        open={props.assetsConfirmOpen}
        onOpenChange={(v) => !v && props.onRejectAssets()}
        tone="warning"
        icon={<ImagePlus className="size-5" aria-hidden="true" />}
        title="允许创建 assets 目录?"
        description={`单文件模式不会静默写盘。确认后，图片或附件会保存到文件旁的「${single.fileStem || "未命名"}.assets/」文件夹，正文使用相对路径引用。`}
        className="sm:max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={props.onRejectAssets}>取消</Button>
            <Button onClick={props.onAllowAssets}>允许本次会话写入</Button>
          </>
        }
      />

      <SingleAssetCleanupDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        folderName={`${single.fileStem || "未命名"}.assets`}
        listUnused={single.listUnreferencedAssets}
        remove={single.deleteUnreferencedAssets}
      />

      <Dialog open={props.saveToKbOpen} onOpenChange={props.onSaveToKbOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>存入知识库</DialogTitle>
            <DialogDescription>当前文件和引用的本地资源会被复制到所选知识库;原文件不会被移动或修改。</DialogDescription>
          </DialogHeader>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {props.recentRoots.slice(0, 5).map((root) => (
              <button
                key={root}
                type="button"
                className="border-border-subtle bg-raised/55 hover:bg-raised flex w-full cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-colors"
                onClick={() => props.onSaveToKb(root)}
              >
                <FolderInput className="text-primary size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{root}</span>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => props.onSaveToKbOpenChange(false)}>取消</Button>
            <Button
              onClick={() => {
                void kbBackend.pickFolder().then((root) => {
                  if (root) props.onSaveToKb(root);
                });
              }}
            >
              选择其它知识库
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={props.savedToKb !== null}
        onOpenChange={(v) => !v && props.onStayAfterSaveToKb()}
        tone="success"
        icon={<FolderCheck className="size-5" aria-hidden="true" />}
        title="已存入知识库"
        description={`「${props.savedToKb?.rel}」已复制到所选知识库；原文件仍保留在原位置。`}
        className="sm:max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={props.onStayAfterSaveToKb}>继续编辑单文件</Button>
            <Button onClick={() => props.savedToKb && props.onOpenSavedKb(props.savedToKb)}>
              {single.dirty ? "保存并打开知识库" : "打开知识库"}
            </Button>
          </>
        }
      />

      {props.toast &&
        createPortal(
          <div
            role={props.toast.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            className={`bg-popover text-popover-foreground pointer-events-none fixed bottom-10 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-md px-3 py-1.5 text-sm shadow-md ring-1 ${
              props.toast.kind === "success"
                ? "text-[var(--callout-success)] ring-[color-mix(in_oklab,var(--callout-success)_35%,transparent)]"
                : props.toast.kind === "error"
                  ? "text-[var(--destructive)] ring-[color-mix(in_oklab,var(--destructive)_35%,transparent)]"
                  : "ring-foreground/10"
            }`}
          >
            {props.toast.kind === "success" && <CircleCheck className="size-4" aria-hidden />}
            {props.toast.message}
          </div>,
          document.body,
        )}
    </>
  );
}
