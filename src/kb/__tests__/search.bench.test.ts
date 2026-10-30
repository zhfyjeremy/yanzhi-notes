// 千文档搜索性能回归(M4 验收 3):千篇索引构建 <5s、搜索中位 <100ms(PRD 预算),
// 防止排序/片段构建退化为平方级;阈值留 10x 余量,只拦病理性回归不拦机器慢抖动。
import { describe, expect, it } from "vitest";
import { KbSearchIndex } from "../search";

const PARA =
  "砚知是本地离线知识库编辑器,文档以标准 Markdown 存储。这一段是用于性能测试的中文正文填充,包含双链 [[性能测试]]、代码块与普通段落混排,模拟真实笔记的字符分布。";

function genDocs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    path: `性能测试 ${String(i).padStart(4, "0")}.md`,
    content: Array.from(
      { length: 3 },
      (_, p) =>
        `## 第${p}节\n\n${PARA}\n\n性能测试编号 ${String(i).padStart(4, "0")} 的正文第${p}段。\n\n\`\`\`ts\nconst n = ${i};\n\`\`\`\n`,
    ).join("\n"),
  }));
}

describe("千篇搜索性能", () => {
  it("构建 <5s,常见查询中位 <100ms", () => {
    const docs = genDocs(1000);
    const idx = new KbSearchIndex();
    const t0 = performance.now();
    idx.build(docs);
    const buildMs = performance.now() - t0;
    expect(idx.size).toBe(1000);

    // 预热一次后取 5 次中位;覆盖 全命中/双字词/拉丁词 三类形态
    const queries = ["性能测试 0951", "性能测试", "markdown"];
    const medians: Record<string, number> = {};
    for (const q of queries) {
      idx.search(q);
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        idx.search(q);
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      medians[q] = times[2];
    }
    console.log(
      `build=${buildMs.toFixed(1)}ms`,
      Object.entries(medians).map(([q, ms]) => `${q}=${ms.toFixed(1)}ms`).join(" "),
    );
    expect(buildMs).toBeLessThan(5000);
    for (const ms of Object.values(medians)) expect(ms).toBeLessThan(100);
  });
});
