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

  it("exports the selected offline code theme as self-contained CSS", async () => {
    const style = document.createElement("style");
    style.textContent = `[data-code-theme="one-dark-pro"] {
      --code-bg: #282c34;
      --code-fg: #abb2bf;
      --code-kw: #c678dd;
      --code-tag: #e06c75;
      --code-attr: #d19a66;
    }`;
    document.head.append(style);
    const html = await buildExportHtml({
      md: "```html\n<div class=\"x\">hi</div>\n```",
      title: "Theme",
      docRel: "notes/theme.md",
      readAssetBase64: async () => null,
      codeTheme: "one-dark-pro",
    });

    expect(html).toContain('<html lang="zh" data-code-theme="one-dark-pro">');
    expect(html).toContain("--code-bg: #282c34;");
    expect(html).toContain(".yz-tok-tag { color: var(--code-tag); }");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("pre")?.getAttribute("style")).toContain("background: rgb(40, 44, 52)");
    style.remove();
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

  it("exports a left outline sidebar with anchors for headings", async () => {
    const html = await buildExportHtml({
      md: ["# 总标题", "", "## 一级节", "", "正文内容", "", "### 二级小节", "", "更多正文"].join("\n"),
      title: "Outline",
      docRel: "notes/outline.md",
      readAssetBase64: async () => null,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    const toc = doc.querySelector("nav.yz-toc");
    expect(toc).not.toBeNull();
    expect(toc?.getAttribute("aria-label")).toBe("文档大纲");

    const links = Array.from(toc?.querySelectorAll<HTMLAnchorElement>("a.yz-toc-link") ?? []);
    expect(links.map((link) => link.textContent)).toEqual([
      "总标题",
      "一级节",
      "二级小节",
    ]);

    // 每个大纲条目都要能跳到对应的正文标题(锚点 id 写进标题元素)
    for (const link of links) {
      const target = link.getAttribute("href") ?? "";
      expect(target.startsWith("#")).toBe(true);
      const id = target.slice(1);
      expect(doc.getElementById(id)?.tagName).toMatch(/^H[1-6]$/);
    }

    // 层级缩进:H1/H2/H3 逐级右移
    const paddings = links.map((link) => parseInt(link.style.paddingLeft, 10));
    expect(paddings[0]).toBeLessThan(paddings[1] as number);
    expect(paddings[1]).toBeLessThan(paddings[2] as number);

    // 正文与大纲同处两栏容器
    expect(doc.querySelector(".yz-layout > nav.yz-toc")).not.toBeNull();
    expect(doc.querySelector(".yz-layout > article.yz-content")).not.toBeNull();
    expect(html).toContain("<script>");
  });

  it("omits the outline when the document has no headings", async () => {
    const html = await buildExportHtml({
      md: "只有一段正文,没有标题。",
      title: "NoHeading",
      docRel: "notes/plain.md",
      readAssetBase64: async () => null,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("nav.yz-toc")).toBeNull();
    expect(doc.querySelector(".yz-layout.yz-layout-solo article.yz-content")).not.toBeNull();
    expect(html).not.toContain("<script>");
  });

  it("can omit the export outline and PDF bookmarks", async () => {
    const html = await buildExportHtml({
      md: "# 章节甲\n\n正文\n\n## 小节乙\n\n内容",
      title: "NoOutline",
      docRel: "notes/no-outline.md",
      readAssetBase64: async () => null,
      includeOutline: false,
      pdfBookmarks: true,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("nav.yz-toc")).toBeNull();
    expect(doc.querySelector(".yz-layout.yz-layout-solo article.yz-content")).not.toBeNull();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("YZ-PDF-BM");
  });

  it("hides the outline in the print stylesheet", async () => {
    const html = await buildExportHtml({
      md: "# 标题\n\n正文",
      title: "Print",
      docRel: "notes/print.md",
      readAssetBase64: async () => null,
    });

    // 打印/导 PDF 只留正文:@media print 必须能盖住两栏布局。
    const printBlock = html.slice(html.indexOf("@media print"));
    expect(printBlock).toContain(".yz-toc { display: none !important; }");
    expect(printBlock).toContain(".yz-layout { display: block !important;");
    // @media print 必须排在基础规则之后,否则同优先级下会被后写的 .yz-layout 覆盖
    expect(html.indexOf("@media print")).toBeGreaterThan(html.indexOf(".yz-layout {"));
  });

  it("补文档标题:正文没有同名 H1 时在顶部加标题横幅", async () => {
    const html = await buildExportHtml({
      md: "正文内容",
      title: "我的文档",
      docRel: "notes/titled.md",
      readAssetBase64: async () => null,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    const banner = doc.querySelector("h1.yz-doc-title");
    expect(banner?.textContent).toBe("我的文档");
    // 标题在正文最前面(inlineStyles 会套一层 div,banner 在这层之内)
    const content = doc.querySelector(".yz-content");
    expect(content?.firstElementChild?.firstElementChild?.className).toBe("yz-doc-title");
  });

  it("正文已有同名 H1 时不重复加标题横幅", async () => {
    const html = await buildExportHtml({
      md: "# 我的文档\n\n正文内容",
      title: "我的文档",
      docRel: "notes/titled2.md",
      readAssetBase64: async () => null,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("h1.yz-doc-title")).toBeNull();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
  });

  it("PDF 导出注入书签标记,HTML 导出不注入", async () => {
    const md = "# 章节甲\n\n正文\n\n## 小节乙\n\n内容";
    const base = {
      title: "测试文档",
      docRel: "notes/bookmark.md",
      readAssetBase64: async () => null,
    };

    const pdfHtml = await buildExportHtml({ ...base, md, pdfBookmarks: true });
    const pdfDoc = new DOMParser().parseFromString(pdfHtml, "text/html");
    const markers = Array.from(pdfDoc.querySelectorAll(".yz-bm-marker")).map(
      (m) => m.textContent,
    );
    // 标题横幅(文档名)也是 h1,排第一;正文标题按文档序排列
    expect(markers).toEqual([
      "[[YZ-PDF-BM:1:0|测试文档]]",
      "[[YZ-PDF-BM:1:1|章节甲]]",
      "[[YZ-PDF-BM:2:2|小节乙]]",
    ]);
    // 回归:overflow:hidden 会把标记从打印文本层裁掉,导致 PDF 书签缺失。
    // 标记必须透明绝对定位,且不能被裁剪/换行。
    for (const marker of pdfDoc.querySelectorAll<HTMLElement>(".yz-bm-marker")) {
      expect(marker.parentElement?.style.position).toBe("relative");
      expect(marker.style.position).toBe("absolute");
      expect(marker.style.color).toBe("transparent");
      expect(marker.style.whiteSpace).toBe("nowrap");
      expect(marker.style.overflow).toBe("");
    }

    const htmlExport = await buildExportHtml({ ...base, md });
    expect(htmlExport).not.toContain("YZ-PDF-BM");
  });

  it("标题横幅不进大纲(它是文档名,不是章节)", async () => {
    const html = await buildExportHtml({
      md: "正文内容\n\n## 章节一",
      title: "我的文档",
      docRel: "notes/titled3.md",
      readAssetBase64: async () => null,
    });

    const doc = new DOMParser().parseFromString(html, "text/html");
    const links = Array.from(doc.querySelectorAll(".yz-toc-link")).map((l) => l.textContent);
    expect(links).toEqual(["章节一"]);
    expect(doc.querySelector("h1.yz-doc-title")).not.toBeNull();
  });
});
