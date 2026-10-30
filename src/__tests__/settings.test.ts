import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, resolvedIsDark } from "../settings";

describe("settings 解析(PRD §8)", () => {
  it("合法值直读,缺失/损坏回默认", () => {
    expect(parseSettings('{"theme":"dark"}')).toEqual({ theme: "dark", cardBorder: true, imageCompress: true });
    expect(parseSettings("{}")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
  });
  it("未知主题值回 system(向前兼容旧配置)", () => {
    expect(parseSettings('{"theme":"sepia"}').theme).toBe("system");
    expect(parseSettings('{"theme":null}').theme).toBe("system");
  });
  it("卡片边框/图片压缩:布尔直读,缺失或异型回 true", () => {
    expect(parseSettings('{"cardBorder":false,"imageCompress":false}')).toEqual({
      theme: "system",
      cardBorder: false,
      imageCompress: false,
    });
    expect(parseSettings('{"cardBorder":"off"}').cardBorder).toBe(true);
    expect(parseSettings('{"imageCompress":0}').imageCompress).toBe(true);
  });
});

describe("resolvedIsDark 三态判定", () => {
  it("显式浅/深优先,system 看 OS", () => {
    expect(resolvedIsDark("dark", false)).toBe(true);
    expect(resolvedIsDark("light", true)).toBe(false);
    expect(resolvedIsDark("system", true)).toBe(true);
    expect(resolvedIsDark("system", false)).toBe(false);
  });
});
