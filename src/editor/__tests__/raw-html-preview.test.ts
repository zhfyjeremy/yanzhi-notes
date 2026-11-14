import { beforeEach, describe, expect, it } from "vitest";
import { setAssetResolver } from "../../kb/asset-src";
import { markdownToDoc } from "../markdown/parse";
import { getSchema } from "../markdown/schema";
import { docToMarkdown } from "../markdown/serialize";
import { sanitizeRawHtmlPreview } from "../extensions/raw-html-preview";

describe("Raw HTML 安全预览", () => {
  beforeEach(() => setAssetResolver(null));

  it("保留远程图片并移除脚本、事件与表单", () => {
    const html = `
      <div>
        <img src="https://example.com/a.png" onerror="alert(1)">
        <script>alert(2)</script>
        <form><input type="text"></form>
        <a href="javascript:alert(3)">x</a>
      </div>
    `;
    const result = sanitizeRawHtmlPreview(html);
    expect(result).toContain("https://example.com/a.png");
    expect(result).toContain('referrerpolicy="no-referrer"');
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<form");
    expect(result).not.toContain("javascript:");
  });

  it("本地相对图片走编辑器资源解析", () => {
    setAssetResolver((src) => (src === "./assets/a.png" ? "asset://mock/a.png" : src));
    const result = sanitizeRawHtmlPreview('<img src="./assets/a.png">');
    expect(result).toContain("asset://mock/a.png");
  });

  it("预览不改写磁盘上的 Raw HTML 原文", () => {
    const md = '<div class="x" onclick="alert(1)">HTML</div>\n';
    const doc = markdownToDoc(md, getSchema());
    const raw = doc.firstChild;
    expect(raw?.type.name).toBe("rawHtml");
    expect(String(raw?.attrs.content).trim()).toBe('<div class="x" onclick="alert(1)">HTML</div>');
    expect(docToMarkdown(doc)).toBe(md);
  });
});
