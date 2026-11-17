import { useEffect, useMemo, useRef, useState } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { sanitizeRawHtmlPreview } from "./raw-html-preview";

/**
 * Raw HTML 的 Typora 式展示:排版视图直接安全渲染,不再提供块内预览/源码切换。
 * 需要修改 HTML 原文时使用全文档 Markdown 源码模式。
 */
export function RawHtmlView({ node, selected }: NodeViewProps) {
  const content = String(node.attrs.content ?? "");
  // div 开/闭边界只负责保留原文,不生成可见 HTML 块。
  if (node.attrs.layout) {
    return <NodeViewWrapper style={{ display: "none" }} />;
  }
  // HTML 注释不走 HTML 渲染,但排版视图保留可见原文,避免用户误以为内容被过滤。
  if (node.attrs.comment) {
    return (
      <NodeViewWrapper className="yz-html-comment" contentEditable={false}>
        <code>{content}</code>
      </NodeViewWrapper>
    );
  }

  const [metrics, setMetrics] = useState({ width: 0, height: 0 });
  const [availableWidth, setAvailableWidth] = useState(0);
  const [themeCss, setThemeCss] = useState("");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
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
    const width = Math.ceil(
      Math.max(doc.body.scrollWidth, doc.documentElement.scrollWidth),
    );
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

  const scale = Math.min(
    1,
    availableWidth > 0 && metrics.width > 0 ? availableWidth / metrics.width : 1,
    metrics.height > 0 ? 720 / metrics.height : 1,
  );

  return (
    <NodeViewWrapper
      className="yz-raw-html"
      data-selected={selected || undefined}
      contentEditable={false}
      title="HTML 块"
    >
      <div
        ref={previewShellRef}
        className="yz-raw-html-preview"
        style={{
          height: Math.min(720, metrics.height * scale),
        }}
      >
        {content.trim() ? (
          <iframe
            ref={iframeRef}
            title="HTML 块"
            sandbox="allow-same-origin"
            srcDoc={previewDoc}
            style={{
              width: metrics.width || "100%",
              height: metrics.height,
              transform: `scale(${scale})`,
            }}
            onLoad={handleLoad}
          />
        ) : (
          <div className="yz-raw-html-empty">空 HTML 块,可在 Markdown 源码模式编辑</div>
        )}
      </div>
    </NodeViewWrapper>
  );
}