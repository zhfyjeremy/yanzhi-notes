import { describe, expect, it } from "vitest";
import {
  docHasTitleHeading,
  mdHasTitleHeading,
  normalizeDocTitle,
  plainInline,
  withMdTitle,
} from "../doc-title";
import { markdownToDoc } from "@/editor/markdown/parse";
import { getSchema } from "@/editor/markdown/schema";

const schema = getSchema();

describe("导出文档标题", () => {
  it("规范化标题:去空白与 .md 后缀", () => {
    expect(normalizeDocTitle("  我的文档  ")).toBe("我的文档");
    expect(normalizeDocTitle("我的文档.md")).toBe("我的文档");
    expect(normalizeDocTitle("")).toBe("");
    expect(normalizeDocTitle(undefined)).toBe("");
  });

  it("剥掉行内 Markdown 修饰后再比较", () => {
    expect(plainInline("**粗体**")).toBe("粗体");
    expect(plainInline("`代码`")).toBe("代码");
    expect(plainInline("[链接](https://x.com)")).toBe("链接");
    expect(plainInline("[[文档名|显示名]]")).toBe("显示名");
    expect(plainInline("==高亮==")).toBe("高亮");
  });

  it("Markdown 正文已有同名 H1 时不重复加标题", () => {
    const md = "# 我的文档\n\n正文内容";
    expect(mdHasTitleHeading(md, "我的文档")).toBe(true);
    expect(withMdTitle(md, "我的文档")).toBe(md);
  });

  it("行尾 # 被 Markdown 吃掉时,标题判定仍与真实渲染一致", () => {
    // `# 笔记 #` 实际解析成「笔记」(ATX 闭合序列),按「笔记」判定才是对的
    expect(mdHasTitleHeading("# 笔记 #\n\n正文", "笔记")).toBe(true);
    expect(mdHasTitleHeading("# 笔记 #\n\n正文", "笔记 #")).toBe(false);
  });

  it("Markdown 正文没有同名 H1 时补一个 H1", () => {
    const result = withMdTitle("正文内容", "我的文档");
    expect(result.startsWith("# 我的文档\n\n")).toBe(true);
    expect(result).toContain("正文内容");
  });

  it("标题里的 # 会被转义,不会被 Markdown 吃掉", () => {
    // 行首的 # 是 ATX 标记,行尾的 # 是 ATX 闭合序列 —— 两种都会被吃掉
    const result = withMdTitle("正文", "C# 基础");
    expect(result.startsWith("# C\\# 基础")).toBe(true);

    const trailing = withMdTitle("正文", "笔记 #");
    expect(trailing.startsWith("# 笔记 \\#")).toBe(true);

    // 转义后重新解析,标题文本要和原文一致
    const doc = markdownToDoc(withMdTitle("正文", "C# 基础"), schema);
    expect(doc.textContent).toContain("C# 基础");
  });

  it("空标题不加标题", () => {
    expect(withMdTitle("正文", "")).toBe("正文");
    expect(withMdTitle("正文", "   ")).toBe("正文");
  });

  it("PM doc 已有同名 H1 时识别得出来", () => {
    const doc = markdownToDoc("# 我的文档\n\n正文", schema);
    expect(docHasTitleHeading(doc, "我的文档")).toBe(true);
    const doc2 = markdownToDoc("## 二级标题\n\n正文", schema);
    expect(docHasTitleHeading(doc2, "我的文档")).toBe(false);
  });
});
