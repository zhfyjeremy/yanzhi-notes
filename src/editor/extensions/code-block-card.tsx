import { useEffect, useState } from "react";
import CodeBlock from "@tiptap/extension-code-block";
import { codeHighlightPlugin } from "./code-highlight";
import { renderMermaid } from "./mermaid";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, ChevronDown, Code2, Copy, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 代码块卡片(PRD §5.3.8):hover 浮层 = 语言选择 + 一键复制;左侧行号列;
 * 语法高亮由同目录 code-highlight.ts 的 PM decoration 插件负责。
 * DOM 结构仅影响展示,md 序列化走 schema 与 fixtures,与此无关。
 *
 * Mermaid 图表卡(PRD §6.1.4)复用 codeBlock:```mermaid 围栏存储(§10),
 * language=mermaid 时 NodeView 切换「预览 / 源码」双视图,源码态下方
 * 实时预览;渲染运行时在 mermaid.ts(懒加载 + 串行 + 离线)。
 */

const MERMAID_LANG = "mermaid";

const CODE_LANGUAGES = [
  "plaintext",
  "mermaid",
  "typescript",
  "javascript",
  "json",
  "bash",
  "shell",
  "python",
  "sql",
  "css",
  "html",
  "xml",
  "markdown",
  "yaml",
  "toml",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "swift",
  "kotlin",
  "diff",
  "dockerfile",
] as const;

/** mermaid 源码 → SVG(React 侧):防抖、主题跟随、失败态。
 * 非受控输出:code 不变 + 主题不变则不重渲 */
function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 主题切换(设置窗/跟随系统)时强制重渲:监听 documentElement class 变化
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setNonce((n) => n + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      renderMermaid(code)
        .then((out) => {
          if (!alive) return;
          setSvg(out);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setError(e instanceof Error ? e.message : String(e));
          setSvg(null);
        });
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [code, nonce]);

  if (error) {
    return (
      <div className="yz-mmd-error" contentEditable={false}>
        图表语法有误,请检查源码
        <span className="yz-mmd-error-detail">{error}</span>
      </div>
    );
  }
  if (svg === null) {
    return (
      <div className="yz-mmd-loading" contentEditable={false}>
        正在渲染图表…
      </div>
    );
  }
  return (
    <div
      className="yz-mmd-svg"
      contentEditable={false}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function CodeBlockCardView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const language = (node.attrs.language as string) || "plaintext";
  const isMermaid = language === MERMAID_LANG;
  // mermaid 视图态是会话级 UI 属性,不进 md/attrs(同图片 width/align 决策)
  const [mmdView, setMmdView] = useState<"preview" | "source">("preview");
  const [copied, setCopied] = useState(false);
  // 行号 = 内容渲染行数(white-space: pre 下尾换行也占一行),回车即时跟随
  const lineCount = node.textContent.split("\n").length;

  const copyCode = async () => {
    const text = node.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // WKWebView 剪贴板权限兜底
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const code = node.textContent;
  const hasDiagram = code.trim().length > 0;

  return (
    <NodeViewWrapper
      className="yz-code-card group relative"
      data-selected={selected || undefined}
    >
      {/* hover 浮层:mermaid 视图切换 + 语言 + 复制 */}
      <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {isMermaid && (
          <Button
            variant="ghost"
            size="xs"
            className="bg-background/80 text-muted-foreground backdrop-blur"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              setMmdView((v) => (v === "preview" ? "source" : "preview"))
            }
          >
            {mmdView === "preview" ? (
              <>
                <Code2 className="size-3" />
                源码
              </>
            ) : (
              <>
                <Eye className="size-3" />
                预览
              </>
            )}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="bg-background/80 text-muted-foreground backdrop-blur"
            >
              {language}
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
            {CODE_LANGUAGES.map((lang) => (
              <DropdownMenuItem
                key={lang}
                onClick={() =>
                  updateAttributes({ language: lang === "plaintext" ? null : lang })
                }
              >
                {lang}
                {language === lang && <Check className="ml-auto size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="xs"
          className="bg-background/80 text-muted-foreground backdrop-blur"
          onMouseDown={(e) => e.preventDefault()}
          onClick={copyCode}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>

      {isMermaid && mmdView === "preview" ? (
        <>
          {/* 预览态:contentDOM 必须留在 DOM(PM 要求),视觉隐藏;
              单击选中整卡(可整体复制/删除),双击进源码编辑 */}
          <div
            className="yz-mmd-stage"
            contentEditable={false}
            onClick={() => {
              const pos = typeof getPos === "function" ? getPos() : undefined;
              if (typeof pos === "number") {
                editor.commands.setNodeSelection(pos);
              }
            }}
            onDoubleClick={() => setMmdView("source")}
          >
            {hasDiagram ? (
              <MermaidDiagram code={code} />
            ) : (
              <div className="yz-mmd-empty">
                空图表,双击或点右上角「源码」编辑
              </div>
            )}
          </div>
          <NodeViewContent className="yz-code-content yz-mmd-hidden" />
        </>
      ) : (
        <>
          <div className="flex items-start">
            {/* 行号列:与内容同字号/行高,只读不可选 */}
            <div
              aria-hidden="true"
              contentEditable={false}
              className="yz-code-gutter shrink-0 select-none"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            {/* NodeViewContent 只支持 div;等宽/换行由 .yz-code-content 样式负责 */}
            <NodeViewContent className="yz-code-content" />
          </div>
          {/* 源码态下方实时预览(防抖重渲);空内容不占位 */}
          {isMermaid && hasDiagram && (
            <div className="yz-mmd-live" contentEditable={false}>
              <MermaidDiagram code={code} />
            </div>
          )}
        </>
      )}
    </NodeViewWrapper>
  );
}

export const CodeBlockCard = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockCardView);
  },

  addProseMirrorPlugins() {
    return [codeHighlightPlugin()];
  },
});
