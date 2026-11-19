import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import { resolveCodeLanguage, shikiLanguageLoader } from "./shiki-langs";

/**
 * 代码高亮(PRD §5.3.8/§12):Shiki 离线、JS regex 引擎(同步 tokenize,无 wasm)、
 * 语言按需分包。token 色不取 Shiki 主题,而是借 css-variables theme 的
 * 语义槽位(token-keyword 等)归类,映射为 yz-tok-* class;颜色由 editor.css
 * 的 --code-* design token(:root/.dark 双值)决定,浅深主题自动一致。
 * 高亮以 PM inline decoration 实现,不参与文档模型与序列化。
 *
 * 语言表(2026-11-18):改为走 `shiki/langs` 官方注册表(shiki-langs.ts),
 * 覆盖全部 TextMate 语法(vue/svelte/astro/solidity/…),
 * 不再是手写的 24 条硬编码表——此前 `vue` 等语言完全不配色。
 *
 * 语言必须懒加载:注册表里每条都是 `() => import("@shikijs/langs/xxx")`,
 * 只加载当前文档出现过的语言;首开任意文档不会堵几百 ms。
 */

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

/**
 * markup 家族(HTML / Vue / JSX / XML 及其衍生)。
 *
 * 这类语言的 css-variables 主题把 `entity.name.tag`(标签名)与
 * `string.quoted`(属性值)都塞进 token-string-expression,和「字符串字面量」同色,
 * 标签名想跟字符串区分、属性名想跟函数名区分,必须看 TextMate scope。
 * 非 markup 语言没有这些 scope,规则不适用(保持原有配色不变)。
 */
const MARKUP_LANGUAGES = new Set([
  "html",
  "xml",
  "vue",
  "svelte",
  "astro",
  "jsx",
  "tsx",
  "handlebars",
  "haml",
  "pug",
  "erb",
  "marko",
]);

/**
 * markup 家族的 scope 二次归类(从最内层 scope 往外找)。
 * 只在 MARKUP_LANGUAGES 内生效。
 */
const MARKUP_SCOPE_CLASS: { match: RegExp; cls: string }[] = [
  // 标签名 entity.name.tag → 独立的 tag 色
  { match: /entity\.name\.tag/, cls: "tag" },
  // 属性名 entity.other.attribute-name → attr 色
  { match: /entity\.other\.attribute-name/, cls: "attr" },
  // 属性值字符串 → str(而不是 emb)
  { match: /string\.quoted\.(double|single)/, cls: "str" },
  // 插值 / 模板表达式 {{ }} → emb
  { match: /meta\.template\.expression/, cls: "emb" },
];

/** 与 createCssVariablesTheme 的 variablePrefix 一致 */
const COLOR_VAR_RE = /^var\(--yz-code-([a-z-]+)\)$/;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const langLoadPromises = new Map<string, Promise<void>>();
const loadedLangs = new Set<string>();

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
    langs: [], // 按文档出现的 language 再 loadLanguage
  });
  return highlighterPromise;
}

/**
 * 语言归一 + 「这份语言有语法吗」判定。
 * 返回 canonical id(如 `typescript` / `vue`);不识别返回 null(不高亮)。
 */
function resolveLang(attr: unknown): string | null {
  const id = resolveCodeLanguage(attr);
  if (!id) return null;
  return shikiLanguageLoader(id) ? id : null;
}

function collectDocLangs(doc: PMNode): string[] {
  const langs = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name !== "codeBlock") return;
    const lang = resolveLang(node.attrs.language);
    if (lang) langs.add(lang);
  });
  return [...langs];
}

function loadLang(highlighter: HighlighterCore, id: string): Promise<void> {
  if (loadedLangs.has(id)) return Promise.resolve();
  let pending = langLoadPromises.get(id);
  if (pending) return pending;
  const loader = shikiLanguageLoader(id);
  if (!loader) return Promise.resolve();
  pending = loader()
    .then((mod) =>
      highlighter.loadLanguage(mod.default as LanguageRegistration),
    )
    .then(() => {
      loadedLangs.add(id);
    })
    .finally(() => {
      langLoadPromises.delete(id);
    });
  langLoadPromises.set(id, pending);
  return pending;
}

/** token.color → 槽位 class;默认色/无法识别返回 null */
function slotClass(color: string): string | null {
  const slot = COLOR_VAR_RE.exec(color)?.[1];
  if (!slot) return null;
  return SLOT_CLASS[slot] ?? null;
}

/**
 * markup 家族的二次归类:按 scope 把「标签名 / 属性名 / 属性值」
 * 从 string-expression、function 里拆出来。
 */
function markupClass(
  scopes: readonly { scopeName: string }[] | undefined,
): string | null {
  if (!scopes?.length) return null;
  // 从最内层 scope 往外找:TextMate 越内层越具体
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const name = scopes[i].scopeName;
    for (const rule of MARKUP_SCOPE_CLASS) {
      if (rule.match.test(name)) return rule.cls;
    }
  }
  return null;
}

/** 一个高亮 token */
export interface HighlightToken {
  content: string;
  offset: number;
  /** yz-tok-* 语义后缀;null = 不着色 */
  cls: string | null;
}

type TokenLine = HighlightToken[];

/**
 * tokenize 一段代码 → 带 class 的 token 行。
 * 供 PM decoration(排版视图)与导出 HTML 复用。
 */
function tokenize(
  highlighter: HighlighterCore,
  source: string,
  lang: string,
): TokenLine[] | null {
  const isMarkup = MARKUP_LANGUAGES.has(lang);
  let lines: ReturnType<HighlighterCore["codeToTokensBase"]>;
  try {
    lines = highlighter.codeToTokensBase(source, {
      lang,
      theme: "yz-code",
      // explanation 只在 markup 家族需要(取 scope 二次归类),其余语言省掉这份开销
      includeExplanation: isMarkup,
    });
  } catch {
    return null; // 语法解析失败:退回无高亮,不影响编辑
  }
  return lines.map((line) =>
    line.map((token) => ({
      content: token.content,
      offset: token.offset,
      cls: isMarkup
        ? // markup 家族优先按 scope 归类:标签名/属性名在 css-variables 主题里
          // 与「字符串字面量」同槽位,不按 scope 分就区分不出来
          (markupClass(
            token.explanation?.[0]?.scopes as
              | readonly { scopeName: string }[]
              | undefined,
          ) ?? slotClass(token.color ?? ""))
        : slotClass(token.color ?? ""),
    })),
  );
}

/**
 * 导出 HTML 复用编辑器同一套 Shiki 引擎、语言分包与语义 token。
 * 高亮失败时保留纯文本,导出不能因此中断。
 */
export async function highlightCodeElements(root: ParentNode): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code"));
  const languages = new Set<string>();
  for (const code of blocks) {
    const raw = [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    const lang = resolveLang(raw);
    if (lang) languages.add(lang);
  }
  if (!blocks.length || !languages.size) return;

  const highlighter = await getHighlighter();
  if (!highlighter) return;
  await Promise.all([...languages].map((lang) => loadLang(highlighter, lang)));

  for (const code of blocks) {
    const raw = [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    const lang = resolveLang(raw);
    if (!lang || !loadedLangs.has(lang)) continue;

    const source = code.textContent ?? "";
    const lines = tokenize(highlighter, source, lang);
    if (!lines) continue;

    const doc = code.ownerDocument;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    const appendPlain = (to: number) => {
      if (to > cursor) {
        fragment.appendChild(doc.createTextNode(source.slice(cursor, to)));
      }
    };
    for (const line of lines) {
      for (const token of line) {
        appendPlain(token.offset);
        if (token.cls) {
          const span = doc.createElement("span");
          span.className = `yz-tok-${token.cls}`;
          span.textContent = token.content;
          fragment.appendChild(span);
        } else {
          fragment.appendChild(doc.createTextNode(token.content));
        }
        cursor = token.offset + token.content.length;
      }
    }
    appendPlain(source.length);
    code.replaceChildren(fragment);
  }
}

/**
 * HTML 源码高亮(供 Raw HTML 块的「源码态」使用)。
 * 首次调用会懒加载 html grammar;加载完成前返回 null(调用方退回纯文本)。
 */
export async function highlightHtmlSource(
  source: string,
): Promise<HighlightToken[][] | null> {
  if (typeof window === "undefined") return null;
  const highlighter = await getHighlighter();
  if (!highlighter) return null;
  await loadLang(highlighter, "html");
  if (!loadedLangs.has("html")) return null;
  return tokenize(highlighter, source, "html");
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
    if (!lang || !loadedLangs.has(lang)) return;
    const lines = tokenize(highlighter, node.textContent, lang);
    if (!lines) return;
    const base = pos + 1; // codeBlock 内容起始
    for (const line of lines) {
      for (const token of line) {
        if (!token.cls) continue;
        const from = base + token.offset;
        decorations.push(
          Decoration.inline(from, from + token.content.length, {
            class: `yz-tok-${token.cls}`,
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

/** 变更区间是否与旧文档某个代码块相交。普通段落 Tab/键入应返回 false。 */
function touchesCodeBlock(doc: PMNode, tr: Transaction): boolean {
  let hit = false;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.type.name !== "codeBlock") return true;
    const from = pos;
    const to = pos + node.nodeSize;
    for (const map of tr.mapping.maps) {
      map.forEach((oldStart, oldEnd) => {
        if (oldStart < to && oldEnd > from) hit = true;
      });
      if (hit) break;
    }
    return !hit;
  });
  return hit;
}

function countCodeBlocks(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === "codeBlock") n += 1;
  });
  return n;
}

/** 确保高亮器 + 文档所需语言就绪后打 meta 触发重算;无代码块则完全不初始化。 */
function scheduleHighlightSync(view: EditorView, alive: () => boolean): void {
  const langs = collectDocLangs(view.state.doc);
  if (!langs.length) return;
  void getHighlighter()?.then(async (highlighter) => {
    if (!alive()) return;
    await Promise.all(langs.map((id) => loadLang(highlighter, id)));
    if (!alive() || view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(codeHighlightKey, { highlighter }));
  });
}

/** 代码高亮插件:语言按需加载;仅代码块内容/数量变化时重 tokenize */
export function codeHighlightPlugin(): Plugin {
  return new Plugin({
    key: codeHighlightKey,
    state: {
      init: (): CodeHighlightState => ({
        highlighter: null,
        decos: DecorationSet.empty,
      }),
      apply(tr, prev, oldState, newState): CodeHighlightState {
        // 高亮器就绪 / 新语言到位后经 meta 注入,并触发一次全量重算
        const meta = tr.getMeta(codeHighlightKey) as
          | { highlighter?: HighlighterCore }
          | undefined;
        const highlighter = meta?.highlighter ?? prev.highlighter;
        if (meta) {
          return {
            highlighter,
            decos: buildDecorations(newState.doc, highlighter),
          };
        }
        if (!tr.docChanged) return prev;
        const codeTouched =
          touchesCodeBlock(oldState.doc, tr) ||
          countCodeBlocks(oldState.doc) !== countCodeBlocks(newState.doc);
        if (!codeTouched) {
          return {
            highlighter,
            decos: prev.decos.map(tr.mapping, newState.doc),
          };
        }
        return {
          highlighter,
          decos: buildDecorations(newState.doc, highlighter),
        };
      },
    },
    props: {
      decorations(state) {
        return codeHighlightKey.getState(state)?.decos ?? DecorationSet.empty;
      },
    },
    view(view) {
      let alive = true;
      const isAlive = () => alive && !view.isDestroyed;
      // 首帧后同步:让 setContent/点选先上屏,高亮异步补上
      const boot = window.requestAnimationFrame(() => {
        if (isAlive()) scheduleHighlightSync(view, isAlive);
      });
      return {
        update(v, prev) {
          if (prev.doc.eq(v.state.doc)) return;
          const langs = collectDocLangs(v.state.doc);
          if (!langs.length) return;
          const missing = langs.some((id) => !loadedLangs.has(id));
          const hasHighlighter = !!codeHighlightKey.getState(v.state)?.highlighter;
          if (missing || !hasHighlighter) scheduleHighlightSync(v, isAlive);
        },
        destroy() {
          alive = false;
          window.cancelAnimationFrame(boot);
        },
      };
    },
  });
}
