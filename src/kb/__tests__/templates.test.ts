import { describe, expect, it } from "vitest";
import {
  TEMPLATE_SKELETONS,
  templateBadges,
  templateSummary,
  templateToContent,
  uniqueTemplateName,
} from "../templates";

describe("templateToContent(7.5 模板 → 新文档正文)", () => {
  it("首行 H1:剥离 H1 与其后空行,正文保留", () => {
    expect(templateToContent("# 会议纪要\n\n## 议题\n\n- \n")).toBe("## 议题\n\n- \n");
  });

  it("只有 H1:得到空正文", () => {
    expect(templateToContent("# 模板")).toBe("");
    expect(templateToContent("# 模板\n")).toBe("");
  });

  it("无 H1(正文直开):原样返回", () => {
    const md = "## 本周进展\n\n写了点东西。\n";
    expect(templateToContent(md)).toBe(md);
  });

  it("H2 开头不是模板标题:原样返回", () => {
    const md = "## 议题\n\n内容\n";
    expect(templateToContent(md)).toBe(md);
  });

  it("'# ' 后为空也算 H1:剥离", () => {
    expect(templateToContent("# \n\n正文\n")).toBe("正文\n");
  });

  it("'#无空格'不是 H1(方言要求 # + 空格):原样", () => {
    const md = "#标签式开头\n";
    expect(templateToContent(md)).toBe(md);
  });

  it("正文中段的 H1 不受影响:只看首行", () => {
    const md = "开头段\n\n# 中段标题\n\n结尾\n";
    expect(templateToContent(md)).toBe(md);
  });

  it("H1 后紧跟正文无空行:只剥 H1 行", () => {
    expect(templateToContent("# 标题\n正文\n")).toBe("正文\n");
  });
});

describe("模板管理辅助函数", () => {
  it("内置骨架覆盖会议纪要 / 周报 / 阅读笔记,且不写入 H1", () => {
    expect(TEMPLATE_SKELETONS.map((item) => item.id)).toEqual(["meeting", "weekly", "reading"]);
    for (const item of TEMPLATE_SKELETONS) {
      expect(item.content.trim().length).toBeGreaterThan(0);
      expect(item.content.startsWith("# ")).toBe(false);
    }
  });

  it("摘要剥掉 H1 与常见 Markdown 符号", () => {
    expect(templateSummary("# 周报\n\n## 本周进展\n\n- 完成编辑器打磨\n")).toBe("本周进展");
    expect(templateSummary("")).toBe("空白模板");
  });

  it("结构标记识别表格 / 任务 / Callout / 双链", () => {
    const badges = templateBadges(
      "| A | B |\n| --- | --- |\n- [ ] todo\n\n> [!WARNING] 注意\n\n[[目标]]",
    );
    expect(badges.map((badge) => badge.label)).toEqual(["表格", "任务", "提示块", "双链"]);
  });

  it("复制模板使用非破坏性唯一名", () => {
    expect(uniqueTemplateName(["周报"], "周报 副本")).toBe("周报 副本");
    expect(uniqueTemplateName(["周报", "周报 副本 2"], "周报 副本")).toBe("周报 副本 3");
    expect(uniqueTemplateName([], "")).toBe("未命名模板");
  });
});
