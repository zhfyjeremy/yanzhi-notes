import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, FileText, Trash2 } from "lucide-react";
import type { BacklinkRow } from "./backlinks";
import { cn } from "@/lib/utils";

/**
 * 反向链接面板(PRD §5.4-2 + 6.3-1):列出引用当前文档的来源;
 * 每次引用一行 = 来源文档 + 章节位置 + 上下文片段([[…]] 原文高亮),
 * 裸名/路径/别名写法已归一(同源多引用自然展开多行)。
 * 来源在回收站 → 灰态「已删除」,点击引导去回收站(5.1.1-3)。
 * 挂在右栏大纲下方,与大纲同款折叠头。
 */

interface BacklinksPanelProps {
  rows: BacklinkRow[];
  /** 打开来源文档并高亮其内的引用写法 */
  onOpenSource: (rel: string) => void;
  onOpenTrash: () => void;
}

const rowName = (p: string) => p.replace(/\.md$/i, "").split("/").pop()!;
const rowParent = (p: string) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

const WIKI_IN_SNIPPET = /\[\[[^\[\]]+?\]\]/g;

/** 片段渲染:[[…]] 部分高亮(与引用写法一致,含别名) */
function Snippet({ text }: { text: string }) {
  const parts: { text: string; wiki: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(WIKI_IN_SNIPPET)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), wiki: false });
    parts.push({ text: m[0], wiki: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), wiki: false });
  return (
    <span className="line-clamp-2 block text-[11px] leading-5 break-words">
      {parts.map((p, i) =>
        p.wiki ? (
          <span key={i} className="text-primary bg-primary/10 rounded-[3px] px-0.5 font-medium">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export function BacklinksPanel({ rows, onOpenSource, onOpenTrash }: BacklinksPanelProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <section className="border-border-subtle flex max-h-72 shrink-0 flex-col border-t">
      <header className="flex h-10 shrink-0 items-center gap-1 px-3">
        <button
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold tracking-[0.03em]"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5 shrink-0" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0" />
          )}
          反向链接
        </button>
        {rows.length > 0 && (
          <span className="bg-selection text-primary ring-primary/15 rounded-full px-1.5 text-[10px] leading-4 ring-1">
            {rows.length}
          </span>
        )}
      </header>
      {!collapsed && (
        <div className="max-h-60 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
          {rows.length === 0 ? (
            <div className="text-muted-foreground mx-1 rounded-lg border border-dashed border-border-subtle px-3 py-5 text-center">
              <FileText className="mx-auto mb-1.5 size-4 opacity-55" />
              <p className="text-xs">暂无文档引用本文档</p>
            </div>
          ) : (
            rows.map((r, i) => (
              <button
                key={`${r.source}:${i}`}
                type="button"
                aria-label={r.deleted ? `打开回收站查看已删除来源 ${r.source}` : `打开来源文档 ${r.source}`}
                onClick={() => (r.deleted ? onOpenTrash() : onOpenSource(r.source))}
                className={cn(
                  "group border-border-subtle bg-raised/55 hover:border-primary/25 hover:bg-raised flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
                  r.deleted
                    ? "border-dashed opacity-70"
                    : "shadow-[0_1px_0_color-mix(in_oklab,var(--workspace)_35%,transparent)]",
                )}
                title={r.deleted ? `「${r.source}」已移入回收站` : r.source}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="bg-selection text-primary flex size-5 shrink-0 items-center justify-center rounded-md">
                    {r.deleted ? <Trash2 className="size-3" /> : <FileText className="size-3" />}
                  </span>
                  <span className="text-foreground/90 min-w-0 flex-1 truncate text-xs leading-4 font-medium">
                    {rowName(r.source)}
                  </span>
                  {!r.deleted && (
                    <ArrowUpRight className="text-muted-foreground/50 group-hover:text-primary size-3.5 shrink-0 transition-colors" />
                  )}
                </span>
                <span className="text-muted-foreground flex min-w-0 gap-1 pl-6 text-[10px] leading-4">
                  <span className="truncate">{rowParent(r.source) || "根目录"}</span>
                  {r.heading && (
                    <>
                      <span className="text-border">/</span>
                      <span className="truncate">{r.heading}</span>
                    </>
                  )}
                  {r.deleted && <span className="text-destructive ml-auto shrink-0">已删除</span>}
                </span>
                <span className="border-primary/25 bg-hover/45 text-muted-foreground ml-2 rounded-r-md border-l-2 py-1 pr-2 pl-2">
                  <Snippet text={r.snippet} />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
