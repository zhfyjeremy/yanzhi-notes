import { useEffect, useRef, type MutableRefObject } from "react";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  keymap,
  ViewPlugin,
} from "@codemirror/view";
import { Compartment, EditorState, Prec, type Range } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentLess, indentMore } from "@codemirror/commands";
import {
  HighlightStyle,
  Language,
  LanguageDescription,
  LanguageSupport,
  ParseContext,
  defineLanguageFacet,
  languageDataProp,
  syntaxHighlighting,
  indentUnit,
  syntaxTree,
} from "@codemirror/language";
import { GFM, parseCode, parser } from "@lezer/markdown";
import { languages as allCodeLanguages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";

/**
 * Typora 式 Markdown 源码编辑器:
 * CodeMirror 只负责源码态输入与语法高亮;高度随内容增长,纵向滚动仍由外层正文容器承担。
 */

/**
 * 最小 Markdown 语言封装:直接用 @lezer/markdown 的 GFM parser,
 * 避开 @codemirror/lang-markdown → lang-html → CSS/JS/XML 的连带大 chunk。
 */
const markdownData = defineLanguageFacet({
  commentTokens: { block: { open: "<!--", close: "-->" } },
});

// 常用 fenced code 语言按需懒加载 parser;language-data 的描述对象只进源码 chunk。
const CODE_LANGUAGE_NAMES = new Set([
  "C", "C++", "CSS", "HTML", "Java", "JavaScript", "JSON", "Python",
  "Rust", "Go", "Shell", "SQL", "TypeScript", "XML", "YAML",
]);
const codeLanguages = allCodeLanguages.filter((language) =>
  CODE_LANGUAGE_NAMES.has(language.name),
);

const codeParser = (info: string) => {
  const cleanInfo = /\S*/.exec(info)?.[0] ?? "";
  const description = LanguageDescription.matchLanguageName(
    codeLanguages,
    cleanInfo,
    true,
  );
  if (!description) return null;
  return description.support
    ? description.support.language.parser
    : ParseContext.getSkippingParser(description.load());
};

const markdownParser = parser.configure([
  GFM,
  parseCode({ codeParser }),
  { props: [languageDataProp.add({ Document: markdownData })] },
]);
const markdownLanguage = new LanguageSupport(
  new Language(markdownData, markdownParser, [], "markdown"),
);

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: "cm-md-h1" },
  { tag: tags.heading2, class: "cm-md-h2" },
  { tag: tags.heading3, class: "cm-md-h3" },
  { tag: tags.heading4, class: "cm-md-h4" },
  { tag: tags.heading5, class: "cm-md-h5" },
  { tag: tags.heading6, class: "cm-md-h6" },
  { tag: tags.strong, class: "cm-md-strong" },
  { tag: tags.emphasis, class: "cm-md-emphasis" },
  { tag: tags.strikethrough, class: "cm-md-strike" },
  { tag: tags.link, class: "cm-md-link" },
  { tag: tags.url, class: "cm-md-url" },
  { tag: tags.monospace, class: "cm-md-code" },
  { tag: tags.labelName, class: "cm-md-code-info" },
  { tag: tags.string, class: "cm-code-string" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], class: "cm-code-comment" },
  { tag: [tags.string, tags.character, tags.regexp], class: "cm-code-string" },
  { tag: [tags.number, tags.integer, tags.float, tags.color], class: "cm-code-number" },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword,
      tags.modifier,
      tags.self,
    ],
    class: "cm-code-keyword",
  },
  { tag: [tags.bool, tags.atom, tags.null], class: "cm-code-atom" },
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
    class: "cm-code-type",
  },
  { tag: tags.function(tags.variableName), class: "cm-code-function" },
  { tag: tags.propertyName, class: "cm-code-property" },
  { tag: tags.operator, class: "cm-code-operator" },
  { tag: tags.variableName, class: "cm-code-variable" },
  { tag: tags.quote, class: "cm-md-quote" },
  { tag: tags.processingInstruction, class: "cm-md-mark" },
  { tag: tags.operator, class: "cm-md-table" },
  { tag: tags.meta, class: "cm-md-meta" },
  { tag: tags.invalid, class: "cm-md-invalid" },
]);

const wikiLinkDecorator = new MatchDecorator({
  regexp: /\[\[[^\[\]\n]+(?:\|[^\[\]\n]*)?\]\]/g,
  decoration: Decoration.mark({ class: "cm-md-wikilink" }),
});

const highlightMarkDecorator = new MatchDecorator({
  regexp: /==[^=\n]+==/g,
  decoration: Decoration.mark({ class: "cm-md-highlight" }),
});

const wikiLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: import("@codemirror/view").DecorationSet;

    constructor(view: EditorView) {
      this.decorations = wikiLinkDecorator.createDeco(view);
    }

    update(update: import("@codemirror/view").ViewUpdate) {
      this.decorations = wikiLinkDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const highlightMarkPlugin = ViewPlugin.fromClass(
  class {
    decorations: import("@codemirror/view").DecorationSet;

    constructor(view: EditorView) {
      this.decorations = highlightMarkDecorator.createDeco(view);
    }

    update(update: import("@codemirror/view").ViewUpdate) {
      this.decorations = highlightMarkDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * 无嵌套语言 parser 时的轻量代码内容着色:
 * 只在 FencedCode/CodeBlock 行内做注释/字符串/数字/关键词/函数等通用识别,
 * 避免 language-data 把所有语言 parser 拉进源码模式 chunk。
 */
const CODE_TOKEN_RE = new RegExp(
  [
    "(\\/\\/.*|#.*)", // comment
    '("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)', // string
    "\\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|def|fn|struct|impl|pub|use|mod)\\b", // keyword
    "\\b(?:true|false|null|undefined|None|True|False|nil)\\b", // atom
    "\\b(?:string|number|boolean|object|any|unknown|never|void|int|float|double|char|Array|Record|Promise)\\b", // type
    "\\b\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b", // number
    "([A-Za-z_$][\\w$]*)(?=\\s*\\()", // function
  ].join("|"),
  "g",
);

function codeTokenClass(token: string): string | null {
  if (/^\/\//.test(token) || token.startsWith("#")) return "cm-code-comment";
  if (/^["'`]/.test(token)) return "cm-code-string";
  if (/^\d/.test(token)) return "cm-code-number";
  if (/^(true|false|null|undefined|None|True|False|nil)$/.test(token)) return "cm-code-atom";
  if (/^(string|number|boolean|object|any|unknown|never|void|int|float|double|char|Array|Record|Promise)$/.test(token)) return "cm-code-type";
  if (/^(const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|extends|import|from|export|default|async|await|try|catch|finally|throw|typeof|instanceof|in|of|def|fn|struct|impl|pub|use|mod)$/.test(token)) return "cm-code-keyword";
  return "cm-code-function";
}

function pushCodeTokens(text: string, from: number, ranges: Range<Decoration>[]) {
  CODE_TOKEN_RE.lastIndex = 0;
  for (let match = CODE_TOKEN_RE.exec(text); match; match = CODE_TOKEN_RE.exec(text)) {
    const token = match[0];
    const cls = codeTokenClass(token);
    if (!cls) continue;
    ranges.push({
      from: from + match.index,
      to: from + match.index + token.length,
      value: Decoration.mark({ class: cls }),
    });
  }
}

const codeBlockTheme = ViewPlugin.fromClass(
  class {
    decorations: import("@codemirror/view").DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: import("@codemirror/view").ViewUpdate) {
      if (!update.docChanged && !update.viewportChanged && !update.selectionSet) return;
      this.decorations = this.build(update.view);
    }

    build(view: EditorView) {
      const ranges: Range<Decoration>[] = [];
      syntaxTree(view.state).iterate({
        enter: (node) => {
          if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
          const first = view.state.doc.lineAt(node.from);
          const last = view.state.doc.lineAt(node.to);
          const fenceRe = /^\s*(`{3,}|~{3,})/;
          const isFence = (text: string) => fenceRe.test(text);

          for (let lineNumber = first.number; lineNumber <= last.number; lineNumber++) {
            const line = view.state.doc.line(lineNumber);
            const opening = line.number === first.number;
            const closing = line.number === last.number && last.number !== first.number && isFence(last.text);
            const role = opening
              ? "cm-code-fence-line cm-code-open-line"
              : closing
                ? "cm-code-fence-line cm-code-close-line"
                : "cm-code-content-line";
            ranges.push({
              from: line.from,
              to: line.from,
              value: Decoration.line({ class: role }),
            });
            const infoNode = node.node.getChild("CodeInfo");
            const info = infoNode
              ? view.state.sliceDoc(infoNode.from, infoNode.to)
              : "";
            const usesGenericFallback = !codeParser(info);
            if (!opening && !closing && usesGenericFallback) {
              pushCodeTokens(line.text, line.from, ranges);
            }
          }
        },
      });
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const sourceTheme = EditorView.theme({
  "&": {
    height: "auto",
    color: "var(--foreground)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--editor-font-size, 16px)",
    lineHeight: "var(--editor-line-height, 1.6)",
    letterSpacing: "var(--editor-letter-spacing, normal)",
    overflowX: "hidden",
    overflowY: "hidden",
  },
  ".cm-content": {
    padding: "0",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
    caretColor: "var(--primary)",
  },
  ".cm-line": { padding: "0" },
});

const INDENT_COMPARTMENT = new Compartment();
const SOURCE_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;

export interface MarkdownSourceHeading {
  level: number;
  text: string;
  /** CodeMirror doc offset;供右侧大纲在源码态定位。 */
  pos: number;
}

/** 源码态暴露给外层大纲的最小能力;不把 CodeMirror 类型泄漏到主 chunk。 */
export interface MarkdownSourceOutlineController {
  headings(): MarkdownSourceHeading[];
  headingElement(pos: number): HTMLElement | null;
  locateHeading(pos: number): HTMLElement | null;
}

/** 排版↔源码切换读写光标;由 YanzhiEditor 持有 ref。 */
export interface MarkdownSourceCursorApi {
  getCursor(): number;
  focus(): void;
  scrollCursorIntoView(): void;
}

interface MarkdownSourceEditorProps {
  value: string;
  /** Tab 插入的空格数;与排版视图共享同一设置 */
  indentSize?: number;
  /** 挂载时的光标 offset;缺省 0(文首),不再默认跳文末 */
  initialCursor?: number;
  onChange: (value: string) => void;
  onOutlineController?: (controller: MarkdownSourceOutlineController | null) => void;
  cursorApiRef?: MutableRefObject<MarkdownSourceCursorApi | null>;
}

export function MarkdownSourceEditor({
  value,
  indentSize = 4,
  initialCursor = 0,
  onChange,
  onOutlineController,
  cursorApiRef,
}: MarkdownSourceEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onOutlineControllerRef = useRef(onOutlineController);
  const initialValueRef = useRef(value);
  const initialCursorRef = useRef(initialCursor);
  onChangeRef.current = onChange;
  onOutlineControllerRef.current = onOutlineController;
  initialCursorRef.current = initialCursor;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          markdownLanguage,
          // 与 Typora 源码模式一致:长行在正文列内软折行,不由源码编辑器横向滚动。
          EditorView.lineWrapping,
          // 应用层用 Mod+/ 切换排版/源码视图;必须在 CodeMirror defaultKeymap 前 consumes,
          // 否则同一按键先触发 CodeMirror toggleComment,切回排版时插入 `<!--  -->`。
          Prec.highest(keymap.of([{
            key: "Mod-/",
            run: () => true,
          }])),
          INDENT_COMPARTMENT.of(indentUnit.of(" ".repeat(indentSize))),
          keymap.of([{
            key: "Tab",
            run: (view) => {
              if (view.state.readOnly) return false;
              const { from, to } = view.state.selection.main;
              // 多行选区走 indentMore(逐行);折叠光标在光标处插入缩进单元
              if (from !== to) return indentMore(view);
              if (view.dispatch) {
                view.dispatch(
                  view.state.update(view.state.replaceSelection(view.state.facet(indentUnit)), {
                    userEvent: "input.indent",
                  }),
                );
              }
              return true;
            },
            shift: indentLess,
          }]),
          sourceTheme,
          syntaxHighlighting(markdownHighlight, { fallback: true }),
          wikiLinkPlugin,
          highlightMarkPlugin,
          codeBlockTheme,
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({
            role: "textbox",
            "aria-label": "Markdown 源码",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;

    const lineElement = (pos: number): HTMLElement | null => {
      try {
        const line = view.state.doc.lineAt(pos);
        const dom = view.domAtPos(line.from);
        const node = dom.node.nodeType === 1
          ? (dom.node as HTMLElement)
          : dom.node.parentElement;
        return node?.closest<HTMLElement>(".cm-line") ?? null;
      } catch {
        return null;
      }
    };
    const outlineController: MarkdownSourceOutlineController = {
      headings() {
        const items: MarkdownSourceHeading[] = [];
        for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber++) {
          const line = view.state.doc.line(lineNumber);
          const match = SOURCE_HEADING_RE.exec(line.text);
          if (match) {
            items.push({
              level: match[1].length,
              text: match[2] ?? "",
              pos: line.from,
            });
          }
        }
        return items;
      },
      headingElement: lineElement,
      locateHeading(pos: number) {
        const element = lineElement(pos);
        if (!element) return null;
        try {
          const line = view.state.doc.lineAt(pos);
          view.dispatch({ selection: { anchor: line.from } });
        } catch {
          return null;
        }
        view.focus();
        return element;
      },
    };
    onOutlineControllerRef.current?.(outlineController);

    if (cursorApiRef) {
      cursorApiRef.current = {
        getCursor: () => view.state.selection.main.head,
        focus: () => view.focus(),
        scrollCursorIntoView: () => {
          // jsdom 缺 DOM Range#getClientRects,CM measure 会异步抛;有布局再滚
          const probe = document.createRange?.();
          if (!probe || typeof probe.getClientRects !== "function") return;
          view.dispatch({
            effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
          });
        },
      };
    }

    const anchor = Math.max(0, Math.min(initialCursorRef.current, view.state.doc.length));
    view.dispatch({ selection: { anchor } });
    view.focus();
    // 首次 React.lazy 挂载时外层 rAF 往往早于本 effect;挂载后自己滚一次,避免停在文首
    const scrollId = window.requestAnimationFrame(() => {
      cursorApiRef?.current?.scrollCursorIntoView();
    });

    return () => {
      window.cancelAnimationFrame(scrollId);
      onOutlineControllerRef.current?.(null);
      if (cursorApiRef) cursorApiRef.current = null;
      view.destroy();
      viewRef.current = null;
    };
  }, [cursorApiRef]);

  // Tab 缩进设置即时生效,不重建 CodeMirror view。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: INDENT_COMPARTMENT.reconfigure(indentUnit.of(" ".repeat(indentSize))),
    });
  }, [indentSize]);

  // 外部打开/重载文档时同步源码;自身输入时 value 与 doc 一致,不回灌。
  // 选区夹紧到新文长度,避免无脑跳文末;并回焦便于直接键入。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const anchor = Math.min(view.state.selection.main.head, value.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: { anchor },
    });
    view.focus();
  }, [value]);

  return <div ref={hostRef} className="yz-source-editor" />;
}


export default MarkdownSourceEditor;
