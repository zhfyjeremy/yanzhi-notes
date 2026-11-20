declare function execFileSync(
  command: string,
  args: string[],
  options: { input: string; maxBuffer: number },
): Uint8Array;

import { describe, expect, it } from "vitest";
import attachment from "@/editor/markdown/__tests__/fixtures/attachment.md?raw";
import basic from "@/editor/markdown/__tests__/fixtures/basic.md?raw";
import callout from "@/editor/markdown/__tests__/fixtures/callout.md?raw";
import code from "@/editor/markdown/__tests__/fixtures/code.md?raw";
import details from "@/editor/markdown/__tests__/fixtures/details.md?raw";
import dialect from "@/editor/markdown/__tests__/fixtures/dialect.md?raw";
import lists from "@/editor/markdown/__tests__/fixtures/lists.md?raw";
import mermaid from "@/editor/markdown/__tests__/fixtures/mermaid.md?raw";
import unknownHtml from "@/editor/markdown/__tests__/fixtures/unknown-html.md?raw";
import math from "@/editor/markdown/__tests__/fixtures/math.md?raw";
import tables from "@/editor/markdown/__tests__/fixtures/tables.md?raw";
import { markdownToDoc } from "@/editor/markdown/parse";
import { getSchema } from "@/editor/markdown/schema";
import { pmDocToPandocAst } from "../pandoc-ast";

const schema = getSchema();
const mermaidDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

const options = {
  remoteImages: "embed" as const,
  resolveWikiTarget: (target: string) =>
    target === "目标" || target === "双链" ? `/knowledge-base/${target}.md` : null,
  renderMermaid: async () => mermaidDataUrl,
};

describe("PM doc → Pandoc AST", () => {
  it("保留基础 Markdown 语义", async () => {
    const { ast } = await pmDocToPandocAst(markdownToDoc(basic, schema), options);
    const json = JSON.stringify(ast);
    expect(json).toContain('"Header"');
    expect(json).toContain('"BlockQuote"');
    expect(json).toContain('"HorizontalRule"');
  });

  it("行内代码内容完整保留,箭头两侧不丢失", async () => {
    const markdown = [
      "- `beforeCreate`===>`setup()`",
      "- `created`======>`setup()`",
      "- `beforeUnmount`==>`onBeforeUnmount`",
    ].join("\n");
    const { ast } = await pmDocToPandocAst(markdownToDoc(markdown, schema), options);
    const json = JSON.stringify(ast);
    for (const text of ["beforeCreate", "setup()", "created", "beforeUnmount", "onBeforeUnmount", "===>", "======>", "==>"]) {
      expect(json).toContain(text);
    }
  });

  it("保留公式、双链、任意文字颜色与 Mermaid 渲染图", async () => {
    const { ast, warnings, stats } = await pmDocToPandocAst(markdownToDoc(dialect, schema), options);
    const json = JSON.stringify(ast);
    expect(json).toContain('"InlineMath"');
    expect(json).toContain("/knowledge-base/双链.md");
    expect(json).toContain('w:color w:val=\\"E05C5C\\"');
    expect(json).toContain(mermaidDataUrl);
    expect(stats.mermaidRendered).toBe(1);
    expect(warnings.some((w) => w.kind === "wiki-link")).toBe(false);
  });

  it("块级公式走 Pandoc Math,不依赖 Markdown 二次解析", async () => {
    const { ast } = await pmDocToPandocAst(markdownToDoc(math, schema), options);
    const json = JSON.stringify(ast);
    expect(json).toContain('"InlineMath"');
    expect(json).toContain('"DisplayMath"');
  });

  it("Callout / Details 使用命名样式降级", async () => {
    const calloutResult = await pmDocToPandocAst(markdownToDoc(callout, schema), options);
    const detailsResult = await pmDocToPandocAst(markdownToDoc(details, schema), options);
    const calloutJson = JSON.stringify(calloutResult.ast);
    const detailsJson = JSON.stringify(detailsResult.ast);
    expect(calloutJson).toContain("YanzhiCalloutInfoTitle");
    expect(calloutJson).toContain("YanzhiCalloutCaution");
    expect(calloutResult.stats.callouts).toBeGreaterThan(0);
    expect(detailsJson).toContain("YanzhiDetailsTitle");
    expect(detailsJson).toContain("YanzhiDetailsBody");
    expect(detailsResult.stats.details).toBeGreaterThan(0);
  });

  it("表格保留对齐", async () => {
    const { ast } = await pmDocToPandocAst(markdownToDoc(tables, schema), options);
    const json = JSON.stringify(ast);
    expect(json).toContain('"AlignLeft"');
    expect(json).toContain('"AlignCenter"');
    expect(json).toContain('"AlignRight"');
    expect(json).toContain('"Table"');
  });

  it("文档标题走 Pandoc title metadata(渲染成顶部 Title 段落)", async () => {
    const { ast } = await pmDocToPandocAst(markdownToDoc("正文内容", schema), {
      ...options,
      title: "我的文档",
    });
    expect(ast.meta.title).toEqual({ t: "MetaInlines", c: [{ t: "Str", c: "我的文档" }] });
  });

  it("正文已有同名 H1 时不重复加标题 metadata", async () => {
    const { ast } = await pmDocToPandocAst(markdownToDoc("# 我的文档\n\n正文内容", schema), {
      ...options,
      title: "我的文档",
    });
    expect(ast.meta.title).toBeUndefined();
  });

  it("不传标题时不加 title metadata", async () => {
    const { ast } = await pmDocToPandocAst(markdownToDoc("正文内容", schema), options);
    expect(ast.meta.title).toBeUndefined();
  });

  it("外链图片可选择不请求并降级为普通链接", async () => {
    const md = '![远图](https://example.com/a.png "题注")\n';
    const { ast, stats } = await pmDocToPandocAst(markdownToDoc(md, schema), {
      ...options,
      remoteImages: "link",
    });
    const json = JSON.stringify(ast);
    expect(json).toContain('"Link"');
    expect(json).toContain("https://example.com/a.png");
    expect(json).not.toContain('"Image"');
    expect(stats.remoteImages).toBe(1);
  });

  it("全方言 Pandoc JSON 可被本机 Pandoc 转 DOCX", async () => {
    const markdown = [
      basic,
      lists,
      tables,
      code,
      dialect,
      callout,
      details,
      attachment,
      math,
      mermaid,
      unknownHtml,
    ].join("\n\n");
    const { ast } = await pmDocToPandocAst(markdownToDoc(markdown, schema), options);
    const dynamicChildProcess = "node:child_process";
    const dynamicFs = "node:fs";
    const dynamicOs = "node:os";
    const dynamicPath = "node:path";
    const { execFileSync } = (await import(
      /* @vite-ignore */ dynamicChildProcess
    )) as {
      execFileSync: (
        command: string,
        args: string[],
        options: { input: string; maxBuffer: number; encoding?: string },
      ) => Uint8Array | string;
    };
    const { mkdtempSync, readFileSync, rmSync } = (await import(
      /* @vite-ignore */ dynamicFs
    )) as {
      mkdtempSync: (prefix: string) => string;
      readFileSync: (path: string) => Uint8Array;
      rmSync: (
        path: string,
        options: { recursive: boolean; force: boolean },
      ) => void;
    };
    const { tmpdir } = (await import(/* @vite-ignore */ dynamicOs)) as {
      tmpdir: () => string;
    };
    const { join } = (await import(/* @vite-ignore */ dynamicPath)) as {
      join: (...parts: string[]) => string;
    };
    let version: string;
    try {
      version = String(
        execFileSync("pandoc", ["--version"], { input: "", maxBuffer: 1024 * 1024 }),
      );
    } catch (e) {
      // 没装 Pandoc 时跳过,PRD 要求 Pandoc 由用户自行安装
      if ((e as { code?: string }).code === "ENOENT") return;
      throw e;
    }
    // Pandoc 3.10 起 --highlight-style 改名为 --syntax-highlighting
    const versionToken = version
      .split(/\s+/)
      .find((token) => /^\d/.test(token));
    const parts = (versionToken ?? "").split(".").map((n) => Number.parseInt(n, 10));
    const modernHighlightFlag =
      (parts[0] ?? 0) > 3 || (parts[0] === 3 && (parts[1] ?? 0) >= 10);
    // Pandoc 3+ 拒绝把二进制 docx 写到终端,必须落到文件再读回
    const workDir = mkdtempSync(join(tmpdir(), "yanzhi-pandoc-"));
    const outputPath = join(workDir, "out.docx");
    try {
      execFileSync(
        "pandoc",
        [
          "--from", "json",
          "--to", "docx",
          "--output", outputPath,
          "--reference-doc", "src-tauri/resources/yanzhi-reference.docx",
          modernHighlightFlag
            ? "--syntax-highlighting"
            : "--highlight-style",
          "src-tauri/resources/yanzhi-highlight.theme",
        ],
        {
          input: JSON.stringify(ast),
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      const output = readFileSync(outputPath);
      expect(output.subarray(0, 2).toString()).toBe("PK");
      const docxMarkdown = String(
        execFileSync("pandoc", ["--from", "docx", "--to", "markdown", outputPath], {
          input: "",
          maxBuffer: 20 * 1024 * 1024,
        }),
      );
      // 回读 DOCX 再转 Markdown,确认的不是“文件能生成”,而是正文语义真的进了产物。
      const contentChecks = [
        "# 标题一",
        "第一段,中英混排 with English text",
        "> 引用第一段。",
        "- 项目一",
        "- [ ] 待办一",
        "有起始值的有序列表",
        "左对齐",
        "SPECIAL_LABEL",
        'const mode = "flow";',
        "![Mermaid 图](media/",
        '[双链](/knowledge-base/双链.md "砚知双链")',
        "信息 · 信息标题",
        "信息提示内容,支持 **加粗**",
        "基础形态",
        "折叠内容第一段,后面跟列表。",
        '[安装手册.pdf](./assets/0123456789abcdef.pdf "砚知附件")',
        "$E = mc^{2}$",
        "$$\\int_{0}^{1}x^{2}\\, dx = \\frac{1}{3}$$",
        "内部内容",
      ];
      for (const expected of contentChecks) {
        expect(docxMarkdown).toContain(expected);
      }
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return;
      throw e;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
