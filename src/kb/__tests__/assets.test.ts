import { describe, expect, it } from "vitest";
import { extractAssetReferences, migrateMarkdownAssetRefs, unReferencedAssets } from "../assets";

describe("V3 未引用资源扫描", () => {
  it("提取 Markdown 图片/链接、HTML src/href 与上层目录资源", () => {
    const refs = extractAssetReferences(
      "项目/笔记.md",
      [
        "![图](./assets/a.png)",
        "[附件](../assets/b.pdf)",
        '<img src="./assets/c.webp">',
        "![外链](https://example.com/x.png)",
      ].join("\n"),
    );
    expect([...refs].sort()).toEqual([
      "assets/b.pdf",
      "项目/assets/a.png",
      "项目/assets/c.webp",
    ]);
  });

  it("只返回全库都未引用的 assets 文件", () => {
    const docs = [
      { path: "a.md", content: "![x](./assets/used.png)" },
      { path: "dir/b.md", content: "[f](../assets/root.pdf)\n![x](./assets/used.png)" },
    ];
    expect(
      unReferencedAssets(docs, [
        "assets/root.pdf",
        "assets/unused.png",
        "dir/assets/used.png",
      ]),
    ).toEqual(["assets/unused.png"]);
  });

  it("移动文档时生成资源复制清单并改写相对引用", () => {
    const result = migrateMarkdownAssetRefs(
      "![图](../assets/a.png)\n[附件](./assets/b.pdf)",
      "旧/文档.md",
      "新/文档.md",
    );
    expect(result.content).toBe("![图](./assets/a.png)\n[附件](./assets/b.pdf)");
    expect(result.copies).toEqual([
      { from: "assets/a.png", to: "新/assets/a.png" },
      { from: "旧/assets/b.pdf", to: "新/assets/b.pdf" },
    ]);
  });
});
