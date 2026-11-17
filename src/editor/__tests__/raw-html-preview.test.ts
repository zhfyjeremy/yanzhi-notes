import { beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { setAssetResolver } from "../../kb/asset-src";
import { markdownToDoc } from "../markdown/parse";
import { getSchema } from "../markdown/schema";
import { docToMarkdown } from "../markdown/serialize";
import { sanitizeRawHtmlPreview } from "../extensions/raw-html-preview";
import { YanzhiEditor } from "../YanzhiEditor";

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

  it("HTML 注释以轻量注记显示且原文保留", async () => {
    const md = "前文\n\n<!-- BEGIN:turborepo-agent-rules -->\n\n后文\n";
    const doc = markdownToDoc(md, getSchema());
    const comment = doc.child(1);
    expect(comment?.type.name).toBe("rawHtml");
    expect(comment?.attrs.comment).toBe(true);
    expect(docToMarkdown(doc)).toBe(md);

    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(YanzhiEditor, { markdown: md }));
        await Promise.resolve();
      });
      const note = container.querySelector<HTMLElement>(".yz-html-comment");
      expect(note?.textContent).toContain("<!-- BEGIN:turborepo-agent-rules -->");
      expect(container.querySelector(".yz-raw-html-preview")).toBeNull();
      expect(container.textContent).toContain("后文");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
  it("独立线上 img 转原生图片节点", () => {
    const doc = markdownToDoc('<img src="https://example.com/a.png" alt="示例图" onerror="alert(1)">\n', getSchema());
    expect(doc.toString()).toContain("image");
    expect(doc.toString()).not.toContain("rawHtml");
    expect(docToMarkdown(doc)).toBe("![示例图](https://example.com/a.png)\n");
  });
  it("预览不改写磁盘上的 Raw HTML 原文", () => {
    const md = '<div class="x" onclick="alert(1)">HTML</div>\n';
    const doc = markdownToDoc(md, getSchema());
    const raw = doc.firstChild;
    expect(raw?.type.name).toBe("rawHtml");
    expect(String(raw?.attrs.content).trim()).toBe('<div class="x" onclick="alert(1)">HTML</div>');
    expect(docToMarkdown(doc)).toBe(md);
  });

  it("Raw HTML 直接渲染,不再提供块内源码模式", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          createElement(YanzhiEditor, {
            markdown: '<div><img src="https://example.com/a.png"></div>\n\nOther line',
          }),
        );
        await Promise.resolve();
      });

      const preview = container.querySelector<HTMLElement>(".yz-raw-html-preview");
      expect(preview).not.toBeNull();
      expect(container.querySelector(".yz-raw-html-source")).toBeNull();
      expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("源码"))).toBe(false);
      expect(container.textContent).toContain("Other line");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

});
