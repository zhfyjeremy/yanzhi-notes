import { createPortal } from "react-dom";
import {
  ChevronDown,
  Ellipsis,
  FileText,
  FolderInput,
  FolderOpen,
  FolderPlus,
  House,
  PanelLeft,
  Save,
  SaveAll,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { YanzhiEditor } from "../editor/YanzhiEditor";
import { EDITOR_COLUMN_MAX } from "../editor/layout";
import { TocPanel } from "../editor/panel/TocPanel";
import { StatusBar } from "./StatusBar";
import type { ShortcutBindings } from "../shortcuts";
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
  cardBorder: boolean;
  tableCellCopy: boolean;
  onToggleTableCellCopy: () => void;
  typewriterMode: boolean;
  onToggleTypewriter: () => void;
  shortcuts: ShortcutBindings;
  codeLanguageRecents: string[];
  onCodeLanguageUsed: (language: string) => void;
  aiReady: boolean;
  aiSession: import("../ai/useAiSession").AiSession;
  onNeedAiSettings: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onOpenFile: () => void;
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
  toast: string | null;
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
              <TocPanel editor={props.editor} scrollContainer={props.scrollEl} />
            </aside>
          )}

          <section className="shell-panel border-border-subtle bg-editor flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-[0_14px_40px_-22px_color-mix(in_oklab,var(--foreground)_32%,transparent)]">
            {!props.focusMode && (
              <header className="w-full shrink-0 px-6 pt-6 pb-3">
                {/* 两行即可:身份条 + 标题/主操作;低频动作收进「更多」 */}
                <div className={`mx-auto flex w-full ${EDITOR_COLUMN_MAX} flex-col gap-2.5`}>
                  <div className="flex min-w-0 items-center gap-2 text-[11px]">
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
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <span
                      className="text-muted-foreground min-w-0 flex-1 truncate"
                      title={single.filePath ?? undefined}
                    >
                      {single.filePath}
                    </span>
                  </div>

                  <div className="flex items-end gap-3">
                    <h1 className="min-w-0 flex-1 truncate text-[2rem] leading-tight font-semibold tracking-[-0.035em]">
                      {single.fileStem || "未命名文档"}
                    </h1>
                    <div className="mb-1 flex shrink-0 items-center gap-1">
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
                        {single.saveState === "dirty" ? "保存*" : "保存"}
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
                          <DropdownMenuItem onClick={() => props.onSaveToKbOpenChange(true)}>
                            <FolderInput className="size-4" />
                            存入知识库…
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={props.onCloseFile}>
                            <X className="size-4" />
                            关闭文件
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </header>
            )}

            <YanzhiEditor
              markdown={single.markdown}
              onMarkdownChange={single.onMarkdownChange}
              onReady={props.onReady}
              scrollContainerRef={props.scrollRef}
              onImageFiles={props.onImageFiles}
              onPickImage={props.onPickImage}
              onPickAttachment={props.onPickAttachment}
              onOpenAttachment={props.onOpenAttachment}
              cardBorder={props.cardBorder}
              tableCellCopy={props.tableCellCopy}
              onToggleTableCellCopy={props.onToggleTableCellCopy}
              showToolbar={props.showToolbar && !props.focusMode}
              typewriter={props.focusMode && props.typewriterMode}
              shortcuts={props.shortcuts}
              codeLanguageRecents={props.codeLanguageRecents}
              onCodeLanguageUsed={props.onCodeLanguageUsed}
              aiReady={props.aiReady}
              aiSession={props.aiSession}
              onNeedAiSettings={props.onNeedAiSettings}
            />
          </section>
        </div>
        <StatusBar
          editor={props.editor}
          kbRoot={single.filePath ?? ""}
          saveLabel={saveLabel}
          focusMode={props.focusMode}
          onToggleFocus={props.onToggleFocus}
          typewriterMode={props.typewriterMode}
          onToggleTypewriter={props.onToggleTypewriter}
          aiHost={props.aiSession.state.phase === "running" ? props.aiSession.state.host : null}
          onCancelAi={() => void props.aiSession.cancel()}
        />
      </main>

      <Dialog open={props.pending !== null} onOpenChange={(v) => !v && props.onCancelPending()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>未保存的单文件修改</DialogTitle>
            <DialogDescription>
              {props.pending?.nextWindow
                ? "关闭窗口前可以先保存、放弃修改,或继续编辑。"
                : props.pending?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={props.onCancelPending}>继续编辑</Button>
            <Button variant="outline" onClick={props.onDiscardPending}>不保存</Button>
            <Button onClick={props.onSavePending}>保存并继续</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={single.externalChange} onOpenChange={(v) => !v && void single.resolveExternal(true)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>文件在磁盘上已被修改</DialogTitle>
            <DialogDescription>「{single.fileName}」被其它程序修改,而当前编辑内容也有未保存变化。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => void single.resolveExternal(true)}>保留我的</Button>
            <Button onClick={() => void single.resolveExternal(false)}>载入磁盘版本</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={single.draft !== null} onOpenChange={(v) => !v && void single.discardDraft()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>发现未保存草稿</DialogTitle>
            <DialogDescription>上次编辑「{single.fileName}」时留下一份应用内草稿,尚未写回原文件。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => void single.discardDraft()}>使用磁盘版本</Button>
            <Button onClick={single.restoreDraft}>恢复草稿</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={props.assetsConfirmOpen} onOpenChange={(v) => !v && props.onRejectAssets()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>允许创建 assets 目录?</DialogTitle>
            <DialogDescription>
              单文件模式不会静默写盘。确认后,图片或附件会保存到「{single.fileDir || single.filePath}/assets/」,正文使用相对路径引用。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={props.onRejectAssets}>取消</Button>
            <Button onClick={props.onAllowAssets}>允许本次会话写入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={props.savedToKb !== null} onOpenChange={(v) => !v && props.onStayAfterSaveToKb()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>已存入知识库</DialogTitle>
            <DialogDescription>
              「{props.savedToKb?.rel}」已复制到所选知识库;原文件仍保留在原位置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={props.onStayAfterSaveToKb}>继续编辑单文件</Button>
            <Button onClick={() => props.savedToKb && props.onOpenSavedKb(props.savedToKb)}>
              {single.dirty ? "保存并打开知识库" : "打开知识库"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {props.toast &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            className="bg-popover text-popover-foreground pointer-events-none fixed bottom-10 left-1/2 z-[100] -translate-x-1/2 rounded-md px-3 py-1.5 text-sm shadow-md ring-1 ring-foreground/10"
          >
            {props.toast}
          </div>,
          document.body,
        )}
    </>
  );
}
