import { describe, expect, it } from "vitest";
import { brokenImageLabel, isBrokenImage } from "../extensions/image-card";

/**
 * 图片加载失败兜底(Typora 式:破图图标 + 图片地址)。
 * NodeView 是 React 组件,本仓 vitest/jsdom 不渲染 NodeView,
 * 故只对判定规则与地址文案做纯函数锁定(渲染表现由真机截图核对)。
 */

describe("图片加载失败兜底", () => {
  it("空地址直接判失败", () => {
    expect(isBrokenImage("", "", null)).toBe(true);
    expect(isBrokenImage("   ", "   ", null)).toBe(true);
  });

  it("未报过错不算失败", () => {
    expect(isBrokenImage("./assets/a.png", "./assets/a.png", null)).toBe(false);
  });

  it("报过错且地址未变 → 失败", () => {
    expect(isBrokenImage("./assets/a.png", "./assets/a.png", "./assets/a.png")).toBe(true);
  });

  it("改了地址 → 自动重试(旧失败态不挂着)", () => {
    expect(isBrokenImage("./assets/b.png", "./assets/b.png", "./assets/a.png")).toBe(false);
  });

  it("地址文案取 md 原文,空地址给占位说明", () => {
    expect(brokenImageLabel("./assets/a.png")).toBe("./assets/a.png");
    expect(brokenImageLabel("")).toBe("(空图片地址)");
  });
});
