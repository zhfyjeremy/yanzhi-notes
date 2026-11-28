import { useEffect, useMemo, useState } from "react";
import CodeBlock from "@tiptap/extension-code-block";
import { codeHighlightPlugin } from "./code-highlight";
import {
  isKnownCodeLanguage,
  searchCodeLanguages,
} from "./shiki-langs";
import { renderMermaid } from "./mermaid";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Check, ChevronDown, Code2, Copy, Eye, Search, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Fragment } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import { cardAiAvailable, runCardAi } from "@/ai/card-bridge";
import type { AiActionId } from "@/ai/actions";

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

/**
 * 语言候选来自 Shiki 官方注册表(242 canonical + 104 alias,见 shiki-langs.ts),
 * 不再是手写的一小撮;`vue` 等此前缺失的语言因此可用。
 * 用户还可以直接输入任意语言名(见 LanguagePicker 顶部的自定义输入)。
 */

let recentCodeLanguages: string[] = [];
let codeLanguageUsed: ((language: string) => void) | null = null;

export function setCodeLanguageRecents(languages: string[]): void {
  // 最近使用不限于内置列表:自定义语言也要能记住
  recentCodeLanguages = languages.filter((lang) => lang.trim().length > 0);
}

export function setCodeLanguageUsedHandler(
  handler: ((language: string) => void) | null,
): void {
  codeLanguageUsed = handler;
}

/** 自定义语言名是否合法:非空、无空格、纯 ASCII 标识符样式 */
function isValidCustomLanguage(lang: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9+#._-]*$/.test(lang);
}

function LanguagePicker({
  language,
  onSelect,
}: {
  language: string;
  onSelect: (language: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(recentCodeLanguages);
  const q = query.trim().toLocaleLowerCase();

  /**
   * 候选 = 官方注册表模糊搜索结果 + 最近使用(可能含自定义语言)。
   * 自定义语言不在注册表里,只能靠最近使用列表回显。
   */
  const matches = useMemo(
    () => searchCodeLanguages(q, 200).map((option) => option.value),
    [q],
  );
  /** 最近使用里、且被搜索命中的(含自定义语言) */
  const recentMatches = useMemo(
    () =>
      recents.filter(
        (lang) =>
          !q ||
          lang.toLowerCase().includes(q) ||
          matches.includes(lang),
      ),
    [recents, q, matches],
  );
  const recentSet = new Set(recentMatches);
  const otherMatches = matches.filter((lang) => !recentSet.has(lang));
  const ordered = [...recentMatches, ...otherMatches];

  /**
   * 自定义语言:搜索词本身。Shiki 能识别就高亮,不能识别就只是纯文本
   * (language 属性照常写进 md,外部编辑器仍可自行处理)。
   */
  const custom = q && isValidCustomLanguage(q) ? q : null;
  const customKnown = custom ? isKnownCodeLanguage(custom) : false;

  const choose = (lang: string) => {
    const next = [lang, ...recentCodeLanguages.filter((item) => item !== lang)].slice(0, 5);
    recentCodeLanguages = next;
    setRecents(next);
    codeLanguageUsed?.(lang);
    setOpen(false);
    onSelect(lang);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(0);
          setRecents(recentCodeLanguages);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="bg-background/80 text-muted-foreground backdrop-blur"
          aria-label="选择代码语言"
        >
          {language}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1.5">
        <div className="border-border-subtle bg-raised focus-within:border-ring flex h-7 items-center gap-1.5 rounded-md border px-2">
          <Search className="text-muted-foreground size-3 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (query) setQuery("");
                else setOpen(false);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (i + 1) % Math.max(ordered.length + (custom ? 1 : 0), 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(
                  (i) =>
                    (i - 1 + Math.max(ordered.length + (custom ? 1 : 0), 1)) %
                    Math.max(ordered.length + (custom ? 1 : 0), 1),
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                // 末项是「自定义语言」:回车直接用它
                if (custom && active === ordered.length) {
                  choose(custom);
                } else if (ordered[active]) {
                  choose(ordered[active]);
                }
              }
            }}
            placeholder="搜索或输入语言…"
            className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/60"
          />
          {query && (
            <button
              type="button"
              aria-label="清除语言搜索"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setQuery("")}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <div className="mt-1 max-h-60 overflow-y-auto">
          {ordered.length === 0 && !custom ? (
            <p className="text-muted-foreground px-2 py-3 text-center text-[11px]">
              没有匹配的语言
            </p>
          ) : (
            <>
              {recentMatches.length > 0 && (
                <>
                  <div className="text-muted-foreground px-2 pt-1 pb-0.5 text-[10px]">
                    最近使用
                  </div>
                  {recentMatches.map((lang) => (
                    <LanguageItem
                      key={`recent-${lang}`}
                      lang={lang}
                      selected={lang === language}
                      active={ordered.indexOf(lang) === active}
                      onHover={() => setActive(ordered.indexOf(lang))}
                      onSelect={() => choose(lang)}
                    />
                  ))}
                </>
              )}
              {otherMatches.length > 0 && (
                <>
                  <div className="text-muted-foreground px-2 pt-1 pb-0.5 text-[10px]">
                    {recentMatches.length ? "全部语言" : "语言"}
                  </div>
                  {otherMatches.map((lang) => (
                    <LanguageItem
                      key={lang}
                      lang={lang}
                      selected={lang === language}
                      active={ordered.indexOf(lang) === active}
                      onHover={() => setActive(ordered.indexOf(lang))}
                      onSelect={() => choose(lang)}
                    />
                  ))}
                </>
              )}
              {/* 自定义语言:注册表里没有也能写进 language 属性 */}
              {custom && (
                <>
                  <div className="text-muted-foreground px-2 pt-1 pb-0.5 text-[10px]">
                    自定义
                  </div>
                  <button
                    type="button"
                    className={`flex h-7 w-full items-center rounded-md px-2 text-left text-[11px] ${
                      active === ordered.length
                        ? "bg-selection text-foreground"
                        : "hover:bg-hover"
                    }`}
                    onMouseEnter={() => setActive(ordered.length)}
                    onClick={() => choose(custom)}
                  >
                    <span className="font-medium">{custom}</span>
                    <span className="text-muted-foreground ml-auto pl-2 text-[10px]">
                      {customKnown ? "已支持高亮" : "无高亮"}
                    </span>
                    {custom === language && (
                      <Check className="text-primary ml-auto size-3.5" />
                    )}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LanguageItem({
  lang,
  selected,
  active,
  onHover,
  onSelect,
}: {
  lang: string;
  selected: boolean;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex h-7 w-full items-center rounded-md px-2 text-left text-[11px] ${
        active ? "bg-selection text-foreground" : "hover:bg-hover"
      }`}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      {lang}
      {selected && <Check className="text-primary ml-auto size-3.5" />}
    </button>
  );
}

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
  const aiOn = cardAiAvailable();

  const runAi = (actionId: AiActionId) => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos !== "number") return;
    // 显式带上本卡片节点 pos,避免下拉抢焦点后选区落到别的代码块
    editor.commands.setNodeSelection(pos);
    runCardAi(editor, actionId, pos);
  };

  return (
    <NodeViewWrapper
      className={`group relative ${isMermaid ? "yz-mmd-card" : "yz-code-card"}`}
      data-selected={selected || undefined}
    >
      {/* hover 浮层:mermaid 视图切换 + AI + 语言 + 复制 */}
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
        {aiOn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="bg-background/80 text-primary backdrop-blur"
                onMouseDown={(e) => e.preventDefault()}
              >
                <Sparkles className="size-3" />
                AI
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem onClick={() => runAi("explainCode")}>解释代码</DropdownMenuItem>
              <DropdownMenuItem onClick={() => runAi("rewriteCode")}>改写代码</DropdownMenuItem>
              {isMermaid && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => runAi("mermaidFix")}>
                    修正 Mermaid
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <LanguagePicker
          language={language}
          onSelect={(lang) =>
            updateAttributes({ language: lang === "plaintext" ? null : lang })
          }
        />
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
          <div className="yz-code-editor flex items-start">
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

  parseHTML() {
    return [
      {
        tag: "pre",
        preserveWhitespace: "full",
        // CommonMark 围栏/缩进代码块的内容天然带尾换行(闭合围栏前的换行算内容),
        // PM 里它会成为一个空尾行:行号多一行、视觉多一行空内容。
        // 解析时剥掉尾换行,与 serialize.ts 落盘口径一致(代码内空行不受影响)。
        getContent: (dom: Node, schema: Schema) => {
          const text = (dom.textContent ?? "").replace(/(?:\r?\n)+$/, "");
          return text ? Fragment.from(schema.text(text)) : Fragment.empty;
        },
      },
    ];
  },
});
