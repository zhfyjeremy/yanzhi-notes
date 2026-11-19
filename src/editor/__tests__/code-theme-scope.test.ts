/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/editor/editor.css", "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped} \\{[^}]+\\}`, "g").exec(css);
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

  it("Mermaid 图表外壳不吃代码主题,源码编辑区单独使用主题", () => {
    const shell = rule(".yz-editor-doc .yz-mmd-card");
    expect(shell).toContain("var(--foreground)");
    expect(shell).not.toContain("var(--code-bg");

    const source = rule(".yz-editor-doc .yz-code-editor");
    expect(source).toContain("var(--code-bg");
    expect(source).toContain("var(--code-fg");
    expect(source).toContain("var(--code-border");
  });
});
