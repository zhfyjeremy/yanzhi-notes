import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { EditorView } from "@codemirror/view";
import { MarkdownSourceEditor } from "../MarkdownSourceEditor";
import { BASH_SAMPLE_MD, EDIT_SAMPLE_MD, HIGHLIGHT_SAMPLE_MD } from "./samples";

describe("CodeMirror Markdown 源码编辑器", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()!;
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
  });

  it("高亮 Markdown 标题、链接、代码、高亮与双链", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: HIGHLIGHT_SAMPLE_MD,
          onChange: () => undefined,
        }),
      );
    });

    expect(container.querySelector(".cm-md-h1")).not.toBeNull();
    expect(container.querySelector(".cm-md-link")).not.toBeNull();
    expect(container.querySelector(".cm-md-code")).not.toBeNull();
    expect(container.querySelector(".cm-md-highlight")).not.toBeNull();
    expect(container.querySelector(".cm-md-wikilink")).not.toBeNull();
    expect(container.querySelector(".cm-code-open-line")).not.toBeNull();
    // language-data 的 fenced parser 异步懒加载;等待真实 TS parser 产生变量/函数/类型标签。
    for (let i = 0; i < 50 && !container.querySelector(".cm-code-variable"); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(container.querySelector(".cm-code-keyword")).not.toBeNull();
    expect(container.querySelector(".cm-code-variable")).not.toBeNull();
    expect(container.querySelector(".cm-code-type")).not.toBeNull();
    expect(container.querySelector(".cm-code-string")).not.toBeNull();
    expect(container.querySelector(".cm-code-comment")).not.toBeNull();
  });

  it("Tab 在光标处插入四个空格,Shift+Tab 缩回行首缩进", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: "正文",
          onChange: () => undefined,
        }),
      );
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = EditorView.findFromDOM(content!);
    expect(view).not.toBeNull();
    // CodeMirror lineWrapping 以该 class 启用软折行;实际折行布局由浏览器执行。
    expect(content!.classList.contains("cm-lineWrapping")).toBe(true);
    // 默认落文首;本用例测「光标后插入」,先移到文末
    view!.dispatch({ selection: { anchor: view!.state.doc.length } });
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      cancelable: true,
    });
    content!.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(view!.state.doc.toString()).toBe("正文    ");
    view!.dispatch({ selection: { anchor: 0 } });

    const lineTab = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      cancelable: true,
    });
    content!.dispatchEvent(lineTab);
    expect(lineTab.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(view!.state.doc.toString()).toBe("    正文    ");

    const shiftTab = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      shiftKey: true,
      cancelable: true,
    });
    content!.dispatchEvent(shiftTab);
    expect(shiftTab.defaultPrevented).toBe(true);
    await act(async () => {});
    expect(view!.state.doc.toString()).toBe("正文    ");
  });

  it("Tab 缩进设置即时生效", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    const props = {
      value: "正文",
      onChange: () => undefined,
      indentSize: 4,
    };
    await act(async () => {
      root.render(createElement(MarkdownSourceEditor, props));
    });

    const content = container.querySelector<HTMLElement>(".cm-content")!;
    const view = EditorView.findFromDOM(content)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", cancelable: true }));
    await act(async () => {});
    expect(view.state.doc.toString()).toBe("正文    ");

    await act(async () => {
      root.render(createElement(MarkdownSourceEditor, { ...props, indentSize: 2 }));
    });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", code: "Tab", cancelable: true }));
    await act(async () => {});
    expect(view.state.doc.toString()).toBe("正文      ");
  });

  it("initialCursor 挂载时落在指定 offset", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: "# 标题\n\n正文\n",
          initialCursor: 7, // 「正文」行首附近
          onChange: () => undefined,
        }),
      );
    });
    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = EditorView.findFromDOM(content!);
    expect(view).not.toBeNull();
    const line = view!.state.doc.lineAt(view!.state.selection.main.head);
    expect(line.text).toContain("正文");
  });

  it("向外层大纲提供源码标题与定位能力", async () => {
    const controllerBox: {
      current: import("../MarkdownSourceEditor").MarkdownSourceOutlineController | null;
    } = { current: null };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: "# One\n\n正文\n\n## Two",
          onChange: () => undefined,
          onOutlineController: (controller) => {
            controllerBox.current = controller;
          },
        }),
      );
    });

    const controller = controllerBox.current;
    expect(controller).not.toBeNull();
    const headings = controller!.headings();
    expect(headings.map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: "One" },
      { level: 2, text: "Two" },
    ]);

    const second = headings[1]!;
    const element = controller!.locateHeading(second.pos);
    expect(element?.textContent).toBe("## Two");
    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = EditorView.findFromDOM(content!);
    expect(view!.state.selection.main.anchor).toBe(second.pos);

    await act(async () => root.unmount());
    roots.pop();
    expect(controllerBox.current).toBeNull();
  });

  it("Mod+/ 不触发 CodeMirror 注释命令", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: "正文",
          onChange: () => undefined,
        }),
      );
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = EditorView.findFromDOM(content!);
    expect(view).not.toBeNull();
    content!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        code: "Slash",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await act(async () => {});
    expect(view!.state.doc.toString()).toBe("正文");
  });


  it("bash fenced code 使用 Shell parser 多色高亮", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: BASH_SAMPLE_MD,
          onChange: () => undefined,
        }),
      );
    });

    // Shell parser 异步懒加载;等待变量名等 Shell 专属标签出现。
    for (let i = 0; i < 50 && !container.querySelector(".cm-code-variable"); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(container.querySelector(".cm-code-keyword")).not.toBeNull();
    expect(container.querySelector(".cm-code-string")).not.toBeNull();
    expect(container.querySelector(".cm-code-comment")).not.toBeNull();
    expect(container.querySelector(".cm-code-variable")).not.toBeNull();
  });
  it("编辑内容回调源码字符串,外部 value 变化时重载文档", async () => {
    const changes: string[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: EDIT_SAMPLE_MD,
          onChange: (value) => changes.push(value),
        }),
      );
    });

    const content = container.querySelector<HTMLElement>(".cm-content");
    const view = EditorView.findFromDOM(content!);
    expect(view).not.toBeNull();
    view!.dispatch({
      changes: { from: 0, to: view!.state.doc.length, insert: "changed" },
    });
    expect(changes).toContain("changed");

    await act(async () => {
      root.render(
        createElement(MarkdownSourceEditor, {
          value: "external",
          onChange: (nextValue) => changes.push(nextValue),
        }),
      );
    });
    expect(view!.state.doc.toString()).toBe("external");
  });
});
