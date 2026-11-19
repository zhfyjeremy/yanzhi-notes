import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { YanzhiEditor } from "../YanzhiEditor";

/**
 * 代码块语言选择器 + 语法高亮(2026-11-18)。
 *
 * 回归点:
 * 1. `vue` 等此前不在硬编码语言表里的语言,必须能选、也能高亮;
 * 2. 语言选择器允许自定义输入(不在官方注册表里的名字也能写进 language 属性);
 * 3. markup 家族(HTML/Vue)的标签名、属性名要与字符串区分开。
 */
describe("代码块语言与高亮", () => {
  const roots: Root[] = [];
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom 没有 elementFromPoint:PM 的 posAtCoords 会崩(点击链路里的既有依赖)
    document.elementFromPoint = () => null;
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(() => {
    for (const root of roots) act(() => root.unmount());
    roots.length = 0;
    container.remove();
  });

  async function render(markdown: string) {
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(createElement(YanzhiEditor, { markdown }));
      await Promise.resolve();
    });
    // 等 Shiki 懒加载 grammar + decoration 补上
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      if (container.querySelector("[class*='yz-tok-']")) break;
    }
  }

  function tokenClasses(): string[] {
    return [...container.querySelectorAll<HTMLElement>(".yz-code-content [class*='yz-tok-']")]
      .map((el) => el.className.replace("yz-tok-", ""));
  }

  it("vue 代码块能高亮,标签名与属性名单独着色", async () => {
    await render(
      "```vue\n<template>\n  <div class=\"box\">hi</div>\n</template>\n```\n",
    );
    const classes = tokenClasses();
    expect(classes.length).toBeGreaterThan(0);
    // 标签名 → tag;属性名 → attr;属性值 → str
    expect(classes).toContain("tag");
    expect(classes).toContain("attr");
    expect(classes).toContain("str");
  });

  it("html 代码块能高亮", async () => {
    await render("```html\n<div class=\"x\">hi</div>\n```\n");
    const classes = tokenClasses();
    expect(classes.length).toBeGreaterThan(0);
    expect(classes).toContain("tag");
  });

  it("ts/js 等 alias 语言与 canonical 等价(都高亮)", async () => {
    await render("```ts\nconst a = 1;\n```\n");
    expect(tokenClasses().length).toBeGreaterThan(0);
  });

  it("语言选择器能搜到 vue 并可选中", async () => {
    await render("```js\nconst a = 1;\n```\n");
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择代码语言"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.click();
      await Promise.resolve();
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder*="搜索或输入"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input!, "vue");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    const options = [...document.querySelectorAll("button")].map((b) =>
      b.textContent?.trim() ?? "",
    );
    expect(options.some((text) => text.startsWith("vue"))).toBe(true);
  });

  it("自定义语言名可写入 language 属性(不限于内置列表)", async () => {
    const changes: string[] = [];
    await act(async () => {
      const root = createRoot(container);
      roots.push(root);
      root.render(
        createElement(YanzhiEditor, {
          markdown: "```js\nconst a = 1;\n```\n",
          onMarkdownChange: (next: string) => changes.push(next),
        }),
      );
      await Promise.resolve();
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="选择代码语言"]',
    );
    await act(async () => {
      trigger!.click();
      await Promise.resolve();
    });
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder*="搜索或输入"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input!, "my-lang");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    // 「自定义」分组里应有该项
    const customButton = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("my-lang"),
    );
    expect(customButton).toBeDefined();
    await act(async () => {
      customButton!.click();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(changes[changes.length - 1]).toContain("```my-lang");
  });
  it("代码主题挂在正文表面,切换无需重建 Shiki 语言状态", async () => {
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(YanzhiEditor, {
          markdown: "```ts\nconst a = 1;\n```\n",
          codeTheme: "one-dark-pro",
        }),
      );
      await Promise.resolve();
    });
    const surface = container.querySelector<HTMLElement>("[data-code-theme=\"one-dark-pro\"]");
    expect(surface).not.toBeNull();
  });

  it("Mermaid 预览外壳不套代码卡片主题,源码编辑区才套", async () => {
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(YanzhiEditor, {
          markdown: "```mermaid\ngraph TD\n  A --> B\n```",
          codeTheme: "one-dark-pro",
        }),
      );
      await Promise.resolve();
    });

    const previewCard = container.querySelector<HTMLElement>(".yz-mmd-card");
    expect(previewCard).not.toBeNull();
    expect(previewCard?.classList.contains("yz-code-card")).toBe(false);
    expect(container.querySelector(".yz-code-editor")).toBeNull();

    const sourceButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "源码");
    expect(sourceButton).toBeDefined();
    await act(async () => {
      sourceButton!.click();
      await Promise.resolve();
    });

    expect(container.querySelector(".yz-code-editor")).not.toBeNull();
    expect(container.querySelector(".yz-mmd-live")).not.toBeNull();
  });
});
