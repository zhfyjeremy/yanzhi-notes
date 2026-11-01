import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileText } from "lucide-react";
import katex from "katex";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettings } from "./settings";
import { mdToHtml } from "./editor/markdown/md-instance";
import { renderMermaid } from "./editor/extensions/mermaid";
import { MARKDOWN_GUIDE_MD, STARTER_MD } from "./kb/help-docs";
import { isTauriEnv } from "./kb/backend";
import "./editor/editor.css";
import "katex/dist/katex.min.css";

type HelpDocId = "quick-start" | "markdown";

const ARTICLES: {
  id: HelpDocId;
  title: string;
  description: string;
  content: string;
}[] = [
  {
    id: "quick-start",
    title: "快速上手",
    description: "3 分钟理解本地知识库、常用排版和继续探索入口",
    content: STARTER_MD,
  },
  {
    id: "markdown",
    title: "Markdown 能力示例",
    description: "查看砚知支持的 Markdown 排版能力与对应源码",
    content: MARKDOWN_GUIDE_MD,
  },
];

function initialDoc(): HelpDocId {
  const match = window.location.hash.match(/^#\/help(?:\?(.*))?$/);
  const params = new URLSearchParams(match?.[1] ?? "");
  const doc = params.get("doc") ?? params.get("tab");
  return doc === "markdown" ? "markdown" : "quick-start";
}

function renderHelpMarkdown(markdown: string): string {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = mdToHtml(markdown);

  for (const el of Array.from(wrapper.querySelectorAll("[data-math-inline], [data-math-block]"))) {
    const display = el.hasAttribute("data-math-block");
    const latex = decodeURIComponent(el.getAttribute("data-latex") ?? "");
    el.className = display ? "yz-math-block" : "yz-math-inline";
    try {
      el.innerHTML = katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
      });
    } catch {
      el.textContent = latex;
    }
  }

  // markdown-it 内部形态是 div[data-details];帮助窗转回原生 details,让示例可交互
  for (const el of Array.from(wrapper.querySelectorAll("[data-details]"))) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = el.getAttribute("data-summary") ?? "折叠内容";
    details.open = el.hasAttribute("data-open");
    details.append(summary, ...Array.from(el.childNodes));
    el.replaceWith(details);
  }

  return wrapper.innerHTML;
}

export function HelpDocsWindow() {
  useSettings();
  const [docId, setDocId] = useState<HelpDocId>(initialDoc);
  const [sourceView, setSourceView] = useState(false);
  const article = ARTICLES.find((item) => item.id === docId) ?? ARTICLES[0];
  const html = useMemo(() => renderHelpMarkdown(article.content), [article.content]);
  const [diagramNonce, setDiagramNonce] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setDiagramNonce((n) => n + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (sourceView) return;
    const container = document.querySelector(".help-doc");
    container?.querySelectorAll(".help-mermaid").forEach((el) => el.remove());
    container
      ?.querySelectorAll<HTMLElement>("pre[data-help-mermaid]")
      .forEach((pre) => delete pre.dataset.helpMermaid);
    const codes = Array.from(document.querySelectorAll<HTMLElement>(".help-doc pre code.language-mermaid"));
    for (const code of codes) {
      const pre = code.parentElement;
      if (!pre?.parentElement || pre.dataset.helpMermaid === "rendered") continue;
      pre.dataset.helpMermaid = "rendered";
      const holder = document.createElement("div");
      holder.className = "help-mermaid";
      holder.textContent = "图表渲染中…";
      pre.before(holder);
      void renderMermaid(code.textContent ?? "")
        .then((svg) => {
          if (holder.isConnected) holder.innerHTML = svg;
        })
        .catch((e: unknown) => {
          if (holder.isConnected) {
            holder.textContent = `图表渲染失败:${e instanceof Error ? e.message : String(e)}`;
          }
        });
    }
  }, [docId, diagramNonce, html, sourceView]);

  useEffect(() => {
    if (!isTauriEnv()) return;
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<string>("yz-help-doc", (event) => {
        if (event.payload === "markdown" || event.payload === "quick-start") {
          setDocId(event.payload);
        }
      }).then((fn) => {
        un = fn;
      });
    });
    return () => un?.();
  }, []);

  return (
    <div className="bg-background text-foreground flex h-screen flex-col overflow-hidden">
      <header className="border-border-subtle bg-sidebar/80 shrink-0 border-b px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold">使用文档</h1>
            <p className="text-muted-foreground mt-0.5 text-xs">内置离线文档,不会发起网络请求</p>
          </div>
          <div className="bg-raised/60 border-border-subtle flex h-8 items-center gap-0.5 rounded-lg border p-0.5">
            <Button
              size="sm"
              variant="ghost"
              className={cn("h-6 px-2 text-xs", !sourceView && "bg-selection text-foreground")}
              onClick={() => setSourceView(false)}
            >
              <BookOpen className="size-3.5" />
              排版视图
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn("h-6 px-2 text-xs", sourceView && "bg-selection text-foreground")}
              onClick={() => setSourceView(true)}
            >
              <FileText className="size-3.5" />
              Markdown 源码
            </Button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="border-border-subtle bg-sidebar w-52 shrink-0 space-y-1 overflow-y-auto border-r p-3">
          {ARTICLES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "hover:bg-hover w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors",
                item.id === article.id
                  ? "bg-raised text-foreground ring-primary/15 ring-1"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setDocId(item.id)}
            >
              <span className="block text-xs font-medium">{item.title}</span>
              <span className="text-muted-foreground/70 mt-0.5 block text-[10px] leading-4">
                {item.description}
              </span>
            </button>
          ))}
        </nav>

        <main className="bg-editor min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-10 py-10">
            {sourceView ? (
              <pre className="bg-raised/45 border-border-subtle overflow-x-auto rounded-xl border p-4 text-xs leading-5">
                <code>{article.content}</code>
              </pre>
            ) : (
              <article className="yz-editor-doc help-doc" dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
