/**
 * 模板管理(PRD 7.5,应用内):模板列表 + 新建/编辑/删除,编辑内嵌正式
 * YanzhiEditor(md 进 md 出,方言卡片可直接写进模板)。
 * 存储仍是 `.yanzhi/templates/*.md`(文件即模板,文件管理器里增删同样生效,
 * 本组件只是把高频路径搬进砚知);模板不是正文,删除不进回收站。
 * 入口:设置 → 通用「管理模板…」+ 新建文档选择器底部。
 */

import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { YanzhiEditor } from "@/editor/YanzhiEditor";
import { kbBackend } from "./backend";

/** 编辑态:null = 列表态;original = null 表示新建 */
interface EditState {
  /** 进入编辑时的名字(改名保存 = 写新名 + 删旧文件) */
  original: string | null;
  name: string;
  /** markdown prop 冻结初值:YanzhiEditor 靠 prop 变化重载,编辑期间不能回灌 */
  initial: string;
  /** 最新内容(onMarkdownChange 维护,保存时读取) */
  content: string;
}

interface TemplateManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  root: string | null;
  onToast?: (msg: string) => void;
  /** 增删改后通知(主窗刷新新建选择器列表) */
  onChanged?: () => void;
}

const INVALID_CHARS = /[\\/]|(\.\.)/;

export function TemplateManager({ open, onOpenChange, root, onToast, onChanged }: TemplateManagerProps) {
  const [names, setNames] = useState<string[]>([]);
  const [edit, setEdit] = useState<EditState | null>(null);
  /** 待二次确认删除的模板名 */
  const [confirmingDel, setConfirmingDel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      setNames(await kbBackend.listTemplates(root));
    } catch {
      setNames([]);
    }
  }, [root]);

  useEffect(() => {
    if (open) {
      setEdit(null);
      setConfirmingDel(null);
      void refresh();
    }
  }, [open, refresh]);

  const startCreate = () => {
    setEdit({ original: null, name: "", initial: "", content: "" });
  };

  const startEdit = async (name: string) => {
    if (!root) return;
    try {
      const content = await kbBackend.readTemplate(root, name);
      setEdit({ original: name, name, initial: content, content });
    } catch {
      onToast?.("读取模板失败");
    }
  };

  const save = async () => {
    if (!root || !edit) return;
    const name = edit.name.trim();
    if (!name) {
      onToast?.("模板名不能为空");
      return;
    }
    if (INVALID_CHARS.test(name)) {
      onToast?.("模板名不能包含 / \\ ..");
      return;
    }
    if (names.includes(name) && name !== edit.original) {
      onToast?.(`已有同名模板:${name}`);
      return;
    }
    setBusy(true);
    try {
      await kbBackend.writeTemplate(root, name, edit.content);
      if (edit.original !== null && name !== edit.original) {
        await kbBackend.deleteTemplate(root, edit.original); // 改名另存
      }
      setEdit(null);
      await refresh();
      onChanged?.();
    } catch {
      onToast?.("保存模板失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (!root) return;
    setBusy(true);
    try {
      await kbBackend.deleteTemplate(root, name);
      setConfirmingDel(null);
      await refresh();
      onChanged?.();
    } catch {
      onToast?.("删除模板失败");
    } finally {
      setBusy(false);
    }
  };

  const titleClass = "text-sm font-medium";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={edit ? "max-w-2xl" : "max-w-sm"}>
        {edit ? (
          <>
            <DialogHeader>
              <DialogTitle className={titleClass}>{edit.original ? "编辑模板" : "新建模板"}</DialogTitle>
              <DialogDescription>
                首行写 `# 标题` 可命名模板;用它新建文档时会自动剥离(标题由文档名承担)
              </DialogDescription>
            </DialogHeader>
            <input
              aria-label="模板名称"
              className="border-border bg-background focus:ring-ring h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
              placeholder="模板名称"
              value={edit.name}
              autoFocus
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            <div className="border-border h-72 overflow-y-auto rounded-lg border">
              {/* key 冻结实例:编辑期间 markdown prop 不回灌(与主窗编辑器同一约束) */}
              <YanzhiEditor
                key={edit.original ?? "__new__"}
                markdown={edit.initial}
                onMarkdownChange={(md) => setEdit((s) => (s ? { ...s, content: md } : s))}
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEdit(null)} disabled={busy}>
                取消
              </Button>
              <Button onClick={() => void save()} disabled={busy}>
                保存
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className={titleClass}>文档模板</DialogTitle>
              <DialogDescription>模板在新建文档时可选;也可在 .yanzhi/templates 文件夹直接管理</DialogDescription>
            </DialogHeader>
            {names.length ? (
              <div role="listbox" aria-label="模板列表" className="border-border max-h-72 overflow-y-auto rounded-lg border">
                {names.map((n) => (
                  <div
                    key={n}
                    role="option"
                    aria-selected={false}
                    className="hover:bg-accent/50 flex items-center gap-2.5 px-3 py-2 text-sm"
                  >
                    <LayoutTemplate className="text-muted-foreground size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{n}</span>
                    <Hint label={`编辑模板 ${n}`}>
                      <button
                        type="button"
                        className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md"
                        onClick={() => void startEdit(n)}
                      >
                        <Pencil size={13} />
                      </button>
                    </Hint>
                    {confirmingDel === n ? (
                      <button
                        type="button"
                        aria-label={`确认删除模板 ${n}`}
                        className="bg-destructive text-destructive-foreground rounded-md px-2 py-1 text-xs"
                        disabled={busy}
                        onClick={() => void remove(n)}
                      >
                        确认删除
                      </button>
                    ) : (
                      <Hint label={`删除模板 ${n}`}>
                        <button
                          type="button"
                          className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md"
                          onClick={() => setConfirmingDel(n)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </Hint>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground py-6 text-center text-sm">
                尚无模板,新建一个——比如会议纪要、周报骨架
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={startCreate}>
                <Plus className="size-4" /> 新建模板
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
