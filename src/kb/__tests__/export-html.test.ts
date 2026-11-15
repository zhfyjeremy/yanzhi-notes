import { beforeEach, describe, expect, it } from "vitest";

beforeEach(() => {
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 100, height: 30 }) as DOMRect;
});
import { buildExportHtml } from "../export-html";

describe("HTML export", () => {
  it("reuses editor Shiki tokens in exported code blocks", async () => {
    const html = await buildExportHtml({
      md: '```ts\nconst message = "hello"; // note\n```',
      title: "Code",
      docRel: "notes/code.md",
      readAssetBase64: async () => null,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    const code = doc.querySelector("pre > code");
    expect(code?.textContent).toBe('const message = "hello"; // note\n');
    expect(code?.querySelector(".yz-tok-kw")?.textContent).toContain("const");
    expect(code?.querySelector(".yz-tok-emb")?.textContent).toContain("hello");
    expect(code?.querySelector(".yz-tok-cm")?.textContent).toContain("note");
    expect(html).toContain(".yz-tok-kw");
  });

  it("exports editor-rendered cards for diagrams, math, callouts, details, attachments and raw HTML", async () => {
    const html = await buildExportHtml({
      title: "Rich",
      docRel: "notes/rich.md",
      md: [
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "",
        "$$E=mc^2$$",
        "",
        "> [!INFO] 导出提示",
        "> 内容保持编辑器里的卡片形态",
        "",
        "<details open>",
        "<summary>折叠摘要</summary>",
        "",
        "折叠内容",
        "",
        "</details>",
        "",
        "[年度报告](./assets/report.pdf)",
        "",
        "![正文图片](./assets/photo.png)",
        "",
        '<div><img src="./assets/raw.png" alt="raw"></div>',
      ].join("\n"),
      readAssetBase64: async (rel) =>
        rel.endsWith("/photo.png") || rel.endsWith("/raw.png")
          ? { mime: "image/png", data: "aW1n" }
          : null,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector(".yz-mmd-svg svg")).not.toBeNull();
    expect(doc.querySelector(".yz-math-block .katex")).not.toBeNull();
    expect(html).toContain("@font-face");

    const callout = doc.querySelector(".yz-callout[data-callout='info']");
    expect(callout?.querySelector(".yz-callout-head svg")).not.toBeNull();
    expect(callout?.textContent).toContain("导出提示");

    const details = doc.querySelector<HTMLDetailsElement>("details.yz-details");
    expect(details?.open).toBe(true);
    expect(details?.querySelector("summary")?.textContent).toBe("折叠摘要");
    expect(details?.textContent).toContain("折叠内容");

    const attachment = doc.querySelector("a.yz-attachment-btn");
    expect(attachment?.getAttribute("href")).toBe("./assets/report.pdf");
    expect(attachment?.textContent).toContain("年度报告");

    const image = doc.querySelector("p img[src^='data:image/png;base64,']");
    expect(image?.getAttribute("alt")).toBe("正文图片");

    const rawFrame = doc.querySelector(".yz-raw-html-preview iframe");
    expect(rawFrame?.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(rawFrame?.getAttribute("srcdoc")).toContain("data:image/png;base64,aW1n");
    expect(rawFrame?.getAttribute("srcdoc")).not.toContain("<script");
  });
});
