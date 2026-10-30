import { useEffect, useRef } from "react";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, {
  type SuggestionOptions,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { createRoot, type Root } from "react-dom/client";
import { FileText } from "lucide-react";

/**
 * `[[` 双链检索(PRD §5.3.6):输入 `[[` 唤起文档检索列表,
 * 选择插入 wikiLink mark;重名文档目标强制路径写法(PRD §517,由 getDocs 提供方算好 target)。
 * 与斜杠菜单同构:UI 交互插件不进 baseExtensions。
 */

export interface WikiDocRef {
  /** 文档名(basename 去 .md) */
  name: string;
  /** 双链目标写法:唯一名称 → 裸名;重名 → 路径写法 */
  target: string;
  /** 相对路径(重名时菜单里展示消歧) */
  path: string;
}

interface WikiLinkSuggestOptions {
  /** 每次唤起时取最新文档列表(闭包读 ref,不随重渲染断) */
  getDocs: () => WikiDocRef[];
  suggestion: Omit<SuggestionOptions<WikiDocRef, WikiDocRef>, "editor">;
}

const MAX_ITEMS = 12;

function filterDocs(docs: WikiDocRef[], query: string): WikiDocRef[] {
  const q = query.trim().toLowerCase();
  const hit = q
    ? docs.filter(
        (d) => d.name.toLowerCase().includes(q) || d.path.toLowerCase().includes(q),
      )
    : docs;
  return hit.slice(0, MAX_ITEMS);
}

function WikiLinkMenu({
  items,
  selectedIndex,
}: {
  items: WikiDocRef[];
  selectedIndex: number;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current
      ?.querySelector(`[data-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  if (!items.length) return null;
  return (
    <div
      ref={menuRef}
      className="bg-popover text-popover-foreground max-h-80 w-64 overflow-y-auto rounded-lg p-1 shadow-md ring-1 ring-foreground/10"
    >
      {items.map((item, index) => (
        <div
          key={item.path}
          data-index={index}
          className={
            index === selectedIndex
              ? "bg-accent text-accent-foreground flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
              : "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          }
        >
          <FileText className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{item.name}</span>
          {item.target !== item.name && (
            <span className="text-muted-foreground ml-auto truncate text-xs">
              {item.target}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const MENU_WIDTH = 256;
const MENU_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;
const MENU_GAP = 10;

interface MenuState {
  root: Root;
  container: HTMLDivElement;
  items: WikiDocRef[];
  selectedIndex: number;
  props: SuggestionProps<WikiDocRef>;
}

function positionMenu(container: HTMLDivElement, props: SuggestionProps<WikiDocRef>) {
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
    <WikiLinkMenu items={state.items} selectedIndex={state.selectedIndex} />,
  );
}

function insertWikiLink(editor: Editor, range: Range, item: WikiDocRef) {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContentAt(range.from, {
      type: "text",
      text: item.name,
      marks: [{ type: "wikiLink", attrs: { target: item.target } }],
    })
    .run();
}

export const WikiLinkSuggestExtension = Extension.create<WikiLinkSuggestOptions>({
  name: "wikiLinkSuggest",

  addOptions() {
    return {
      getDocs: () => [],
      suggestion: {
        char: "[[",
        allowedPrefixes: null,
        command: ({ editor, range, props: item }) => {
          insertWikiLink(editor, range, item);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        // 与斜杠菜单共用 editor 时必须独立 key(suggestion$ 默认是模块级单例,重复挂载报 keyed plugin 冲突)
        pluginKey: new PluginKey("wikiLinkSuggest"),
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }) => filterDocs(this.options.getDocs(), query),
        allow: ({ state, range }) => {
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
              const container = document.createElement("div");
              container.className = "fixed z-50";
              document.body.appendChild(container);
              state = {
                root: createRoot(container),
                container,
                items: filterDocs(this.options.getDocs(), props.query),
                selectedIndex: 0,
                props,
              };
              renderMenu(state);
            },
            onUpdate: (props) => {
              if (!state) return;
              state.props = props;
              state.items = filterDocs(this.options.getDocs(), props.query);
              state.selectedIndex = Math.min(
                state.selectedIndex,
                Math.max(0, state.items.length - 1),
              );
              renderMenu(state);
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                destroy();
                return true;
              }
              if (!state || !state.items.length) return false;
              const { items, selectedIndex } = state;
              if (props.event.key === "ArrowUp") {
                state.selectedIndex =
                  (selectedIndex - 1 + items.length) % items.length;
                renderMenu(state);
                return true;
              }
              if (props.event.key === "ArrowDown") {
                state.selectedIndex = (selectedIndex + 1) % items.length;
                renderMenu(state);
                return true;
              }
              if (props.event.key === "Enter") {
                insertWikiLink(state.props.editor, state.props.range, items[selectedIndex]);
                return true;
              }
              return false;
            },
            onExit: destroy,
          };
        },
      }),
    ];
  },
});
