import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../../extensions";
import { mdToHtml } from "../../markdown/md-instance";
import { TocPanel } from "../TocPanel";
import type { MarkdownSourceOutlineController } from "../../source-mode/MarkdownSourceEditor";

describe("右侧大纲", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = () => undefined;
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
  });

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop()!;
      act(() => root.unmount());
    }
    document.body.innerHTML = "";
  });

  it("源码模式使用 CodeMirror 标题位置,点击后调用源码定位", async () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: mdToHtml("# One\n\n正文\n\n## Two"),
    });
    const scrollContainer = document.createElement("div");
    document.body.append(scrollContainer);
    const sourceLine = document.createElement("div");
    sourceLine.textContent = "## Two";
    scrollContainer.append(sourceLine);
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    const located: number[] = [];
    const sourceOutlineController: MarkdownSourceOutlineController = {
      headings: () => [
        { level: 1, text: "One", pos: 0 },
        { level: 2, text: "Two", pos: 16 },
      ],
      headingElement: (pos) => (pos === 16 ? sourceLine : null),
      locateHeading: (pos) => {
        located.push(pos);
        return pos === 16 ? sourceLine : null;
      },
    };

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        createElement(TocPanel, {
          editor,
          scrollContainer,
          sourceOutlineController,
        }),
      );
    });

    const item = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Two"),
    );
    expect(item).toBeTruthy();
    await act(async () => {
      item!.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(located).toEqual([16]);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    editor.destroy();
  });
});
