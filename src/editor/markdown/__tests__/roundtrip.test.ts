import { describe, expect, it } from "vitest";
import basic from "./fixtures/basic.md?raw";
import inline from "./fixtures/inline.md?raw";
import lists from "./fixtures/lists.md?raw";
import tables from "./fixtures/tables.md?raw";
import code from "./fixtures/code.md?raw";
import dialect from "./fixtures/dialect.md?raw";
import unknownHtml from "./fixtures/unknown-html.md?raw";
import { markdownToDoc } from "../parse";
import { docToMarkdown } from "../serialize";
import { getSchema } from "../schema";

/**
 * S3:md → PM doc → md 全方言往返(PRD §13 阶段 0 硬性前置)。
 * 「用户感知无损」= 往返后与规范化基准逐字一致;
 * 允许的规范化见 serialize.ts 头注(块间空行/行尾空白/末尾换行)。
 */

const schema = getSchema();

function roundtrip(markdown: string): string {
  return docToMarkdown(markdownToDoc(markdown, schema));
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s*$/, "") + "\n";
}

const cases: Record<string, string> = {
  basic,
  inline,
  lists,
  tables,
  code,
  dialect,
  unknownHtml,
};

describe("markdown 往返(用户感知无损)", () => {
  for (const [name, markdown] of Object.entries(cases)) {
    it(name, () => {
      const output = normalize(roundtrip(markdown));
      expect(output).toBe(normalize(markdown));
    });
  }
});

/** 双重往返:确认输出已进入稳定形态(idempotent) */
describe("markdown 二次往返稳定", () => {
  for (const [name, markdown] of Object.entries(cases)) {
    it(name, () => {
      const once = roundtrip(markdown);
      const twice = roundtrip(once);
      expect(normalize(twice)).toBe(normalize(once));
    });
  }
});
