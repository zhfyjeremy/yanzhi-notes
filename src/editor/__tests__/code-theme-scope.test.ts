/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/editor/editor.css", "utf8");

function rule(selector: string): string {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]+\\}`, "g").exec(css);
  expect(match, `${selector} 规则缺失`).not.toBeNull();
  return match![0];
}

describe("代码主题作用域", () => {
  it("行内 code 不吃 fenced 代码块主题,避免深色主题下出现黑字深底", () => {
    const inlineCode = rule(".yz-editor-doc :not(pre) > code");
    expect(inlineCode).toContain("var(--inline-code-bg");
    expect(inlineCode).not.toContain("var(--code-bg");

    for (const match of css.match(/\.yz-source-editor \.cm-md-code \{[^}]+\}/g) ?? []) {
      expect(match).toContain("var(--source-inline-code)");
      expect(match).not.toContain("var(--code-str)");
    }
  });

  it("Markdown 源码模式的 fenced 代码块继续使用代码主题", () => {
    const fence = css.match(/\.yz-source-editor \.cm-code-fence-line,\s*\.yz-source-editor \.cm-code-content-line \{[^}]+\}/)?.[0] ?? "";
    expect(fence, "fenced 代码块规则缺失").toContain("var(--code-bg");
    expect(fence).toContain("var(--code-border");
  });
});
