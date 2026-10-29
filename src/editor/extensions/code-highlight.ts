import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

/**
 * 代码高亮(PRD §5.3.8/§12):Shiki 离线、JS regex 引擎(同步 tokenize,无 wasm)、
 * 常用语言按需分包。token 色不取 Shiki 主题,而是借 css-variables theme 的
 * 语义槽位(token-keyword 等)归类,渲染为 yz-tok-* class;颜色由 editor.css
 * 的 --code-* design token(:root/.dark 双值)决定,浅深主题自动一致。
 * 高亮以 PM inline decoration 实现,不参与文档模型与序列化。
 */

/** 常用语言(与代码块卡片语言列表对应):字面量 import 便于 Vite 按语言分包 */
const LANG_IMPORTS: Record<
  string,
  () => Promise<{ default: LanguageRegistration | LanguageRegistration[] }>
> = {
  typescript: () => import("@shikijs/langs/typescript"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  bash: () => import("@shikijs/langs/bash"),
  python: () => import("@shikijs/langs/python"),
  sql: () => import("@shikijs/langs/sql"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  xml: () => import("@shikijs/langs/xml"),
  markdown: () => import("@shikijs/langs/markdown"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  java: () => import("@shikijs/langs/java"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  php: () => import("@shikijs/langs/php"),
  ruby: () => import("@shikijs/langs/ruby"),
  swift: () => import("@shikijs/langs/swift"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
};

/** markdown 围栏里常见的别名 → shiki 语言 id;空串 = 无高亮 */
const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  cs: "csharp",
  "c#": "csharp",
  golang: "go",
  rb: "ruby",
  kt: "kotlin",
  docker: "dockerfile",
  text: "",
  plaintext: "",
  txt: "",
};

/** Shiki 语义槽位 → yz-tok-* class(色值见 editor.css 的 --code-* 映射) */
const SLOT_CLASS: Record<string, string> = {
  "token-comment": "cm",
  "token-string": "str",
  "token-string-expression": "emb",
  "token-constant": "num",
  "token-keyword": "kw",
  "token-parameter": "var",
  "token-function": "fn",
  "token-punctuation": "op",
  "token-link": "link",
  "token-inserted": "ins",
  "token-deleted": "del",
  "token-changed": "chg",
};

/** 与 createCssVariablesTheme 的 variablePrefix 一致 */
const COLOR_VAR_RE = /^var\(--yz-code-([a-z-]+)\)$/;

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> | null {
  if (highlighterPromise) return highlighterPromise;
  if (typeof window === "undefined") return null; // headless(测试)不初始化
  highlighterPromise = createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [
      // 占位主题:不产色,只驱动 tokenize 输出语义槽位名
      createCssVariablesTheme({
        name: "yz-code",
        variablePrefix: "--yz-code-",
        variableDefaults: {},
        fontStyle: false,
      }),
    ],
    langs: Object.values(LANG_IMPORTS).map((load) => load()),
  });
  return highlighterPromise;
}

function resolveLang(attr: unknown): string | null {
  const raw = typeof attr === "string" ? attr.trim().toLowerCase() : "";
  if (!raw) return null;
  const id = LANG_ALIAS[raw] ?? raw;
  return LANG_IMPORTS[id] ? id : null; // 未收录语言不高亮
}

/** token.color → 槽位 class;默认色/无法识别返回 null */
function slotClass(color: string): string | null {
  const slot = COLOR_VAR_RE.exec(color)?.[1];
  if (!slot) return null;
  return SLOT_CLASS[slot] ?? null;
}

function buildDecorations(
  doc: PMNode,
  highlighter: HighlighterCore | null,
): DecorationSet {
  if (!highlighter) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;
    const lang = resolveLang(node.attrs.language);
    if (!lang) return;
    let tokens: ReturnType<HighlighterCore["codeToTokensBase"]>;
    try {
      tokens = highlighter.codeToTokensBase(node.textContent, {
        lang,
        theme: "yz-code",
      });
    } catch {
      return; // 语法解析失败:退回无高亮,不影响编辑
    }
    const base = pos + 1; // codeBlock 内容起始
    for (const line of tokens) {
      for (const token of line) {
        const cls = slotClass(token.color ?? "");
        if (!cls) continue;
        const from = base + token.offset;
        decorations.push(
          Decoration.inline(from, from + token.content.length, {
            class: `yz-tok-${cls}`,
          }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const codeHighlightKey = new PluginKey("yzCodeHighlight");

interface CodeHighlightState {
  highlighter: HighlighterCore | null;
  decos: DecorationSet;
}

/** 代码高亮插件:doc 变化即重算(tokenize 同步、代码块通常少,量级安全) */
export function codeHighlightPlugin(): Plugin {
  return new Plugin({
    key: codeHighlightKey,
    state: {
      init: (): CodeHighlightState => ({
        highlighter: null,
        decos: DecorationSet.empty,
      }),
      apply(tr, prev, _oldState, newState): CodeHighlightState {
        // 高亮器就绪后经 meta 注入 plugin state,并触发一次全量重算
        const meta = tr.getMeta(codeHighlightKey) as
          | { highlighter?: HighlighterCore }
          | undefined;
        const highlighter = meta?.highlighter ?? prev.highlighter;
        if (meta || tr.docChanged) {
          return {
            highlighter,
            decos: buildDecorations(newState.doc, highlighter),
          };
        }
        return prev; // 位置未变的 transaction 直接沿用
      },
    },
    props: {
      decorations(state) {
        return codeHighlightKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
    view(view) {
      let alive = true;
      getHighlighter()?.then((highlighter) => {
        if (!alive) return;
        view.dispatch(view.state.tr.setMeta(codeHighlightKey, { highlighter }));
      });
      return {
        destroy() {
          alive = false;
        },
      };
    },
  });
}
