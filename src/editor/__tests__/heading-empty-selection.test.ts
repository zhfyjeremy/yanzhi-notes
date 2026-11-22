import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/react";
import { baseExtensions } from "../extensions";

describe("空标题 IME 边界", () => {
  it("空标题 composition 提交到 paragraph 时恢复标题", async () => {
    vi.useFakeTimers();
    const editor = new Editor({ extensions: baseExtensions, content: "<p></p>" });
    editor.commands.setHeading({ level: 1 });
    editor.commands.setTextSelection(1);

    editor.view.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    // 模拟 WKWebView 把空标题上的提交映射成同级正文。
    editor.commands.setParagraph();
    editor.commands.insertContent("标题");
    editor.view.dispatchEvent(new CompositionEvent("compositionend", { data: "标题" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.textContent).toBe("标题");
    editor.destroy();
    vi.useRealTimers();
  });
});
