import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownToDoc } from "@/editor/markdown/parse";
import { getSchema } from "@/editor/markdown/schema";
import { pmDocToPandocAst } from "../pandoc-ast";

const schema = getSchema();

/** 从 docx(zip)里取出 word/document.xml 的文本 —— 只解这一个条目,不引第三方库。 */
function readDocumentXml(docxPath: string): string {
  const buf = readFileSync(docxPath);
  // 找 zip 中央目录里的 word/document.xml
  const marker = Buffer.from("word/document.xml", "utf8");
  const namePos = buf.indexOf(marker);
  if (namePos < 0) throw new Error("docx 里找不到 word/document.xml");
  // 本地文件头:signature(4) + 26 个字段,文件名长度在 offset 26
  const localOffset = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), namePos);
  if (localOffset < 0) throw new Error("找不到 zip 本地文件头");
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const compressedSize = buf.readUInt32LE(localOffset + 18);
  const method = buf.readUInt16LE(localOffset + 8);
  const data = buf.subarray(dataStart, dataStart + compressedSize);
  const xml = method === 0 ? data : inflateRawSync(data);
  return xml.toString("utf8");
}

describe("DOCX 标题渲染", () => {
  it("Pandoc 把 title metadata 渲染成 Title 样式段落", async () => {
    try {
      execFileSync("pandoc", ["--version"], { input: "", maxBuffer: 1024 * 1024 });
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return;
      throw e;
    }
    const { ast } = await pmDocToPandocAst(markdownToDoc("正文内容", schema), {
      remoteImages: "embed",
      title: "我的文档",
    });
    const workDir = mkdtempSync(join(tmpdir(), "yanzhi-title-"));
    const outputPath = join(workDir, "out.docx");
    try {
      execFileSync(
        "pandoc",
        ["--from", "json", "--to", "docx", "--output", outputPath],
        { input: JSON.stringify(ast), maxBuffer: 16 * 1024 * 1024 },
      );
      const xml = readDocumentXml(outputPath);
      // 标题用了 Title 样式
      expect(xml).toContain('w:pStyle w:val="Title"');
      expect(xml).toContain("我的文档");
      // 正文还在
      expect(xml).toContain("正文内容");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("正文已有同名 H1 时不产生第二个标题段落", async () => {
    try {
      execFileSync("pandoc", ["--version"], { input: "", maxBuffer: 1024 * 1024 });
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") return;
      throw e;
    }
    const { ast } = await pmDocToPandocAst(markdownToDoc("# 我的文档\n\n正文内容", schema), {
      remoteImages: "embed",
      title: "我的文档",
    });
    const workDir = mkdtempSync(join(tmpdir(), "yanzhi-title-"));
    const outputPath = join(workDir, "out.docx");
    try {
      execFileSync(
        "pandoc",
        ["--from", "json", "--to", "docx", "--output", outputPath],
        { input: JSON.stringify(ast), maxBuffer: 16 * 1024 * 1024 },
      );
      const xml = readDocumentXml(outputPath);
      // 没有 Title 样式段落(正文自己的 H1 是 Heading1)
      expect(xml).not.toContain('w:pStyle w:val="Title"');
      expect(xml).toContain("我的文档");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
