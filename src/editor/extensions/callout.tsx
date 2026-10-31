import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Info,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * 提示块 Callout(PRD §6.1.1,V2):`> [!INFO] 标题` 方言(PRD §10,GitHub/Obsidian 兼容)。
 * 4 种风格(信息/成功/警告/注意);标题是纯文本属性(不做行内嵌套,fixtures 锁定),
 * 内容为任意块级节点。解析见 md-instance.ts yz_callout 规则,序列化见 serialize.ts。
 */

export const CALLOUT_TYPES = [
  { id: "info", label: "信息", icon: Info },
  { id: "success", label: "成功", icon: CircleCheck },
  { id: "warning", label: "警告", icon: TriangleAlert },
  { id: "caution", label: "注意", icon: OctagonAlert },
] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number]["id"];

/** 未知类型回信息(与 parseSettings 同一容错口径) */
function calloutOf(id: unknown) {
  return CALLOUT_TYPES.find((t) => t.id === id) ?? CALLOUT_TYPES[0];
}

function CalloutView({ node, updateAttributes, selected }: NodeViewProps) {
  const type = calloutOf(node.attrs.type);
  const title = (node.attrs.title as string | null) ?? "";

  return (
    <NodeViewWrapper
      className="yz-callout group relative"
      data-callout={type.id}
      data-selected={selected || undefined}
    >
      <div className="yz-callout-head" contentEditable={false}>
        <type.icon className="size-4 shrink-0" />
        {/* 标题非受控输入:IME 安全,仅本视图编辑无需外部同步 */}
        <input
          className="yz-callout-title"
          defaultValue={title}
          placeholder="标题(可选)"
          aria-label="提示块标题"
          spellCheck={false}
          onKeyDown={(e) => {
            // 按键不进 PM;Enter 退出标题编辑回到内容区
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onInput={(e) =>
            updateAttributes({ title: e.currentTarget.value.trim() || null })
          }
        />
        {/* hover 浮层:类型切换(代码块卡片同款形态) */}
        <div className="ml-auto shrink-0 self-start opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="text-muted-foreground">
                {type.label}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CALLOUT_TYPES.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => updateAttributes({ type: t.id })}
                >
                  <t.icon className="size-3.5" />
                  {t.label}
                  {type.id === t.id && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <NodeViewContent className="yz-callout-body" />
    </NodeViewWrapper>
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** 插入提示块(斜杠菜单入口),带一个空段落兜底 content "block+" */
      setCallout: (attrs?: { type?: CalloutType; title?: string | null }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-callout") || "info",
        renderHTML: (attributes: { type?: string }) => ({
          "data-callout": calloutOf(attributes.type).id,
        }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-title") || null,
        renderHTML: (attributes: { title?: string | null }) =>
          attributes.title ? { "data-title": attributes.title } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "yz-callout" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { type: attrs.type ?? "info", title: attrs.title ?? null },
            content: [{ type: "paragraph" }],
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
