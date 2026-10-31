import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
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
    <span className="line-clamp-2 block text-xs leading-4 break-all">
      {parts.map((p, i) =>
        p.wiki ? (
          <span key={i} className="text-primary font-medium">
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
    <section className="flex max-h-72 shrink-0 flex-col border-t border-border">
      <header className="flex h-9 shrink-0 items-center gap-1 px-2">
        <button
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs font-medium"
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
          <span className="bg-accent text-accent-foreground rounded-full px-1.5 text-[10px] leading-4">
            {rows.length}
          </span>
        )}
      </header>
      {!collapsed && (
        <div className="max-h-60 min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">暂无文档引用本文档</p>
          ) : (
            rows.map((r, i) => (
              <button
                key={`${r.source}:${i}`}
                onClick={() => (r.deleted ? onOpenTrash() : onOpenSource(r.source))}
                className={cn(
                  "hover:bg-accent/50 flex w-full cursor-pointer flex-col gap-0.5 rounded px-2 py-1.5 text-left",
                  r.deleted ? "opacity-55" : "text-foreground/90",
                )}
                title={r.deleted ? `「${r.source}」已移入回收站` : r.source}
              >
                <span className="flex w-full min-w-0 items-center gap-1.5">
                  <FileText className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="truncate text-xs leading-4 font-medium">{rowName(r.source)}</span>
                  {r.heading && (
                    <span className="text-muted-foreground ml-auto shrink-0 truncate text-[10px] leading-3">
                      {r.heading}
                    </span>
                  )}
                  {r.deleted && (
                    <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">已删除</span>
                  )}
                </span>
                {rowParent(r.source) && !r.heading && (
                  <span className="text-muted-foreground block truncate pl-5 text-[10px] leading-3">
                    {rowParent(r.source)}
                  </span>
                )}
                <span className="pl-5">
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
