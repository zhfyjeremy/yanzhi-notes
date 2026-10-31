import { useState } from "react";
import katex from "katex";
import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import "katex/dist/katex.min.css";

/**
 * 公式卡片(PRD §6.1.3):行内 `$…$` + 独立块 `$$…$$`,KaTeX 离线渲染。
 * latex 存 attrs(原子节点无 content),双击/hover 按钮进入源码编辑;
 * md 方言规则在 markdown/md-instance.ts,序列化在 markdown/serialize.ts。
 */

/** attr 编解码:encodeURIComponent 输出集不含 HTML 属性敏感字符 */
export function encodeLatex(latex: string): string {
  return encodeURIComponent(latex);
}

export function decodeLatex(raw: string | null): string {
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function katexHtml(latex: string, displayMode: boolean): string {
  if (!latex.trim()) return "";
  try {
    return katex.renderToString(latex, {
      throwOnError: false,
      strict: false,
      displayMode,
    });
  } catch {
    return "";
  }
}

/** 编辑中源码框共用行为:阻断编辑器快捷键,失焦/回车提交;focus 由各输入框的 ref 回调兜底。
 * 不做"插入即编辑"——插入命令的 chain().focus() 会与 textarea 抢焦点(race),改为占位 + 双击/按钮进入 */
function useMathDraft(latex: string) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const beginEdit = () => {
    setDraft(latex);
    setEditing(true);
  };
  const cancel = () => {
    setDraft(latex);
    setEditing(false);
  };
  // ref 回调:挂载即聚焦(已聚焦时不重调,避免渲染时抢焦点)
  const focusRef = (el: HTMLTextAreaElement | HTMLInputElement | null) => {
    if (el && document.activeElement !== el) el.focus();
  };
  return { editing, setEditing, draft, setDraft, focusRef, beginEdit, cancel };
}

function MathInlineView({ node, updateAttributes, selected }: NodeViewProps) {
  const latex = String(node.attrs.latex ?? "");
  const { editing, setEditing, draft, setDraft, focusRef, beginEdit, cancel } =
    useMathDraft(latex);
  const commit = () => {
    if (draft.trim() !== latex) updateAttributes({ latex: draft.trim() });
    setEditing(false);
  };

  if (editing) {
    return (
      <NodeViewWrapper as="span">
        <input
          ref={focusRef}
          className="yz-math-input"
          value={draft}
          placeholder="LaTeX 公式"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") cancel();
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
        />
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper
      as="span"
      className="yz-math-inline"
      data-selected={selected || undefined}
      onDoubleClick={beginEdit}
    >
      {latex.trim() ? (
        <span
          contentEditable={false}
          dangerouslySetInnerHTML={{ __html: katexHtml(latex, false) }}
        />
      ) : (
        <span contentEditable={false} className="yz-math-empty">
          空公式
        </span>
      )}
    </NodeViewWrapper>
  );
}

function MathBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const latex = String(node.attrs.latex ?? "");
  const { editing, setEditing, draft, setDraft, focusRef, beginEdit, cancel } =
    useMathDraft(latex);
  const commit = () => {
    if (draft.trim() !== latex) updateAttributes({ latex: draft.trim() });
    setEditing(false);
  };

  if (editing) {
    const rows = Math.max(2, draft.split("\n").length);
    return (
      <NodeViewWrapper className="yz-math-block" data-editing>
        <textarea
          ref={focusRef}
          className="yz-math-edit"
          rows={rows}
          value={draft}
          placeholder="LaTeX 公式,Ctrl/Cmd+Enter 完成"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") cancel();
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
              e.currentTarget.blur();
          }}
        />
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper
      className="yz-math-block group relative"
      data-selected={selected || undefined}
    >
      <div className="absolute top-1.5 right-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="ghost"
          size="xs"
          className="bg-background/80 text-muted-foreground backdrop-blur"
          onMouseDown={(e) => e.preventDefault()}
          onClick={beginEdit}
        >
          <Pencil className="size-3" />
          编辑
        </Button>
      </div>
      {latex.trim() ? (
        <div
          className="yz-math-render"
          contentEditable={false}
          onDoubleClick={beginEdit}
          dangerouslySetInnerHTML={{ __html: katexHtml(latex, true) }}
        />
      ) : (
        <div className="yz-math-empty" contentEditable={false}>
          空公式,双击或点右上角编辑
        </div>
      )}
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: {
      /** 插入独立公式卡(空源码占位) */
      setMathBlock: () => ReturnType;
    };
    mathInline: {
      /** 插入行内公式(空源码占位) */
      setMathInline: () => ReturnType;
    };
  }
}

export const MathInline = Node.create({
  name: "mathInline",
  inline: true,
  group: "inline",
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => decodeLatex(el.getAttribute("data-latex")),
        renderHTML: (attrs) =>
          attrs.latex ? { "data-latex": encodeLatex(String(attrs.latex)) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-math-inline": "" }, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setMathInline:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex: "" } }),
    };
  },

  addInputRules() {
    // `$E=mc^2$ ` 打完即转公式;开 $ 后/闭 $ 前须紧贴非空白(PRD §10)
    return [
      new InputRule({
        find: /\$([^$\s][^$]*?)\$$/,
        handler: ({ chain, range, match }) => {
          const latex = match[1].replace(/\s+$/, "");
          if (!latex.trim()) return null;
          chain()
            .focus()
            .deleteRange(range)
            .insertContentAt(range.from, {
              type: this.name,
              attrs: { latex },
            })
            .run();
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) => decodeLatex(el.getAttribute("data-latex")),
        renderHTML: (attrs) =>
          attrs.latex ? { "data-latex": encodeLatex(String(attrs.latex)) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-math-block": "" }, HTMLAttributes)];
  },

  addCommands() {
    return {
      setMathBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex: "" } }),
    };
  },

  addInputRules() {
    // 空行打 `$$` 即变公式卡
    return [
      new InputRule({
        find: /^\$\$$/,
        handler: ({ chain, range }) => {
          chain()
            .focus()
            .deleteRange(range)
            .insertContentAt(range.from, {
              type: this.name,
              attrs: { latex: "" },
            })
            .run();
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },
});
