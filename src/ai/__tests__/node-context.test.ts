import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { baseExtensions } from "../../editor/extensions";
import { mdToHtml } from "../../editor/markdown/md-instance";
import {
  codeBlockContextAt,
  extractLatex,
  resolveCodeBlockContext,
  stripCodeFence,
} from "../node-context";

function makeEditor(md: string): Editor {
  return new Editor({ extensions: baseExtensions, content: mdToHtml(md) });
}

describe("stripCodeFence / extractLatex", () => {
  it("剥围栏与公式定界符", () => {
    expect(stripCodeFence("```ts\nconst a = 1\n```")).toBe("const a = 1");
    expect(extractLatex("$$E=mc^2$$")).toBe("E=mc^2");
    expect(extractLatex("$a+b$")).toBe("a+b");
    expect(extractLatex("x^2")).toBe("x^2");
  });
});

describe("resolveCodeBlockContext", () => {
  it("光标在代码块内解析 language 与区间", () => {
    const editor = makeEditor("```js\nconsole.log(1)\n```\n");
    let codePos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") codePos = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, codePos)),
    );
    const ctx = resolveCodeBlockContext(editor);
    expect(ctx?.kind).toBe("codeBlock");
    expect(ctx?.language).toBe("js");
    expect(ctx?.text).toContain("console.log");
  });

  it("mermaid 块 kind 为 mermaid", () => {
    const editor = makeEditor("```mermaid\nflowchart TD\n  A-->B\n```\n");
    let codePos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") codePos = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, codePos)),
    );
    expect(resolveCodeBlockContext(editor)?.kind).toBe("mermaid");
  });

  it("多代码块时 codeBlockContextAt 只取指定那一块", () => {
    const editor = makeEditor("```js\nfirst()\n```\n\n```py\nsecond()\n```\n");
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") positions.push(pos);
    });
    expect(positions.length).toBe(2);
    const a = codeBlockContextAt(editor.state.doc, positions[0]);
    const b = codeBlockContextAt(editor.state.doc, positions[1]);
    expect(a?.text).toContain("first");
    expect(a?.text).not.toContain("second");
    expect(b?.text).toContain("second");
    expect(b?.text).not.toContain("first");
    expect(resolveCodeBlockContext(editor, positions[1])?.text).toContain("second");
  });
});
