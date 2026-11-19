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

  it("Raw HTML 直接渲染,无块内预览/源码切换按钮", async () => {
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

  it("点击渲染内容 → 展开源码态;失焦 → 回到渲染视图", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom 没有 elementFromPoint:PM 的 posAtCoords 会崩(点击链路里的既有依赖)
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => null;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const md = "<p>可点文本</p>\n";
    try {
      await act(async () => {
        root.render(createElement(YanzhiEditor, { markdown: md }));
        await Promise.resolve();
      });

      const preview = container.querySelector<HTMLElement>(".yz-raw-html-preview");
      expect(preview).not.toBeNull();

      // 点击渲染区域 → 源码态(textarea 出现并聚焦)
      await act(async () => {
        preview!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
        );
        await Promise.resolve();
      });

      const source = container.querySelector<HTMLTextAreaElement>(".yz-raw-html-source");
      expect(source).not.toBeNull();
      expect(source!.value).toContain("可点文本");
      expect(document.activeElement).toBe(source);
      expect(container.querySelector(".yz-raw-html-preview")).toBeNull();

      // 失焦(点别处) → 回到渲染视图
      // React 的 onBlur 走原生 focusout(blur 不冒泡,React 不监听)
      await act(async () => {
        source!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        await Promise.resolve();
      });
      expect(container.querySelector(".yz-raw-html-source")).toBeNull();
      expect(container.querySelector(".yz-raw-html-preview")).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
      document.elementFromPoint = elementFromPoint;
    }
  });

  it("iframe 内部点击也能进源码态;HTML 源码高亮与输入层逐字对齐", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => null;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const md = '<p>第一行</p>\n<p>第二行</p>\n';
    try {
      await act(async () => {
        root.render(createElement(YanzhiEditor, { markdown: md }));
        await Promise.resolve();
      });

      const frame = container.querySelector<HTMLIFrameElement>(".yz-raw-html-preview iframe");
      // jsdom 不一定派发 iframe load;手动装入正文并触发 onLoad,验证 document 级监听
      frame!.contentDocument!.body.innerHTML = "<p>第一行</p><p>第二行</p>";
      await act(async () => {
        frame!.dispatchEvent(new Event("load"));
        await Promise.resolve();
      });


      expect(frame).not.toBeNull();
      const frameDoc = frame!.contentDocument;
      expect(frameDoc?.body).toBeTruthy();
      const hitElement = frameDoc!.querySelector("p");
      expect(hitElement).not.toBeNull();
      const scopedDoc = frameDoc as Document & {
        elementFromPoint?: (x: number, y: number) => Element | null;
      };
      scopedDoc.elementFromPoint = () => hitElement;

      // 浏览器里 iframe 内部 click 不冒泡到父文档;这里必须由 frame document 监听打开源码
      await act(async () => {
        frameDoc!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
        );
        await Promise.resolve();
      });

      const source = container.querySelector<HTMLTextAreaElement>(".yz-raw-html-source");
      expect(source).not.toBeNull();
      expect(source!.value).toContain("<p>第一行</p>");

      // 首次进入源码态会懒加载 html grammar;等高亮层补齐
      let layer: HTMLElement | null = null;
      for (let i = 0; i < 60; i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        layer = container.querySelector<HTMLElement>(".yz-highlight-source-layer");
        if (layer?.querySelector("[class*='yz-tok-tag']")) break;
      }
      expect(layer).not.toBeNull();
      expect(layer!.querySelector(".yz-tok-tag")).not.toBeNull();
      // Shiki token 不含换行;渲染层必须补换行,否则和 textarea 错位
      expect(layer!.textContent).toBe(source!.value);
    } finally {
      act(() => root.unmount());
      container.remove();
      document.elementFromPoint = elementFromPoint;
    }
  });

  it("源码态编辑写回文档,序列化仍是原样 HTML", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => null;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const changes: string[] = [];
    const md = "<p>可点文本</p>\n";
    try {
      await act(async () => {
        root.render(
          createElement(YanzhiEditor, {
            markdown: md,
            onMarkdownChange: (next: string) => changes.push(next),
          }),
        );
        await Promise.resolve();
      });

      const preview = container.querySelector<HTMLElement>(".yz-raw-html-preview");
      await act(async () => {
        preview!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
        );
        await Promise.resolve();
      });

      const source = container.querySelector<HTMLTextAreaElement>(".yz-raw-html-source");
      expect(source).not.toBeNull();

      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        )!.set!;
        setter.call(source!, "<p>改过了</p>");
        source!.dispatchEvent(new Event("input", { bubbles: true }));
        await Promise.resolve();
      });

      expect(source!.value).toBe("<p>改过了</p>");

      // 编辑器 300ms 去抖后回调新正文:HTML 原样写出,无多余转义
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(changes[changes.length - 1]).toBe("<p>改过了</p>\n");
    } finally {
      act(() => root.unmount());
      container.remove();
      document.elementFromPoint = elementFromPoint;
    }
  });

  it("改过的 HTML 再解析回来仍是同一段原文(往返稳定)", () => {
    const edited = '<h1 align="center">改过的标题</h1>\n';
    const doc = markdownToDoc(edited, getSchema());
    const raw = doc.firstChild;
    expect(raw?.type.name).toBe("rawHtml");
    expect(String(raw?.attrs.content)).toContain('<h1 align="center">改过的标题</h1>');
    expect(docToMarkdown(doc)).toBe(edited);
  });

});
