import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { sanitizeRawHtmlPreview } from "./raw-html-preview";
import { HighlightedSourceArea } from "./highlighted-source";
import {
  buildDecodedTextMap,
  hitAtPoint,
  normalizedTextOf,
  sourceOffsetForHit,
} from "./raw-html-source-map";

/**
 * Raw HTML 的展示:排版视图直接安全渲染(无块内预览/源码切换按钮)。
 *
 * 交互(2026-11-18):**点击渲染出来的内容 → 该块切到源码态**,
 * 光标按点击位置落到对应字符上(Typora 行为);点击别处/失焦 → 回到渲染视图。
 * 源码改动写回节点 attrs(content),仍走 rawHtml 原样序列化,往返不变。
 */
export function RawHtmlView({ node, updateAttributes, selected }: NodeViewProps) {
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
  /** 源码态:点击渲染内容后展开,失焦/点别处收起 */
  const [editing, setEditing] = useState(false);
  /** 源码草稿(受控);外部内容变化时同步 */
  const [draft, setDraft] = useState(content);
  /** 待落位的源码光标下标(点击位置映射结果) */
  const caretRef = useRef<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** iframe 内部 click 不冒泡到父文档,必须挂到 frame document 上 */
  const frameClickCleanupRef = useRef<(() => void) | null>(null);
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

  // 外部改写内容时同步草稿(源码态内正在编辑则不覆盖用户输入)
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

  // 卸载时移除当前 iframe document 上的 click 监听。
  useEffect(() => {
    return () => {
      const cleanup = frameClickCleanupRef.current;
      if (cleanup) cleanup();
    };
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

    // iframe 文档是独立 DOM,用户点在 iframe 里时父元素 onClick 收不到;
    // 在 frame document 上补一个 click 监听,复用同一套源码定位逻辑。
    const previousCleanup = frameClickCleanupRef.current;
    if (previousCleanup) previousCleanup();
    const handleFrameClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      openEditorAtPoint(event.clientX, event.clientY);
    };
    doc.addEventListener("click", handleFrameClick);
    frameClickCleanupRef.current = () => {
      doc.removeEventListener("click", handleFrameClick);
    };
  };

  const scale = Math.min(
    1,
    availableWidth > 0 && metrics.width > 0 ? availableWidth / metrics.width : 1,
    metrics.height > 0 ? 720 / metrics.height : 1,
  );

  /* -------- 点击渲染内容 → 源码态,光标落到点到的位置 -------- */

  const openEditorAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const frame = iframeRef.current;
      const frameDoc = frame?.contentDocument;
      if (!frame || !frameDoc?.body) return;

      // 点到图片等无文字元素:按标签名粗定位;完全点不到就落在开头
      let offset: number | null = null;
      const hit = hitAtPoint(frame, clientX, clientY, scale);
      if (hit) {
        offset = sourceOffsetForHit(
          content,
          buildDecodedTextMap(content),
          normalizedTextOf(frameDoc.body),
          hit,
        );
      }
      caretRef.current = offset;
      setDraft(content);
      setEditing(true);
    },
    [content, scale],
  );

  const handlePreviewClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    openEditorAtPoint(event.clientX, event.clientY);
  };

  // 源码态挂载后聚焦并把光标落到待落位下标(无命中信息时落在末尾)
  useEffect(() => {
    if (!editing) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const offset = caretRef.current;
    caretRef.current = null;
    const pos =
      offset == null
        ? textarea.value.length
        : Math.min(Math.max(offset, 0), textarea.value.length);
    textarea.setSelectionRange(pos, pos);
  }, [editing]);

  /** 源码改动写回节点 attrs(仍走 rawHtml 原样序列化) */
  const applyDraft = (value: string) => {
    setDraft(value);
    updateAttributes({ content: value });
  };

  /** 收起源码态:把草稿写回(若还没写)并回到渲染视图 */
  const closeEditor = () => {
    setEditing(false);
    // 收起前最后一次输入已通过 onChange 写回;这里兜底同步一次草稿
    if (draft !== content) updateAttributes({ content: draft });
  };

  return (
    <NodeViewWrapper
      className="yz-raw-html"
      data-selected={selected || undefined}
      contentEditable={false}
      title="HTML 块"
    >
      {editing ? (
        <HighlightedSourceArea
          value={draft}
          onChange={applyDraft}
          onBlur={closeEditor}
          onKeyDown={(event) => {
            // 按键不进 PM(编辑器 keymap 会把字符/Enter 当正文输入)
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              closeEditor();
            }
          }}
          ariaLabel="HTML 源码"
          className="yz-highlight-source yz-raw-html-source-wrap"
          inputClassName="yz-raw-html-source"
          minRows={3}
          textareaRef={textareaRef}
        />
      ) : (
        <div
          ref={previewShellRef}
          className="yz-raw-html-preview"
          style={{
            height: Math.min(720, metrics.height * scale),
          }}
          onClick={handlePreviewClick}
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
            <div className="yz-raw-html-empty">空 HTML 块,点击可编辑源码</div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
