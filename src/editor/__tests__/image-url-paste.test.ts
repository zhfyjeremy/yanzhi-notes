import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../extensions";
import { mdToHtml } from "../markdown/md-instance";
import {
  handleImageURLPaste,
  canLoadAsImage,
  imageURLFromClipboardText,
} from "../image-url-paste";

function clipboardEvent(text: string): ClipboardEvent {
  const event = new Event("paste", { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      files: [],
    },
  });
  return event;
}

function editorAtEnd(): Editor {
  const editor = new Editor({
    extensions: baseExtensions,
    content: mdToHtml("前文"),
  });
  editor.commands.setTextSelection(editor.state.doc.content.size);
  return editor;
}

function imageAttrs(editor: Editor): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") {
      attrs = node.attrs as Record<string, unknown>;
      return false;
    }
    return true;
  });
  return attrs;
}

describe("纯文本图片 URL 粘贴", () => {
  it("整段 http(s) 图片地址转为外链图片", () => {
    const editor = editorAtEnd();
    const handled = handleImageURLPaste(
      editor.view,
      clipboardEvent("  https://example.com/images/photo.PNG?size=large  "),
    );

    expect(handled).toBe(true);
    expect(imageAttrs(editor)).toMatchObject({
      src: "https://example.com/images/photo.PNG?size=large",
      alt: "photo",
    });
    editor.destroy();
  });

  it("识别 query 中携带图片格式的图床地址", () => {
    expect(imageURLFromClipboardText("https://example.com/mmbiz_png/abc?wx_fmt=png&from=19")).toBe(
      "https://example.com/mmbiz_png/abc?wx_fmt=png&from=19",
    );
  });

  it("代码块内不接管 URL 粘贴", () => {
    const editor = new Editor({
      extensions: baseExtensions,
      content: mdToHtml("```\n前文\n```"),
    });
    editor.commands.setTextSelection(editor.state.doc.content.size);
    const handled = handleImageURLPaste(
      editor.view,
      clipboardEvent("https://example.com/a.png"),
    );

    expect(handled).toBe(false);
    expect(imageAttrs(editor)).toBeNull();
    editor.destroy();
  });

  it("未知扩展名 URL 通过图片解码探测", async () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      referrerPolicy = "";
      decoding = "";
      _src = "";
      constructor() {}
      set src(value: string) {
        this._src = value;
        setTimeout(() => this.onload?.(), 0);
      }
      get src() {
        return this._src;
      }
    }

    await expect(
      canLoadAsImage("https://example.com/image?id=1", FakeImage as unknown as typeof Image, 100),
    ).resolves.toBe(true);
    expect(imageURLFromClipboardText("https://example.com/image?id=1")).toBeNull();
  });

  it("未知扩展名 URL 探测成功后替换正文中的同一段 URL", async () => {
    const src = "https://example.com/image?id=1";
    const editor = new Editor({
      extensions: baseExtensions,
      content: mdToHtml(src),
    });
    editor.commands.setTextSelection(editor.state.doc.content.size);

    try {
      const handled = handleImageURLPaste(
        editor.view,
        clipboardEvent(src),
        () => Promise.resolve(true),
      );
      // 全量并发时宏任务可能超过固定 20ms;轮询等待替换完成,避免时序型 flaky。
      for (let i = 0; i < 100 && !imageAttrs(editor); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(handled).toBe(false);
      expect(imageAttrs(editor)).toMatchObject({ src, alt: "image" });
    } finally {
      editor.destroy();
    }
  });

  it("普通 URL 保持原生粘贴语义", () => {
    const editor = editorAtEnd();
    const event = clipboardEvent("https://example.com/article");
    const handled = handleImageURLPaste(editor.view, event);

    expect(handled).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    editor.destroy();
  });

  it("混合文本与危险协议不识别为图片", () => {
    expect(imageURLFromClipboardText("看 https://example.com/a.png 这篇")).toBeNull();
    expect(imageURLFromClipboardText("javascript://example.com/a.png")).toBeNull();
    expect(imageURLFromClipboardText("data:image/png;base64,xxx")).toBeNull();
  });
});
