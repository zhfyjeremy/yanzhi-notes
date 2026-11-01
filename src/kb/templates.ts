/**
 * 文档模板(7.5):模板 = `.yanzhi/templates/` 里的 .md,文件名即模板名。
 * 新建文档正文 = 模板原文,首行恰为 H1 时剥离——砚知文档标题由文件名承担
 * (9.2,标题输入框独立于正文),空白新建的正文不含 H1,模板建出的也要同构;
 * H2 及以下层级是模板正文骨架,原样保留。
 */

export function templateToContent(md: string): string {
  const m = /^# [^\n]*(?:\n|$)/.exec(md);
  if (!m) return md;
  // 剥离 H1 行 + 其后紧邻空行(模板常见「# 标题\n\n正文」形态)
  return md.slice(m[0].length).replace(/^\n+/, "");
}

export interface TemplateSkeleton {
  id: "meeting" | "weekly" | "reading";
  name: string;
  description: string;
  content: string;
}

/** 首次使用模板时的本机内置骨架;不联网、不自动写入,用户点击才创建。 */
export const TEMPLATE_SKELETONS: TemplateSkeleton[] = [
  {
    id: "meeting",
    name: "会议纪要",
    description: "议题 / 结论 / 待办",
    content: [
      "## 基本信息",
      "",
      "- 时间:",
      "- 参会人:",
      "",
      "## 讨论议题",
      "",
      "## 结论",
      "",
      "## 待办",
      "",
      "- [ ] ",
      "",
    ].join("\n"),
  },
  {
    id: "weekly",
    name: "周报",
    description: "进展 / 风险 / 下周计划",
    content: [
      "## 本周进展",
      "",
      "- ",
      "",
      "## 数据变化",
      "",
      "| 指标 | 本周 | 上周 |",
      "| --- | ---: | ---: |",
      "| 例 | 0 | 0 |",
      "",
      "## 风险与求助",
      "",
      "> [!WARNING] 有风险时在此说明",
      "",
      "## 下周计划",
      "",
      "- [ ] ",
      "",
    ].join("\n"),
  },
  {
    id: "reading",
    name: "阅读笔记",
    description: "摘录 / 思考 / 行动",
    content: [
      "## 文献信息",
      "",
      "- 标题:",
      "- 作者:",
      "",
      "## 核心观点",
      "",
      "## 重要摘录",
      "",
      "> ",
      "",
      "## 我的思考",
      "",
      "## 后续行动",
      "",
      "- [ ] ",
      "",
    ].join("\n"),
  },
];

/** 模板卡片摘要:剥掉 H1 后取第一段可读文本,避免列表变成 Markdown 符号堆。 */
export function templateSummary(md: string): string {
  const body = templateToContent(md)
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+\.)\s*/, "")
        .replace(/^\|\s*[^|]*\|.*\|$/, "")
        .replace(/^>\s*/, "")
        .replace(/^#+\s*/, "")
        .trim(),
    )
    .filter(Boolean);
  return body[0]?.slice(0, 48) ?? "空白模板";
}

export interface TemplateBadge {
  label: string;
  hit: boolean;
}

export function templateBadges(md: string): TemplateBadge[] {
  return [
    { label: "表格", hit: /^\|.*\|/m.test(md) },
    { label: "任务", hit: /(^|\n)\s*[-*+]\s+\[[ xX]\]/.test(md) },
    { label: "提示块", hit: /> \[!(INFO|SUCCESS|WARNING|CAUTION)\]/i.test(md) },
    { label: "双链", hit: /\[\[[^\]]+\]\]/.test(md) },
  ].filter((badge) => badge.hit);
}

/** 应用内创建模板时的非破坏性唯一名;与文档重名策略区分,模板使用“副本”。 */
export function uniqueTemplateName(existing: readonly string[], preferred: string): string {
  const base = preferred.trim() || "未命名模板";
  const numbered = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+$`);
  if (!existing.includes(base) && !existing.some((name) => numbered.test(name))) return base;
  let n = 2;
  while (existing.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
