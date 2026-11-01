import { createPortal } from "react-dom";
import { FileText, FolderInput, PanelRight, Save, X } from "lucide-react";
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
import type { Editor } from "@tiptap/react";
import { YanzhiEditor } from "../editor/YanzhiEditor";
import { TocPanel } from "../editor/panel/TocPanel";
import { StatusBar } from "./StatusBar";
import type { ShortcutBindings } from "../shortcuts";
import { kbBackend } from "./backend";
import type { SingleFileWorkspace as SingleFileState } from "./useSingleFile";

interface SingleFileWorkspaceProps {
  single: SingleFileState;
  editor: Editor | null;
  onReady: (editor: Editor) => void;
  scrollRef: (el: HTMLDivElement | null) => void;
  scrollEl: HTMLDivElement | null;
  showToolbar: boolean;
  cardBorder: boolean;
  shortcuts: ShortcutBindings;
  focusMode: boolean;
  onToggleFocus: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
  onOpenFile: () => void;
  onCloseFile: () => void;
  onOpenKb: () => void;
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
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <section className="border-border-subtle bg-editor flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border shadow-[0_10px_32px_-20px_color-mix(in_oklab,var(--foreground)_25%,transparent)]">
            {!props.focusMode && (
              <header className="w-full shrink-0 px-6 pt-6 pb-3">
                <div className="mx-auto flex max-w-3xl flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="border-border-subtle bg-raised/60 text-muted-foreground flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]">
                      <FileText className="text-primary size-3.5 shrink-0" />
                      <span className="text-foreground/75 shrink-0 font-medium">单文件</span>
                      <span className="max-w-[420px] truncate" title={single.filePath ?? undefined}>
                        {single.fileDir}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Hint label="打开 Markdown 文件">
                        <Button variant="ghost" size="icon" className="size-7" onClick={props.onOpenFile}>
                          <FileText className="size-4" />
                        </Button>
                      </Hint>
                      <Hint label="打开知识库">
                        <Button variant="ghost" size="icon" className="size-7" onClick={props.onOpenKb}>
                          <FolderInput className="size-4" />
                        </Button>
                      </Hint>
                      <Hint label={props.outlineOpen ? "隐藏大纲" : "显示大纲"}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={props.outlineOpen ? "bg-selection text-foreground size-7" : "size-7"}
                          onClick={props.onToggleOutline}
                        >
                          <PanelRight className="size-4" />
                        </Button>
                      </Hint>
                    </div>
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <h1 className="min-w-0 truncate text-[2rem] leading-tight font-semibold tracking-[-0.035em]">
                      {single.fileStem || "未命名文档"}
                    </h1>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button variant="outline" size="sm" className="h-8" onClick={() => props.onSaveToKbOpenChange(true)}>
                        <FolderInput className="size-4" />
                        存入知识库
                      </Button>
                      <Button size="sm" className="h-8" disabled={single.saveState === "saving"} onClick={() => void single.save()}>
                        <Save className="size-4" />
                        保存
                      </Button>
                      <Button variant="outline" size="sm" className="h-8" onClick={() => void single.saveAs()}>
                        另存为
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8" onClick={props.onCloseFile}>
                        <X className="size-4" />
                        关闭
                      </Button>
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
              showToolbar={props.showToolbar && !props.focusMode}
              shortcuts={props.shortcuts}
            />
          </section>

          {!props.focusMode && props.outlineOpen && props.editor && (
            <aside
              aria-label="单文件大纲"
              className="border-border-subtle bg-sidebar flex w-[272px] shrink-0 flex-col overflow-hidden rounded-2xl border shadow-[0_10px_28px_-20px_color-mix(in_oklab,var(--foreground)_18%,transparent)]"
            >
              <TocPanel editor={props.editor} scrollContainer={props.scrollEl} />
            </aside>
          )}
        </div>
        <StatusBar
          editor={props.editor}
          kbRoot={single.filePath ?? ""}
          saveLabel={saveLabel}
          focusMode={props.focusMode}
          onToggleFocus={props.onToggleFocus}
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
