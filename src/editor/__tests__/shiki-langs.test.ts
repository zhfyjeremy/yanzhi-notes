import { describe, expect, it } from "vitest";
import {
  isKnownCodeLanguage,
  resolveCodeLanguage,
  searchCodeLanguages,
  shikiLanguageLoader,
  ALL_CODE_LANGUAGE_OPTIONS,
} from "../extensions/shiki-langs";

/**
 * Shiki 语言注册表(2026-11-18):
 * 代码块此前只认手写的 24 条语言,`vue` 等一律不高亮(用户报的「代码块没颜色」)。
 * 现在走官方注册表,并允许自定义输入。
 */
describe("代码语言注册表", () => {
  it("官方注册表覆盖常用语言,含此前缺失的 vue/svelte", () => {
    expect(resolveCodeLanguage("vue")).toBe("vue");
    expect(resolveCodeLanguage("svelte")).toBe("svelte");
    expect(resolveCodeLanguage("typescript")).toBe("typescript");
    expect(resolveCodeLanguage("python")).toBe("python");
    expect(resolveCodeLanguage("html")).toBe("html");
  });

  it("alias 归一到 canonical id", () => {
    expect(resolveCodeLanguage("ts")).toBe("typescript");
    expect(resolveCodeLanguage("tsx")).toBe("tsx");
    expect(resolveCodeLanguage("js")).toBe("javascript");
    expect(resolveCodeLanguage("py")).toBe("python");
    expect(resolveCodeLanguage("yml")).toBe("yaml");
    expect(resolveCodeLanguage("md")).toBe("markdown");
    expect(resolveCodeLanguage("sh")).toBe("shellscript");
    expect(resolveCodeLanguage("c++")).toBe("cpp");
    expect(resolveCodeLanguage("c#")).toBe("csharp");
    expect(resolveCodeLanguage("dockerfile")).toBe("docker");
  });

  it("大小写与空白不敏感", () => {
    expect(resolveCodeLanguage("  VUE ")).toBe("vue");
    expect(resolveCodeLanguage("TypeScript")).toBe("typescript");
  });

  it("纯文本类不返回语言(不高亮)", () => {
    expect(resolveCodeLanguage("plaintext")).toBeNull();
    expect(resolveCodeLanguage("text")).toBeNull();
    expect(resolveCodeLanguage("txt")).toBeNull();
    expect(resolveCodeLanguage("")).toBeNull();
    expect(resolveCodeLanguage(null)).toBeNull();
    expect(resolveCodeLanguage(undefined)).toBeNull();
  });

  it("不认识的语言返回 null(不猜近似语法)", () => {
    expect(resolveCodeLanguage("not-a-real-language")).toBeNull();
    expect(isKnownCodeLanguage("not-a-real-language")).toBe(false);
    expect(isKnownCodeLanguage("vue")).toBe(true);
  });

  it("除产品特殊项外,每个 canonical id 都有可加载的 grammar", () => {
    const special = new Set(["plaintext"]);
    for (const option of ALL_CODE_LANGUAGE_OPTIONS) {
      if (special.has(option.value)) continue;
      expect(shikiLanguageLoader(option.value), `${option.value} 缺 loader`).not.toBeNull();
    }
  });

  it("plaintext 特殊项可搜索但不参与 Shiki 高亮;mermaid 来自官方注册表", () => {
    expect(searchCodeLanguages("plaintext")[0]?.value).toBe("plaintext");
    expect(searchCodeLanguages("mermaid")[0]?.value).toBe("mermaid");
    expect(resolveCodeLanguage("plaintext")).toBeNull();
    expect(resolveCodeLanguage("mermaid")).toBe("mermaid");
  });

  it("搜索命中 vue,精确匹配排最前", () => {
    const hits = searchCodeLanguages("vue").map((option) => option.value);
    expect(hits[0]).toBe("vue");
    expect(hits).toContain("vue-html");
  });

  it("搜索按 id / 展示名 / alias 都能命中", () => {
    expect(searchCodeLanguages("TypeScript")[0].value).toBe("typescript");
    expect(searchCodeLanguages("py").map((o) => o.value)).toContain("python");
    expect(searchCodeLanguages("golang").map((o) => o.value)).toContain("go");
  });

  it("空查询返回全量候选(供语言选择器滚动列表)", () => {
    const all = searchCodeLanguages("", 100000);
    expect(all.length).toBe(ALL_CODE_LANGUAGE_OPTIONS.length);
    expect(all.length).toBeGreaterThan(200); // 官方 242 canonical
  });
});
