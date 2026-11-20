import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { markdownToDoc } from "../parse";
import { docToMarkdown } from "../serialize";
import { getSchema } from "../schema";

const schema = getSchema();

function links(doc: PMNode): { text: string; href: string }[] {
  const out: { text: string; href: string }[] = [];
  doc.descendants((node) => {
    if (!node.isText) return true;
    for (const mark of node.marks) {
      if (mark.type.name === "link") {
        out.push({ text: node.text ?? "", href: String(mark.attrs.href ?? "") });
      }
    }
    return true;
  });
  return out;
}

describe("URL 自动链接", () => {
  it("打开文档时普通裸 URL 成为链接", () => {
    const doc = markdownToDoc(
      "发布地址 https://github.com/vuejs/vue-next/releases/tag/v3.0.0 查看",
      schema,
    );
    expect(links(doc)).toEqual([
      {
        text: "https://github.com/vuejs/vue-next/releases/tag/v3.0.0",
        href: "https://github.com/vuejs/vue-next/releases/tag/v3.0.0",
      },
    ]);
  });

  it("兼容外部编辑器导出的转义 scheme:https\\://", () => {
    const doc = markdownToDoc(
      "发布地址 https\\://github.com/vuejs/vue-next/releases/tag/v3.0.0 查看",
      schema,
    );
    expect(links(doc)).toEqual([
      {
        text: "https://github.com/vuejs/vue-next/releases/tag/v3.0.0",
        href: "https://github.com/vuejs/vue-next/releases/tag/v3.0.0",
      },
    ]);
    expect(docToMarkdown(doc)).toBe(
      "发布地址 [https://github.com/vuejs/vue-next/releases/tag/v3.0.0](https://github.com/vuejs/vue-next/releases/tag/v3.0.0) 查看\n",
    );
  });

  it("修复历史损坏链接:text === href 的「URL+逗号括注」拆链(半角)", () => {
    const doc = markdownToDoc(
      "内网 [http://chwms-app.apps.intra.local,(apk,gitlab流水线产物)](http://chwms-app.apps.intra.local,(apk,gitlab流水线产物))",
      schema,
    );
    expect(links(doc)).toEqual([
      { text: "http://chwms-app.apps.intra.local", href: "http://chwms-app.apps.intra.local" },
    ]);
    expect(docToMarkdown(doc)).toBe(
      "内网 [http://chwms-app.apps.intra.local](http://chwms-app.apps.intra.local),\\(apk,gitlab流水线产物\\)\n",
    );
  });

  it("修复历史损坏链接:全角逗号/括注同口径", () => {
    const doc = markdownToDoc(
      "内网 [http://chwms-pad.apps.intra.local，（apk，gitlab流水线产物）](http://chwms-pad.apps.intra.local，（apk，gitlab流水线产物）)",
      schema,
    );
    expect(links(doc)).toEqual([
      { text: "http://chwms-pad.apps.intra.local", href: "http://chwms-pad.apps.intra.local" },
    ]);
  });

  it("正常显式链接不受自愈规则影响", () => {
    // 改名链接
    const renamed = markdownToDoc("[发布地址](https://example.com/a)", schema);
    expect(links(renamed)).toEqual([{ text: "发布地址", href: "https://example.com/a" }]);
    // 合法含逗号 URL(linkify 覆盖整段,无尾部)
    const commaUrl = markdownToDoc(
      "[https://example.com/a,b](https://example.com/a,b)",
      schema,
    );
    expect(links(commaUrl)).toEqual([
      { text: "https://example.com/a,b", href: "https://example.com/a,b" },
    ]);
  });

  it("代码块中的转义 URL 保持原文,不自动成链接", () => {
    const md = "```\nhttps\\://github.com/vuejs/vue-next/releases/tag/v3.0.0\n```";
    const doc = markdownToDoc(md, schema);
    expect(links(doc)).toEqual([]);
    expect(docToMarkdown(doc)).toBe(`${md}\n`);
  });
});
