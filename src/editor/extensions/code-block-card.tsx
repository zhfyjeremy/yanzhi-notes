import { useState } from "react";
import CodeBlock from "@tiptap/extension-code-block";
import { codeHighlightPlugin } from "./code-highlight";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, ChevronDown, Copy } from "lucide-react";
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
 */

const CODE_LANGUAGES = [
  "plaintext",
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

function CodeBlockCardView({ node, updateAttributes, selected }: NodeViewProps) {
  const language = (node.attrs.language as string) || "plaintext";
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

  return (
    <NodeViewWrapper
      className="yz-code-card group relative"
      data-selected={selected || undefined}
    >
      {/* hover 浮层:语言 + 复制 */}
      <div className="absolute top-1.5 right-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
