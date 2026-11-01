import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Copy, Eye, FolderOpen, LayoutTemplate, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { cn } from "@/lib/utils";
import { YanzhiEditor } from "@/editor/YanzhiEditor";
import { docToMarkdown } from "@/editor/markdown/serialize";
import { mdToHtml } from "@/editor/markdown/md-instance";
import { isTauriEnv, kbBackend } from "./backend";
import { TEMPLATE_SKELETONS, templateBadges, templateSummary, uniqueTemplateName } from "./templates";

/**
 * 模板工作台(PRD 7.5):设置页内嵌为主,新建选择器可弹 Dialog 复用。
 * 模板仍是 `.yanzhi/templates/*.md`;列表读出内容做摘要/结构标记,但文件真源不变。
 */

interface TemplateItem {
  name: string;
  content: string;
}

interface EditState {
  id: string;
  original: string | null;
  originalName: string;
  name: string;
  initial: string;
  content: string;
}

interface TemplateWorkbenchProps {
  root: string | null;
  onToast?: (message: string) => void;
  onChanged?: () => void;
  /** 设置窗独立于主窗:经事件请主窗把当前文档保存为模板 */
  onCreateFromCurrent?: () => void;
  confirmClose?: boolean;
  onConfirmClose?: (close: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onEditChange?: (editing: boolean) => void;
}

const INVALID_CHARS = /[\\/]|(\.\.)/;
const rootName = (root: string) => root.split("/").filter(Boolean).pop() ?? root;

export function TemplateWorkbench({
  root,
  onToast,
  onChanged,
  onCreateFromCurrent,
  confirmClose,
  onConfirmClose,
  onDirtyChange,
  onEditChange,
}: TemplateWorkbenchProps) {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  const refresh = useCallback(async () => {
    if (!root) {
      setTemplates([]);
      return;
    }
    try {
      const names = await kbBackend.listTemplates(root);
      setTemplates(
        await Promise.all(
          names.map(async (name) => ({
            name,
            content: await kbBackend.readTemplate(root, name).catch(() => ""),
          })),
        ),
      );
    } catch {
      setTemplates([]);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 主窗响应“从当前文档创建模板”后通知设置窗刷新;浏览器 mock 用 CustomEvent。
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("yz-templates-changed", handler);
    let unListen: (() => void) | undefined;
    if (isTauriEnv()) {
      void import("@tauri-apps/api/event").then(async ({ listen }) => {
        unListen = await listen("yz-templates-changed", handler);
      });
    }
    return () => {
      window.removeEventListener("yz-templates-changed", handler);
      unListen?.();
    };
  }, [refresh]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleTemplates = useMemo(
    () =>
      templates.filter(
        (item) =>
          !normalizedQuery ||
          item.name.toLocaleLowerCase().includes(normalizedQuery) ||
          item.content.toLocaleLowerCase().includes(normalizedQuery),
      ),
    [templates, normalizedQuery],
  );
  const dirty = !!edit && (edit.name !== edit.originalName || edit.content !== edit.initial);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onEditChange?.(!!edit);
  }, [edit, onEditChange]);

  const startCreate = (content = "", name = "") => {
    setConfirmingDelete(null);
    setConfirmCancel(false);
    setPreview(false);
    setEdit({
      id: `edit-${Date.now()}`,
      original: null,
      originalName: name,
      name,
      initial: content,
      content,
    });
  };

  const startEdit = (item: TemplateItem) => {
    setConfirmingDelete(null);
    setConfirmCancel(false);
    setPreview(false);
    setEdit({
      id: `edit-${Date.now()}`,
      original: item.name,
      originalName: item.name,
      name: item.name,
      initial: item.content,
      content: item.content,
    });
  };

  const latestContent = () => {
    const editor = editorRef.current;
    return editor && !editor.isDestroyed ? docToMarkdown(editor.state.doc) : (edit?.content ?? "");
  };

  const save = useCallback(
    async (stayOpen = true) => {
      if (!root || !edit) return;
      const name = edit.name.trim();
      const content = latestContent();
      if (!name) {
        onToast?.("模板名不能为空");
        return;
      }
      if (INVALID_CHARS.test(name)) {
        onToast?.("模板名不能包含 / \\ ..");
        return;
      }
      if (templates.some((item) => item.name === name) && name !== edit.original) {
        onToast?.(`已有同名模板:${name}`);
        return;
      }
      setBusy(true);
      try {
        await kbBackend.writeTemplate(root, name, content);
        if (edit.original !== null && name !== edit.original) {
          await kbBackend.deleteTemplate(root, edit.original);
        }
        setEdit({ ...edit, original: name, originalName: name, name, initial: content, content });
        await refresh();
        onChanged?.();
        onToast?.(`已保存模板「${name}」`);
        if (!stayOpen) setEdit(null);
      } catch {
        onToast?.("保存模板失败");
      } finally {
        setBusy(false);
      }
    },
    [edit, onChanged, onToast, refresh, root, templates],
  );

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!edit) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
        event.preventDefault();
        void saveRef.current(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [edit]);

  const createCopy = async (item: TemplateItem) => {
    if (!root) return;
    const name = uniqueTemplateName(
      templates.map((template) => template.name),
      `${item.name} 副本`,
    );
    setBusy(true);
    try {
      await kbBackend.writeTemplate(root, name, item.content);
      await refresh();
      onChanged?.();
      onToast?.(`已复制为「${name}」`);
    } catch {
      onToast?.("复制模板失败");
    } finally {
      setBusy(false);
    }
  };

  const createSkeleton = async (name: string, content: string) => {
    if (!root) return;
    const finalName = uniqueTemplateName(
      templates.map((template) => template.name),
      name,
    );
    setBusy(true);
    try {
      await kbBackend.writeTemplate(root, finalName, content);
      await refresh();
      onChanged?.();
      onToast?.(`已创建「${finalName}」`);
    } catch {
      onToast?.("创建模板失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (!root) return;
    setBusy(true);
    try {
      await kbBackend.deleteTemplate(root, name);
      setConfirmingDelete(null);
      await refresh();
      onChanged?.();
      onToast?.(`已删除「${name}」`);
    } catch {
      onToast?.("删除模板失败");
    } finally {
      setBusy(false);
    }
  };

  if (!root) {
    return (
      <div className="text-muted-foreground border-border-subtle rounded-lg border border-dashed p-8 text-center text-sm">
        未打开知识库,无法管理模板
      </div>
    );
  }

  if (edit) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <input
              aria-label="模板名称"
              className="border-border-subtle bg-raised focus:ring-ring h-9 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
              placeholder="模板名称"
              value={edit.name}
              onChange={(event) => setEdit({ ...edit, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void save(true);
                }
              }}
            />
            <p className="text-muted-foreground mt-1 text-[11px]">
              模板存于当前知识库 `.yanzhi/templates/`;首行 H1 在新建文档时会自动剥离
            </p>
          </div>
          <div className="bg-hover flex rounded-lg p-1" role="radiogroup" aria-label="模板查看方式">
            {(
              [
                { id: false, label: "编辑", icon: Pencil },
                { id: true, label: "预览", icon: Eye },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={preview === id}
                className={cn(
                  "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
                  preview === id ? "bg-raised text-foreground shadow-sm" : "text-muted-foreground",
                )}
                onClick={() => setPreview(id)}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-border-subtle bg-editor h-[min(24rem,48vh)] overflow-y-auto rounded-lg border">
          {preview ? (
            <div className="yz-editor-doc px-4 py-3" dangerouslySetInnerHTML={{ __html: mdToHtml(edit.content) }} />
          ) : (
            <YanzhiEditor
              key={edit.id}
              markdown={edit.initial}
              onReady={(editor) => {
                editorRef.current = editor;
              }}
              onMarkdownChange={(markdown) =>
                setEdit((current) => (current ? { ...current, content: markdown } : current))
              }
            />
          )}
        </div>

        {(confirmCancel || confirmClose) && (
          <div className="border-border-subtle bg-hover/50 rounded-lg border p-3 text-xs">
            <p className="font-medium">有未保存的模板修改,确定丢弃吗?</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setConfirmCancel(false);
                  onConfirmClose?.(false);
                }}
              >
                继续编辑
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  setEdit(null);
                  setConfirmCancel(false);
                  onConfirmClose?.(true);
                }}
              >
                丢弃修改
              </Button>
            </div>
          </div>
        )}

        {!confirmCancel && !confirmClose && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (dirty) setConfirmCancel(true);
                else setEdit(null);
              }}
            >
              {dirty ? "取消" : "返回列表"}
            </Button>
            <Button onClick={() => void save(true)} disabled={busy || !dirty}>
              <Save className="size-3.5" />
              {busy ? "保存中…" : dirty ? "保存" : "已保存"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-border-subtle bg-raised focus-within:border-ring flex h-9 min-w-52 flex-1 items-center gap-2 rounded-lg border px-2.5">
          <Search className="text-muted-foreground size-3.5 shrink-0" />
          <input
            aria-label="搜索模板"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称或内容…"
            className="placeholder:text-muted-foreground/60 h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </div>
        {onCreateFromCurrent && (
          <Button variant="outline" disabled={busy} onClick={onCreateFromCurrent}>
            <Copy className="size-3.5" />
            从当前文档保存
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void kbBackend.openTemplatesDir(root)}>
          <FolderOpen className="size-3.5" />
          打开文件夹
        </Button>
        <Button disabled={busy} onClick={() => startCreate()}>
          <Plus className="size-3.5" />
          新建模板
        </Button>
      </div>

      <div className="text-muted-foreground flex items-center gap-2 px-1 text-[11px]">
        <span className="text-foreground/70 font-medium">{rootName(root)}</span>
        <span>· {templates.length} 个模板</span>
        <span>· 模板是标准 Markdown 文件</span>
      </div>

      {templates.length === 0 ? (
        <div className="space-y-3">
          <div className="text-muted-foreground border-border-subtle rounded-lg border border-dashed p-5 text-center">
            <LayoutTemplate className="mx-auto mb-2 size-5 opacity-55" />
            <p className="text-sm">尚无模板</p>
            <p className="mt-1 text-xs">可以从常用骨架开始,也可以把当前文档保存为模板</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {TEMPLATE_SKELETONS.map((skeleton) => (
              <button
                key={skeleton.id}
                type="button"
                disabled={busy}
                className="border-border-subtle bg-raised/55 hover:border-primary/25 hover:bg-raised cursor-pointer rounded-lg border p-3 text-left transition-colors"
                onClick={() => void createSkeleton(skeleton.name, skeleton.content)}
              >
                <span className="text-foreground block text-xs font-medium">{skeleton.name}</span>
                <span className="text-muted-foreground mt-1 block text-[10px]">{skeleton.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : visibleTemplates.length === 0 ? (
        <p className="text-muted-foreground border-border-subtle rounded-lg border border-dashed py-8 text-center text-xs">
          没有匹配的模板
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {visibleTemplates.map((item) => {
            const badges = templateBadges(item.content);
            return (
              <article
                key={item.name}
                className="border-border-subtle bg-raised/55 flex min-h-28 flex-col rounded-lg border p-3 transition-colors hover:border-primary/20"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <span className="bg-selection text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                    <LayoutTemplate className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-xs font-medium">{item.name}</h3>
                    <p className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-4">
                      {templateSummary(item.content)}
                    </p>
                  </div>
                </div>

                {badges.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {badges.map((badge) => (
                      <span
                        key={badge.label}
                        className="bg-hover text-muted-foreground rounded-full px-1.5 text-[10px] leading-4"
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-auto flex flex-wrap justify-end gap-1 pt-3">
                  <Hint label={`编辑模板 ${item.name}`}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground size-7"
                      disabled={busy}
                      onClick={() => startEdit(item)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint label={`复制模板 ${item.name}`}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground size-7"
                      disabled={busy}
                      onClick={() => void createCopy(item)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </Hint>
                  <Hint label={`删除模板 ${item.name}`}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive size-7"
                      disabled={busy}
                      onClick={() => setConfirmingDelete(item.name)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </Hint>
                </div>

                {confirmingDelete === item.name && (
                  <div className="border-destructive/30 bg-destructive/5 mt-2 rounded-md border p-2 text-[11px]">
                    <p className="text-destructive font-medium">删除「{item.name}」?不可恢复。</p>
                    <div className="mt-1.5 flex justify-end gap-1">
                      <Button size="xs" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                        取消
                      </Button>
                      <Button size="xs" variant="destructive" onClick={() => void remove(item.name)}>
                        删除
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TemplateManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: string | null;
  onToast?: (message: string) => void;
  onChanged?: () => void;
}

export function TemplateManager({
  open,
  onOpenChange,
  root,
  onToast,
  onChanged,
}: TemplateManagerProps) {
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && dirty) {
          setConfirmClose(true);
          return;
        }
        if (!next) setEditing(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className={editing ? "sm:max-w-[720px]" : "sm:max-w-[560px]"}>
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">文档模板</DialogTitle>
          <DialogDescription>模板在新建文档时可选,也可以直接管理 .md 文件</DialogDescription>
        </DialogHeader>
        <TemplateWorkbench
          root={root}
          onToast={onToast}
          onChanged={onChanged}
          confirmClose={confirmClose}
          onConfirmClose={(close) => {
            setConfirmClose(false);
            if (close) {
              setEditing(false);
              onOpenChange(false);
            }
          }}
          onDirtyChange={setDirty}
          onEditChange={setEditing}
        />
      </DialogContent>
    </Dialog>
  );
}
