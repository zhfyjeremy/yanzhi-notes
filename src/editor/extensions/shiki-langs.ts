import { bundledLanguages, bundledLanguagesInfo } from "shiki/langs";

/**
 * Shiki 语言注册表(2026-11-18):代码块不再只认手写的一小撮语言。
 *
 * 之前 `LANG_IMPORTS` 是 24 个字面量 import 的硬编码表,任何不在表里的语言
 * (如 `vue`)都不高亮——用户看到的就是「代码块没有颜色」。现在改成:
 *
 * 1. 语言表来自 `shiki/langs` 官方注册表(canonical 242 条 + alias 104 条),
 *    覆盖 vue / svelte / astro / solidity / zig … 等全部 TextMate 语法。
 * 2. **仍然懒加载**:注册表每个条目都是 `() => import("@shikijs/langs/xxx")`,
 *    Vite 只把文档里真正出现的语言打成独立 chunk,首开不堵。
 * 3. alias(ts/tsx/js/sh/py/yml/md/c++/c# …)归一到 canonical id,
 *    保证 `\`\`\`ts` 与 `\`\`\`typescript` 走同一份 grammar。
 *
 * 语义:canonical id 是「这份语法叫什么」,alias 是「用户会怎么写」。
 * `resolveCodeLanguage()` 返回 null 表示「不识别 → 不高亮」。
 */

/** 官方注册表条目 */
export interface ShikiLanguageInfo {
  id: string;
  name: string;
  aliases?: string[];
}

/** 全部 canonical 语言信息(展示名 + alias),供语言选择器使用 */
export const SHIKI_LANGUAGES: ShikiLanguageInfo[] = bundledLanguagesInfo.map(
  (entry) => ({
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases ? [...entry.aliases] : undefined,
  }),
);

/** alias(小写) → canonical id */
const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const entry of bundledLanguagesInfo) {
    for (const alias of entry.aliases ?? []) {
      map[alias.toLowerCase()] = entry.id;
    }
  }
  return map;
})();

/** canonical id → 官方展示名 */
const CANONICAL_NAME: Record<string, string> = Object.fromEntries(
  bundledLanguagesInfo.map((entry) => [entry.id, entry.name]),
);

/**
 * 无需高亮的语言(纯文本类)。
 * 显式列出,避免「识别不到就退化成猜一个语法」。
 */
const PLAIN_LANGUAGES = new Set([
  "plaintext",
  "plain",
  "text",
  "txt",
  "none",
  "nopreview",
  "no-highlight",
]);

/**
 * 用户常写、但官方注册表没有独立条目的别名。
 * 全部指向确实存在且有 grammar 的 canonical id。
 */
const EXTRA_ALIAS: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  py: "python",
  python3: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  sh: "shellscript",
  bash: "shellscript",
  shell: "shellscript",
  zsh: "shellscript",
  console: "shellsession",
  ps1: "powershell",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  xhtml: "html",
  cs: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  objc: "objective-c",
  docker: "docker",
  dockerfile: "docker",
  golang: "go",
  postgres: "sql",
  postgresql: "sql",
  mysql: "sql",
  psql: "sql",
  sqlite: "sql",
  sfc: "vue",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
};

/**
 * 归一语言名 → canonical id。
 * 返回 null 表示「不识别」:调用方应当放弃高亮,而不是猜一个近似语法。
 */
export function resolveCodeLanguage(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!value) return null;
  if (PLAIN_LANGUAGES.has(value)) return null;
  // 官方 alias 优先(TextMate 官方维护,最权威)
  const official = ALIAS_TO_CANONICAL[value];
  if (official) return official;
  const extra = EXTRA_ALIAS[value];
  if (extra) return extra;
  if (CANONICAL_NAME[value]) return value;
  return null;
}

/** 语言名是否被识别(能高亮) */
export function isKnownCodeLanguage(raw: unknown): boolean {
  return resolveCodeLanguage(raw) !== null;
}

/**
 * 语言 id → Shiki 懒加载器。
 * `bundledLanguages` 的 key 既含 canonical id 也含 alias;
 * 加载 alias 包时 Shiki 会一并注册对应的 canonical grammar。
 */
export function shikiLanguageLoader(
  id: string,
): (() => Promise<{ default: unknown }>) | null {
  const loader = (bundledLanguages as Record<string, unknown>)[id];
  if (typeof loader !== "function") return null;
  return loader as () => Promise<{ default: unknown }>;
}

/** 语言显示名;未知语言回退为原样小写名 */
export function codeLanguageLabel(id: string): string {
  return CANONICAL_NAME[id] ?? id;
}

/**
 * 额外的搜索别名(官方注册表没收录,但用户常这么搜)。
 * 只影响**搜索命中**,不改变写入 language 属性的值。
 */
const EXTRA_SEARCH_KEYWORDS: Record<string, string[]> = {
  go: ["golang"],
  python: ["py", "python3"],
  javascript: ["js", "node", "ecmascript"],
  typescript: ["ts"],
  ruby: ["rb"],
  rust: ["rs"],
  kotlin: ["kt"],
  shellscript: ["bash", "sh", "shell", "zsh"],
  yaml: ["yml"],
  markdown: ["md"],
  html: ["htm", "xhtml"],
  csharp: ["cs", "c#"],
  cpp: ["c++"],
  sql: ["mysql", "postgres", "postgresql", "sqlite", "psql"],
  docker: ["dockerfile"],
  vue: ["vue3", "sfc"],
  json: ["jsonc", "json5"],
};

/** 语言选择器候选项 */
export interface CodeLanguageOption {
  /** 写入代码块 language 属性的值(canonical id) */
  value: string;
  /** 展示名(官方英文名) */
  label: string;
  /** 搜索关键字(id + alias + 常见口语写法) */
  keywords: string[];
}

/**
 * Shiki 注册表之外的产品内置项:
 * - plaintext 是代码块默认值/用户显式选择纯文本的入口;mermaid 官方注册表已自带语法。
 */
const SPECIAL_LANGUAGE_OPTIONS: CodeLanguageOption[] = [
  {
    value: "plaintext",
    label: "Plain Text",
    keywords: ["plaintext", "plain", "text", "txt", "纯文本"],
  },
];

const CODE_LANGUAGE_OPTIONS: CodeLanguageOption[] = [
  ...SPECIAL_LANGUAGE_OPTIONS,
  ...bundledLanguagesInfo.map((entry) => ({
    value: entry.id,
    label: entry.name,
    keywords: [
      entry.id,
      ...(entry.aliases ?? []),
      ...(EXTRA_SEARCH_KEYWORDS[entry.id] ?? []),
    ],
  })),
];

/** 全量语言候选:产品内置特殊项 + Shiki 官方注册表 */
export const ALL_CODE_LANGUAGE_OPTIONS: readonly CodeLanguageOption[] =
  CODE_LANGUAGE_OPTIONS;

/**
 * 搜索语言:按 id / 展示名 / alias 模糊匹配,精确命中排最前。
 * 供代码块语言选择器与「自定义输入」兜底项共用。
 */
export function searchCodeLanguages(query: string, limit = 60): CodeLanguageOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return CODE_LANGUAGE_OPTIONS.slice(0, limit);
  const hits: { option: CodeLanguageOption; score: number }[] = [];
  for (const option of CODE_LANGUAGE_OPTIONS) {
    let score = -1;
    for (const keyword of option.keywords) {
      const k = keyword.toLowerCase();
      if (k === q) {
        score = 0;
        break;
      }
      if (k.startsWith(q)) score = score < 0 ? 1 : score;
      else if (k.includes(q)) score = score < 0 ? 2 : score;
    }
    if (score !== 0 && option.label.toLowerCase().startsWith(q)) score = 1;
    if (score >= 0) hits.push({ option, score });
  }
  hits.sort(
    (a, b) => a.score - b.score || a.option.label.localeCompare(b.option.label),
  );
  return hits.slice(0, limit).map((hit) => hit.option);
}
