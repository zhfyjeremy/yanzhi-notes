import { describe, expect, it } from "vitest";
import { codeHighlightPlugin, codeHighlightKey } from "../extensions/code-highlight";

/**
 * 高亮插件可创建;语言懒加载的具体契约见 code-highlight.ts 头注
 * (langs: [] + loadLanguage,禁止 Object.values(LANG_IMPORTS) 一次拉齐)。
 */
describe("代码高亮懒加载", () => {
  it("插件可挂载且带稳定 plugin key", () => {
    const plugin = codeHighlightPlugin();
    expect(plugin.spec.key).toBe(codeHighlightKey);
  });
});
