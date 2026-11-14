import { describe, expect, it } from "vitest";
import { renderMermaid } from "../../editor/extensions/mermaid";
import { mermaidSvgSize } from "../prepare";

describe("Mermaid 导出尺寸", () => {
  it("优先读取根节点 viewBox,不误取内部元素宽高", () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 1014px" viewBox="4 4 1014 190">
        <rect width="32" height="48"></rect>
      </svg>
    `;
    expect(mermaidSvgSize(svg)).toEqual({ width: 1014, height: 190 });
  });

  it("兼容根节点显式宽高", () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="670" height="527" viewBox="-50 -10 670 527"></svg>
    `;
    expect(mermaidSvgSize(svg)).toEqual({ width: 670, height: 527 });
  });
});

describe("Mermaid 运行时清理", () => {
  it("语法错误后清理 Mermaid 插入 body 的错误容器", async () => {
    await expect(renderMermaid("this is intentional invalid mermaid syntax", false)).rejects.toThrow();
    expect(
      Array.from(document.body.children).filter((el) => el.id.startsWith("dyz-mmd-")),
    ).toEqual([]);
  });
});
