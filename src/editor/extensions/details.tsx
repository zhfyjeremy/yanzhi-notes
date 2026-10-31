import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 折叠摘要块 Details(PRD §6.1.2,V2):`<details><summary>` 方言(PRD §10,GitHub 原生)。
 * open 属性 = 持久化的默认展开/收起(PRD「可设置默认展开 / 收起」),点击 chevron 即切换;
 * 摘要是纯文本属性(不做行内嵌套,fixtures 锁定),内容为任意块级节点。
 * 解析见 md-instance.ts yz_details 规则,序列化见 serialize.ts;
 * renderHTML 输出原生 <details><summary>,导出 HTML / 复制即 GitHub 可折叠形态。
 */

function DetailsView({ node, updateAttributes, selected }: NodeViewProps) {
  const open = Boolean(node.attrs.open);
  const summary = (node.attrs.summary as string) ?? "";

  return (
    <NodeViewWrapper
      className="yz-details group"
      data-open={open || undefined}
      data-selected={selected || undefined}
    >
      <div className="yz-details-head" contentEditable={false}>
        {/* 展开态即持久默认态:切换直接写 open 属性 */}
        <button
          type="button"
          className="yz-details-toggle"
          aria-label={open ? "收起" : "展开"}
          onClick={() => updateAttributes({ open: !open })}
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
          />
        </button>
        {/* 摘要非受控输入:IME 安全,仅本视图编辑无需外部同步 */}
        <input
          className="yz-details-summary"
          defaultValue={summary}
          placeholder="摘要标题"
          aria-label="折叠块摘要"
          spellCheck={false}
          onKeyDown={(e) => {
            // 按键不进 PM;Enter 展开并退出摘要编辑
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              updateAttributes({ open: true });
              e.currentTarget.blur();
            }
          }}
          onInput={(e) => updateAttributes({ summary: e.currentTarget.value })}
        />
      </div>
      {/* 折叠时 contentDOM 仅隐藏不禁挂载(PM 要求稳定);CSS 见 .yz-details:not([data-open]) */}
      <NodeViewContent className="yz-details-body" />
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    details: {
      /** 插入折叠块(斜杠菜单入口),带一个空段落兜底 content "block+";默认展开便于直接编辑 */
      setDetails: (attrs?: { summary?: string; open?: boolean }) => ReturnType;
    };
  }
}

export const Details = Node.create({
  name: "details",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      summary: { default: "" },
      open: { default: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-details]",
        getAttrs: (element) => ({
          summary: element.getAttribute("data-summary") ?? "",
          open: element.hasAttribute("data-open"),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // 原生 details 形态:导出 HTML / 复制富文本直接是 GitHub 可折叠块。
    // PM 要求内容洞(0)是父节点唯一子节点,正文包一层 div
    return [
      "details",
      mergeAttributes(node.attrs.open ? { open: "" } : {}, HTMLAttributes),
      ["summary", {}, String(node.attrs.summary ?? "")],
      ["div", {}, 0],
    ];
  },

  addCommands() {
    return {
      setDetails:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { summary: attrs.summary ?? "", open: attrs.open ?? true },
            content: [{ type: "paragraph" }],
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsView);
  },
});
