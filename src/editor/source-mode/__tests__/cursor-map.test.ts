import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { baseExtensions } from "../../extensions";
import { mdToHtml } from "../../markdown/md-instance";
import { docToMarkdown } from "../../markdown/serialize";
import {
  buildCursorMap,
  mdLineStart,
  mdOffsetToPmPos,
  pmPosToMdOffset,
} from "../cursor-map";

function editorOf(md: string): Editor {
  return new Editor({
    extensions: baseExtensions,
    content: mdToHtml(md),
  });
}

describe("cursor-map 块级映射", () => {
  it("标题+段落:PM 落在第二段 ↔ md 第二段行首互转", () => {
    const editor = editorOf("# 标题\n\n正文");
    const doc = editor.state.doc;
    const map = buildCursorMap(doc);
    expect(map.blocks.length).toBe(2);
    expect(map.md).toBe(docToMarkdown(doc));

    // 第二段「正文」内容起点
    let bodyPm: number | null = null;
    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "正文") {
        bodyPm = pos + 1;
        return false;
      }
      return true;
    });
    expect(bodyPm).not.toBeNull();

    const mdPos = pmPosToMdOffset(doc, bodyPm!);
    expect(map.md.slice(mdLineStart(map.md, mdPos))).toMatch(/^正文/);

    const back = mdOffsetToPmPos(doc, mdPos);
    const $back = doc.resolve(back);
    expect($back.parent.textContent).toBe("正文");
    editor.destroy();
  });

  it("列表项内光标映射到对应列表行", () => {
    const editor = editorOf("- a\n- b");
    const doc = editor.state.doc;
    let itemB: number | null = null;
    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "b") {
        itemB = pos + 1;
        return false;
      }
      return true;
    });
    expect(itemB).not.toBeNull();

    const mdPos = pmPosToMdOffset(doc, itemB!);
    const map = buildCursorMap(doc);
    const line = map.md.slice(mdLineStart(map.md, mdPos)).split("\n")[0]!;
    expect(line).toContain("b");

    const back = mdOffsetToPmPos(doc, mdPos);
    expect(doc.resolve(back).parent.textContent).toBe("b");
    editor.destroy();
  });

  it("代码块内光标落到代码块对应 md 区间", () => {
    const editor = editorOf("前\n\n```ts\nfoo\n```\n\n后");
    const doc = editor.state.doc;
    let inCode: number | null = null;
    doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock") {
        inCode = pos + 1 + 1; // 进到 'o' of foo 附近
        return false;
      }
      return true;
    });
    expect(inCode).not.toBeNull();

    const mdPos = pmPosToMdOffset(doc, inCode!);
    const map = buildCursorMap(doc);
    const block = map.blocks.find((b) => inCode! >= b.pmFrom && inCode! < b.pmTo);
    expect(block).toBeTruthy();
    expect(mdPos).toBeGreaterThanOrEqual(block!.mdFrom);
    expect(mdPos).toBeLessThanOrEqual(block!.mdTo);

    const back = mdOffsetToPmPos(doc, mdPos);
    expect(doc.resolve(back).parent.type.name).toBe("codeBlock");
    editor.destroy();
  });

  it("mdLineStart 回到行首", () => {
    expect(mdLineStart("ab\ncd\nef", 5)).toBe(3);
    expect(mdLineStart("ab\ncd", 0)).toBe(0);
  });
});
