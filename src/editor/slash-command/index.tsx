import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { createRoot, type Root } from "react-dom/client";
import {
  Calendar,
  CalendarClock,
  CircleCheck,
  Clock,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image as ImageIcon,
  Info,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Minus,
  OctagonAlert,
  Paperclip,
  Radical,
  Sigma,
  Table,
  Text,
  TextQuote,
  Timer,
  TriangleAlert,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { CalloutType } from "../extensions/callout";
import { formatDateTime, type DateTimeInsertKind } from "./datetime";
import { AI_ACTIONS, type AiActionId } from "../../ai/actions";
import {
  SlashMenu,
  flattenSlashMenuNodes,
  type SlashCommandDef,
  type SlashMenuNode,
  type SlashSubmenuDef,
} from "./SlashMenu";

/**
 * 斜杠 `/` 插入面板(PRD §4.2):输入 `/` 唤起模糊搜索菜单。
 * 菜单 = 文本类 + 插入类(日期/时间静态文本) + 卡片类(提示块/公式/代码块/表格/图片/分割线);
 * mermaid 等 V2 后续批次解锁后才出现在菜单(PRD:不暴露未解锁项)。
 * UI 交互插件,不进 baseExtensions(不贡献 Schema);定位自算坐标,不引 tippy。
 * 「图片」走文件选择 → assets 落盘(M3):COMMANDS 是模块级静态表拿不到
 * React props,由 YanzhiEditor 经 setSlashImagePicker 注入应用层回调。
 */

type SlashImagePicker = (editor: Editor) => void;
let imagePicker: SlashImagePicker | null = null;

/** YanzhiEditor 挂载时注入;卸载置 null(菜单回落为不执行) */
export function setSlashImagePicker(fn: SlashImagePicker | null): void {
  imagePicker = fn;
}

type SlashAttachmentPicker = (editor: Editor) => void;
let attachmentPicker: SlashAttachmentPicker | null = null;

/** 同上:附件(6.1.5)的文件选择 → assets 落盘 → 插入附件卡 */
export function setSlashAttachmentPicker(fn: SlashAttachmentPicker | null): void {
  attachmentPicker = fn;
}

type SlashAiHandler = (editor: Editor, actionId: AiActionId) => void;
let aiHandler: SlashAiHandler | null = null;

/** AI `/ai` 动作:由 App 注入 session.run;未注入时 no-op */
export function setSlashAiHandler(fn: SlashAiHandler | null): void {
  aiHandler = fn;
}

/** 斜杠插入的默认流程图模板:小而全(节点/菱形判断/带标签边),中文节点直接可见 */
const MERMAID_TEMPLATE = `flowchart TD
    A[开始] --> B{条件满足?}
    B -- 是 --> C[执行处理]
    C --> D[结束]
    B -- 否 --> D`;

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

const callout = (
  type: CalloutType,
  label: string,
  icon: SlashCommandDef["icon"],
  pinyin: string,
): SlashCommandDef => ({
  group: "卡片",
  label,
  icon,
  keywords: ["callout", "tishi", type, pinyin],
  action: (editor, range) =>
    editor.chain().focus().deleteRange(range).setCallout({ type }).run(),
});

const insertDateTime = (kind: DateTimeInsertKind): SlashCommandDef["action"] => (
  editor,
  range,
) =>
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent(formatDateTime(kind))
    .run();

const DATE_TIME_COMMANDS: SlashCommandDef[] = [
  {
    group: "插入",
    label: "今日日期（年-月-日）",
    icon: Calendar,
    keywords: ["date", "today", "riqi", "jinri", "nianyueri"],
    action: insertDateTime("date"),
  },
  {
    group: "插入",
    label: "当前时间（时:分）",
    icon: Clock,
    keywords: ["time", "now", "shijian", "shifen"],
    action: insertDateTime("time"),
  },
  {
    group: "插入",
    label: "日期和时间（年-月-日 时:分）",
    icon: CalendarClock,
    keywords: ["datetime", "riqi shijian", "riqishijian", "nianyueri shifen"],
    action: insertDateTime("datetime"),
  },
  {
    group: "插入",
    label: "中文日期（年月日）",
    icon: Calendar,
    keywords: ["chinese date", "zhongwen riqi", "nianyueri"],
    action: insertDateTime("chineseDate"),
  },
  {
    group: "插入",
    label: "中文日期和时间（年月日 时:分）",
    icon: CalendarClock,
    keywords: ["chinese datetime", "zhongwen shijian", "nianyueri shifen"],
    action: insertDateTime("chineseDatetime"),
  },
  {
    group: "插入",
    label: "当前时间含秒（时:分:秒）",
    icon: Timer,
    keywords: ["seconds", "time seconds", "miao", "jingque shijian"],
    action: insertDateTime("timeWithSeconds"),
  },
];

export const COMMANDS: SlashCommandDef[] = [
  callout("info", "信息提示", Info, "xinxi"),
  callout("success", "成功提示", CircleCheck, "chenggong"),
  ...DATE_TIME_COMMANDS,
  callout("warning", "警告提示", TriangleAlert, "jinggao"),
  callout("caution", "注意提示", OctagonAlert, "zhuyi"),
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
    label: "折叠块",
    icon: ListCollapse,
    keywords: ["details", "collapse", "summary", "zhedie", "shouqi"],
    // <details><summary> 存储(PRD §6.1.2);插入默认展开便于直接编辑,收起即默认收起
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).setDetails().run(),
  },
  {
    group: "卡片",
    label: "公式",
    icon: Sigma,
    keywords: ["math", "formula", "katex", "gongshi", "fenshi"],
    // 独立公式卡;插入后占位,双击或 hover 编辑按钮进入 LaTeX 源码
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).setMathBlock().run(),
  },
  {
    group: "卡片",
    label: "行内公式",
    icon: Radical,
    keywords: ["math", "inline", "katex", "hangnei", "gongshi"],
    action: (editor, range) =>
      editor.chain().focus().deleteRange(range).setMathInline().run(),
  },
  {
    group: "卡片",
    label: "Mermaid 图表",
    icon: Workflow,
    keywords: ["mermaid", "diagram", "flowchart", "tubiao", "liuchengtu", "tu"],
    // ```mermaid 围栏即 codeBlock(PRD §6.1.4/§10),插入带默认流程图模板
    action: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: MERMAID_TEMPLATE }],
        })
        .run(),
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
    // 文件选择 → assets 落盘 → 插入(应用层回调;取消则不插入)
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      imagePicker?.(editor);
    },
  },
  {
    group: "卡片",
    label: "附件",
    icon: Paperclip,
    keywords: ["attachment", "file", "fujian", "wenjian"],
    // 任意类型文件选择 → assets 落盘 → 插入附件卡(应用层回调;点击卡片唤起系统打开)
    action: (editor, range) => {
      editor.chain().focus().deleteRange(range).run();
      attachmentPicker?.(editor);
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
  // AI(§7.8):关键词含 ai,输入 /ai 即可筛出;动作由 setSlashAiHandler 注入
  ...AI_ACTIONS.map(
    (a): SlashCommandDef => ({
      group: "AI",
      label: a.label,
      icon: Sparkles,
      keywords: a.keywords,
      action: (editor, range) => {
        editor.chain().focus().deleteRange(range).run();
        aiHandler?.(editor, a.id);
      },
    }),
  ),
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

/**
 * 无搜索时把长尾命令收进二级菜单;有搜索时仍平铺命中叶子命令,
 * `/h1`、`/todo`、`/translate` 等熟手路径保持一步执行。
 */
const SUBMENUS: (Omit<SlashSubmenuDef, "children"> & {
  match: (item: SlashCommandDef) => boolean;
})[] = [
  {
    id: "heading",
    group: "文本",
    label: "标题",
    icon: Heading2,
    match: (item) => item.group === "文本" && /^h[1-6]$/.test(item.keywords[0] ?? ""),
  },
  {
    id: "list",
    group: "文本",
    label: "列表",
    icon: List,
    match: (item) => item.group === "文本" && item.label.endsWith("列表"),
  },
  {
    id: "date-time",
    group: "插入",
    label: "日期和时间",
    icon: Calendar,
    match: (item) => item.group === "插入",
  },
  {
    id: "callout",
    group: "卡片",
    label: "提示块",
    icon: Info,
    match: (item) => item.keywords.includes("callout"),
  },
  {
    id: "math",
    group: "卡片",
    label: "公式",
    icon: Sigma,
    match: (item) => item.group === "卡片" && item.keywords.includes("math"),
  },
  {
    id: "ai",
    group: "AI",
    label: "AI 动作",
    icon: Sparkles,
    match: (item) => item.group === "AI",
  },
];

export function buildSlashMenuNodes(items: SlashCommandDef[], query: string): SlashMenuNode[] {
  if (query.trim()) return items.map((item) => ({ kind: "item", item }));

  const submenuByItem = new Map<SlashCommandDef, (typeof SUBMENUS)[number]>();
  for (const item of items) {
    const submenu = SUBMENUS.find((def) => def.match(item));
    if (submenu) submenuByItem.set(item, submenu);
  }

  const emitted = new Set<string>();
  const nodes: SlashMenuNode[] = [];
  for (const item of items) {
    const submenu = submenuByItem.get(item);
    if (!submenu) {
      nodes.push({ kind: "item", item });
      continue;
    }
    if (emitted.has(submenu.id)) continue;
    emitted.add(submenu.id);
    nodes.push({
      kind: "submenu",
      id: submenu.id,
      group: submenu.group,
      label: submenu.label,
      icon: submenu.icon,
      children: items.filter((child) => submenuByItem.get(child)?.id === submenu.id),
    });
  }
  return nodes;
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
  selectedRootIndex: number;
  openCategory: string | null;
  props: SuggestionProps<SlashCommandDef>;
  /** 鼠标点击项执行后收起菜单 */
  pick: (item: SlashCommandDef) => void;
  openCategoryById: (id: string, rootIndex: number) => void;
  closeCategory: () => void;
  hoverIndex: (index: number, scope: "root" | "child") => void;
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
    <SlashMenu
      nodes={buildSlashMenuNodes(state.items, state.props.query)}
      selectedIndex={state.selectedIndex}
      selectedRootIndex={state.selectedRootIndex}
      openCategory={state.openCategory}
      onPick={state.pick}
      onOpenCategory={state.openCategoryById}
      onHoverIndex={state.hoverIndex}
    />,
  );
}

function navigationNodes(state: MenuState): SlashMenuNode[] {
  const nodes = flattenSlashMenuNodes(buildSlashMenuNodes(state.items, state.props.query));
  if (!state.openCategory) return nodes;
  const category = nodes.find(
    (node): node is { kind: "submenu" } & SlashSubmenuDef =>
      node.kind === "submenu" && node.id === state.openCategory,
  );
  return category ? category.children.map((item) => ({ kind: "item", item }) as const) : nodes;
}

function handleMenuKeyDown(state: MenuState, event: KeyboardEvent): boolean {
  const nodes = navigationNodes(state);

  if (event.key === "Escape" && state.openCategory) {
    state.closeCategory();
    return true;
  }
  if (event.key === "ArrowLeft" && state.openCategory) {
    state.closeCategory();
    return true;
  }
  if (event.key === "ArrowUp") {
    state.selectedIndex = (state.selectedIndex - 1 + nodes.length) % nodes.length;
    renderMenu(state);
    return true;
  }
  if (event.key === "ArrowDown") {
    state.selectedIndex = (state.selectedIndex + 1) % nodes.length;
    renderMenu(state);
    return true;
  }

  const current = nodes[state.selectedIndex];
  if (
    (event.key === "ArrowRight" || event.key === "Enter") &&
    current?.kind === "submenu"
  ) {
    state.openCategoryById(current.id, state.selectedIndex);
    return true;
  }
  if (event.key === "Enter" && current?.kind === "item") {
    state.pick(current.item);
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
        // 同一 editor 挂多个 suggestion([[双链检索)时必须独立 key,默认 suggestion$ 是模块级单例会冲突
        pluginKey: new PluginKey("slashMenuSuggest"),
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
          // 点击项:执行命令后立即收起(不等文档变更触发 onExit)
          const pick = (item: SlashCommandDef) => {
            if (state) item.action(state.props.editor, state.props.range);
            destroy();
          };
          const openCategoryById = (id: string, rootIndex: number) => {
            if (!state) return;
            if (state.openCategory === id) {
              if (state.selectedRootIndex !== rootIndex) {
                state.selectedRootIndex = rootIndex;
                renderMenu(state);
              }
              return;
            }
            state.openCategory = id;
            state.selectedRootIndex = rootIndex;
            state.selectedIndex = 0;
            renderMenu(state);
          };
          const closeCategory = () => {
            if (!state?.openCategory) return;
            state.openCategory = null;
            state.selectedIndex = state.selectedRootIndex;
            renderMenu(state);
          };
          const hoverIndex = (index: number, scope: "root" | "child") => {
            if (!state) return;
            if (scope === "root") {
              const shouldClose = !!state.openCategory;
              if (!shouldClose && state.selectedIndex === index) return;
              state.openCategory = null;
              state.selectedIndex = index;
              state.selectedRootIndex = index;
              renderMenu(state);
              return;
            }
            if (state.selectedIndex === index) return;
            state.selectedIndex = index;
            renderMenu(state);
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
                selectedRootIndex: 0,
                openCategory: null,
                props,
                pick,
                openCategoryById,
                closeCategory,
                hoverIndex,
              };
              renderMenu(state);
            },
            onUpdate: (props) => {
              if (!state) return;
              const queryChanged = state.props.query !== props.query;
              state.props = props;
              state.items = filterCommands(props.query);
              state.openCategory = null;
              if (queryChanged || !state.items.length) {
                state.selectedIndex = 0;
                state.selectedRootIndex = 0;
              } else {
                const nodeCount = flattenSlashMenuNodes(
                  buildSlashMenuNodes(state.items, props.query),
                ).length;
                state.selectedIndex = Math.min(state.selectedIndex, nodeCount - 1);
                state.selectedRootIndex = Math.min(state.selectedRootIndex, nodeCount - 1);
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
