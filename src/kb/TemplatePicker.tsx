/**
 * 新建文档模板选择器(PRD 7.5,语雀式):知识库存在模板(.yanzhi/templates/*.md)
 * 时,「新建文档」先经此弹窗——输入文档名 + 选「空白文档」或某模板;
 * 无模板时上游直接建空文档,本组件不出现(零打扰)。
 * 模板管理入口:设置 → 模板;此处保留「管理模板…」便于创建时顺手调整。
 */

import { useEffect, useState } from "react";
import { FileText, LayoutTemplate } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BLANK = "__blank__";

interface TemplatePickerProps {
  open: boolean;
  defaultName: string;
  templates: string[];
  onCancel: () => void;
  /** template = null 表示空白文档;名称由本组件输入框给出 */
  onConfirm: (name: string, template: string | null) => void;
  /** 打开模板管理(新建时发现没有想要的模板,顺手建一个) */
  onManage?: () => void;
}

export function TemplatePicker({ open, defaultName, templates, onCancel, onConfirm, onManage }: TemplatePickerProps) {
  const [name, setName] = useState(defaultName);
  const [selected, setSelected] = useState<string>(BLANK);

  // 每次打开重置:回到默认名 + 空白文档(新建的大多数场景)
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setSelected(BLANK);
    }
  }, [open, defaultName]);

  const confirm = () => {
    const trimmed = name.trim();
    onConfirm(trimmed || defaultName, selected === BLANK ? null : selected);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>新建文档</DialogTitle>
          <DialogDescription>从模板创建,或选择空白文档</DialogDescription>
        </DialogHeader>
        <input
          aria-label="文档名称"
          className="border-border bg-background focus:ring-ring h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2"
          value={name}
          placeholder="文档名称"
          // 打开即选中默认名,直接输入即覆盖
          ref={(el) => {
            if (el) el.select();
          }}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirm();
            }
          }}
        />
        <div role="listbox" aria-label="模板" className="max-h-64 space-y-1.5 overflow-y-auto">
          <button
            type="button"
            role="option"
            aria-selected={selected === BLANK}
            className={cn(
              "border-border-subtle bg-raised/55 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
              selected === BLANK
                ? "bg-selection border-primary/25 ring-primary/10 text-foreground ring-1"
                : "hover:border-primary/20 text-foreground/90",
            )}
            onClick={() => setSelected(BLANK)}
            onDoubleClick={() => {
              setSelected(BLANK);
              onConfirm(name.trim() || defaultName, null);
            }}
          >
            <span className="bg-hover text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md">
              <FileText className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">空白文档</span>
              <span className="text-muted-foreground block text-[11px]">从空正文开始</span>
            </span>
          </button>
          {templates.map((t) => (
            <button
              key={t}
              type="button"
              role="option"
              aria-selected={selected === t}
              className={cn(
              "border-border-subtle bg-raised/55 flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
              selected === t
                ? "bg-selection border-primary/25 ring-primary/10 text-foreground ring-1"
                : "hover:border-primary/20 text-foreground/90",
              )}
              onClick={() => setSelected(t)}
              onDoubleClick={() => {
                setSelected(t);
                onConfirm(name.trim() || defaultName, t);
              }}
            >
              <span className="bg-selection text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                <LayoutTemplate className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t}</span>
                <span className="text-muted-foreground block text-[11px]">使用此模板创建</span>
              </span>
            </button>
          ))}
        </div>
        <DialogFooter>
          {onManage && (
            <Button variant="ghost" className="text-muted-foreground mr-auto text-xs" onClick={onManage}>
              管理模板…
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={confirm}>创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
