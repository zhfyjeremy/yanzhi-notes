import { useEffect, useMemo, useRef, useState } from "react";
import { Code2, Copy, Eye } from "lucide-react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sanitizeRawHtmlPreview } from "./raw-html-preview";

export function RawHtmlView({
  node,
  updateAttributes,
  selected,
  getPos,
  editor,
}: NodeViewProps) {
  const content = String(node.attrs.content ?? "");
  const [view, setView] = useState<"preview" | "source">("preview");
  const [draft, setDraft] = useState(content);
  const [copied, setCopied] = useState(false);
  const [metrics, setMetrics] = useState({ width: 0, height: 0 });
  const [availableWidth, setAvailableWidth] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [themeCss, setThemeCss] = useState("");
  const previewDoc = useMemo(
    () => sanitizeRawHtmlPreview(content, themeCss),
    [content, themeCss],
  );

  useEffect(() => {
    const readTheme = () => {
      const styles = getComputedStyle(document.documentElement);
      const value = (name: string) => styles.getPropertyValue(name).trim();
      setThemeCss(`:root {
        --foreground: ${value("--foreground")};
        --editor: ${value("--editor")};
        --border-subtle: ${value("--border-subtle")};
        --font-sans: ${value("--font-sans")};
      }`);
    };
    readTheme();
    const observer = new MutationObserver(readTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (document.activeElement !== textareaRef.current) setDraft(content);
  }, [content]);

  useEffect(() => {
    setMetrics({ width: 0, height: 0 });
  }, [previewDoc]);

  useEffect(() => {
    const shell = previewShellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setAvailableWidth(shell.clientWidth));
    observer.observe(shell);
    setAvailableWidth(shell.clientWidth);
    return () => observer.disconnect();
  }, []);

  const measure = () => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc) return;
    // body 使用 max-content 布局,浮动 div 能得到原始排版宽度;再由外层等比缩放。
    const width = Math.ceil(
      Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth),
    );
    // html.scrollHeight 会被 iframe 当前高度撑住,不能用 max;body 才可收缩。
    const height = Math.ceil(doc.body.scrollHeight || doc.documentElement.scrollHeight);
    if (width > 0 && height > 0) setMetrics({ width, height });
  };

  const handleLoad = () => {
    measure();
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    for (const image of Array.from(doc.querySelectorAll("img"))) {
      image.addEventListener("load", measure);
      image.addEventListener("error", measure);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // WKWebView 剪贴板权限失败时保持按钮原状,不干扰编辑。
    }
  };

  const selectNode = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos === "number") editor.commands.setNodeSelection(pos);
  };

  return (
    <NodeViewWrapper
      className="yz-raw-html group relative"
      data-selected={selected || undefined}
      contentEditable={false}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="xs"
          className="bg-background/80 text-muted-foreground backdrop-blur"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setView(view === "preview" ? "source" : "preview")}
        >
          {view === "preview" ? <Code2 className="size-3" /> : <Eye className="size-3" />}
          {view === "preview" ? "源码" : "预览"}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="bg-background/80 text-muted-foreground backdrop-blur"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>

      {view === "preview" ? (
        <div
          ref={previewShellRef}
          className="yz-raw-html-preview"
          style={{
            height: Math.max(
              96,
              Math.min(
                720,
                metrics.height *
                  Math.min(
                    1,
                    availableWidth > 0 && metrics.width > 0
                      ? availableWidth / metrics.width
                      : 1,
                    metrics.height > 0 ? 720 / metrics.height : 1,
                  ),
              ),
            ),
          }}
          title="点击查看 / 编辑 HTML 源码"
          onClick={() => {
            selectNode();
            setView("source");
          }}
        >
          {content.trim() ? (
            <iframe
              ref={iframeRef}
              title="HTML 预览"
              sandbox="allow-same-origin"
              srcDoc={previewDoc}
              style={{
                width: metrics.width || "100%",
                height: metrics.height || 180,
                transform: `scale(${Math.min(
                  1,
                  availableWidth > 0 && metrics.width > 0
                    ? availableWidth / metrics.width
                    : 1,
                  metrics.height > 0 ? 720 / metrics.height : 1,
                )})`,
              }}
              onLoad={handleLoad}
            />
          ) : (
            <div className="yz-raw-html-empty">空 HTML 块,点击右上角「源码」编辑</div>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="yz-raw-html-source"
          value={draft}
          spellCheck={false}
          rows={Math.max(3, Math.min(20, draft.split("\n").length))}
          onChange={(event) => {
            setDraft(event.target.value);
            updateAttributes({ content: event.target.value });
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setView("preview");
            }
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
