import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { createRoot, type Root } from "react-dom/client";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Table,
  Text,
  TextQuote,
} from "lucide-react";
import { insertImage } from "../extensions/image-card";
import { SlashMenu, type SlashCommandDef } from "./SlashMenu";

/**
 * 斜杠 `/` 插入面板(PRD §4.2):输入 `/` 唤起模糊搜索菜单。
 * MVP 菜单 = 文本类 + 卡片类(代码块/表格/图片/分割线);
 * callout/公式/mermaid 等 V2 解锁后才出现在菜单(PRD:不暴露未解锁项)。
 * UI 交互插件,不进 baseExtensions(不贡献 Schema);定位自算坐标,不引 tippy。
 */

const heading = (
  level: 1 | 2 | 3 | 4 | 5 | 6,
  icon: SlashCommandDef["icon"],
): SlashCommandDef => ({
  group: "文本",
  label: `标题 ${level}`,
  icon,
  keywords: [`h${level}`, "heading", "biaoti"],
  action: (editor: Editor, range: Range) =>
    editor
      .chain()
      .focus()
      .deleteRange(range)
      .setHeading({ level })
      .run(),
});

const COMMANDS: SlashCommandDef[] = [
  {
    group: "文本",
    label: "正文",
    icon: Text,
    keywords: ["text", "paragraph", "zhengwen"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).setParagraph().run(),
  },
  heading(1, Heading1),
  heading(2, Heading2),
  heading(3, Heading3),
  heading(4, Heading4),
  heading(5, Heading5),
  heading(6, Heading6),
  {
    group: "文本",
    label: "无序列表",
    icon: List,
    keywords: ["bullet", "unordered", "liebiao"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    group: "文本",
    label: "有序列表",
    icon: ListOrdered,
    keywords: ["ordered", "numbered", "youxu"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    group: "文本",
    label: "待办列表",
    icon: ListTodo,
    keywords: ["todo", "task", "daiban"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    group: "文本",
    label: "引用",
    icon: TextQuote,
    keywords: ["quote", "block", "yinyong"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    group: "卡片",
    label: "代码块",
    icon: Code2,
    keywords: ["code", "daima"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    group: "卡片",
    label: "图片",
    icon: ImageIcon,
    keywords: ["image", "picture", "tupian", "tu"],
    // 插入占位图并选中 → 浮层即出,「编辑图片链接」改地址;拖拽/粘贴落盘在 M3
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      insertImage(editor, { src: "/placeholder.svg", alt: "图片" });
    },
  },
  {
    group: "卡片",
    label: "表格",
    icon: Table,
    keywords: ["table", "biaoge"],
    action: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
  {
    group: "卡片",
    label: "分割线",
    icon: Minus,
    keywords: ["hr", "divider", "fengexian"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
];

/** 大小写不敏感的包含匹配(label + keywords) */
function filterCommands(query: string): SlashCommandDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return COMMANDS;
  return COMMANDS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}

const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;
/** 浮层与触发文字行的上下呼吸间距 */
const MENU_GAP = 10;

interface MenuState {
  root: Root;
  container: HTMLDivElement;
  items: SlashCommandDef[];
  selectedIndex: number;
  props: SuggestionProps<SlashCommandDef>;
}

function positionMenu(container: HTMLDivElement, props: SuggestionProps<SlashCommandDef>) {
  // 3.32 的 props.clientRect 默认为 null,用 coordsAtPos 兜底自算
  const rect =
    props.clientRect?.() ??
    (() => {
      const coords = props.editor.view.coordsAtPos(props.range.from);
      return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
    })();
  const left = Math.min(rect.left, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN);
  const below = rect.bottom + MENU_MAX_HEIGHT + VIEWPORT_MARGIN <= window.innerHeight;
  container.style.left = `${Math.max(VIEWPORT_MARGIN, left)}px`;
  container.style.top = below
    ? `${rect.bottom + MENU_GAP}px`
    : `${Math.max(VIEWPORT_MARGIN, rect.top - MENU_MAX_HEIGHT - MENU_GAP)}px`;
}

function renderMenu(state: MenuState) {
  positionMenu(state.container, state.props);
  state.root.render(
    <SlashMenu items={state.items} selectedIndex={state.selectedIndex} />,
  );
}

function handleMenuKeyDown(state: MenuState, event: KeyboardEvent): boolean {
  if (event.key === "ArrowUp") {
    state.selectedIndex =
      (state.selectedIndex - 1 + state.items.length) % state.items.length;
    renderMenu(state);
    return true;
  }
  if (event.key === "ArrowDown") {
    state.selectedIndex = (state.selectedIndex + 1) % state.items.length;
    renderMenu(state);
    return true;
  }
  if (event.key === "Enter") {
    const item = state.items[state.selectedIndex];
    if (item) item.action(state.props.editor, state.props.range);
    return true;
  }
  return false;
}

export const SlashMenuExtension = Extension.create<{
  suggestion: Omit<SuggestionOptions<SlashCommandDef, SlashCommandDef>, "editor">;
}>({
  name: "slashMenu",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        // null = 不限制前缀,任意位置可唤起(PRD §4.1);默认 [" "] 要求 / 前是空格
        allowedPrefixes: null,
        command: ({
          editor,
          range,
          props: item,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCommandDef;
        }) => {
          item.action(editor, range);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }) => filterCommands(query),
        allow: ({ state, range }) => {
          // 任意位置可唤起(PRD §4.1),但代码块/行内代码内不触发
          const $from = state.doc.resolve(range.from);
          return !(
            $from.parent.type.name === "codeBlock" ||
            state.doc.rangeHasMark(range.from - 1, range.from, state.schema.marks.code)
          );
        },
        render: () => {
          let state: MenuState | null = null;

          const destroy = () => {
            state?.root.unmount();
            state?.container.remove();
            state = null;
          };

          return {
            onStart: (props) => {
              // container 自身承担 fixed 定位(left/top 由 positionMenu 设置);
              // 不能只给子菜单 fixed 类——坐标和定位必须在同一个元素上
              const container = document.createElement("div");
              container.className = "fixed z-50";
              document.body.appendChild(container);
              state = {
                root: createRoot(container),
                container,
                items: filterCommands(props.query),
                selectedIndex: 0,
                props,
              };
              renderMenu(state);
            },
            onUpdate: (props) => {
              if (!state) return;
              state.props = props;
              state.items = filterCommands(props.query);
              if (!state.items.length) {
                state.selectedIndex = 0;
              } else {
                state.selectedIndex = Math.min(
                  state.selectedIndex,
                  state.items.length - 1,
                );
              }
              renderMenu(state);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                destroy();
                return true;
              }
              if (!state || !state.items.length) return false;
              return handleMenuKeyDown(state, props.event);
            },
            onExit: destroy,
          };
        },
      }),
    ];
  },
});
