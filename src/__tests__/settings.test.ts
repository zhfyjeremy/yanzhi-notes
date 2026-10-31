import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  DEFAULT_SETTINGS,
  accentPresetOf,
  applyTheme,
  parseSettings,
  resolvedIsDark,
} from "../settings";

describe("settings 解析(PRD §8)", () => {
  it("合法值直读,缺失/损坏回默认", () => {
    expect(parseSettings('{"theme":"dark","accent":"violet"}')).toEqual({
      theme: "dark",
      accent: "violet",
      cardBorder: true,
      imageCompress: true,
      launch: "last",
      showRightPanel: true,
      showToolbar: true,
      snapshotKeep: 30,
      snapshotIntervalMin: 5,
    });
    expect(parseSettings("{}")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
  });
  it("未知主题值回 system(向前兼容旧配置)", () => {
    expect(parseSettings('{"theme":"sepia"}').theme).toBe("system");
    expect(parseSettings('{"theme":null}').theme).toBe("system");
  });
  it("主色预设:合法 id 直读,未知/异型回语雀蓝", () => {
    expect(parseSettings('{"accent":"teal"}').accent).toBe("teal");
    expect(parseSettings('{"accent":"pink"}').accent).toBe("blue");
    expect(parseSettings('{"accent":123}').accent).toBe("blue");
    expect(accentPresetOf("nope").id).toBe("blue");
    expect(accentPresetOf(undefined).id).toBe("blue");
  });
  it("卡片边框/图片压缩:布尔直读,缺失或异型回 true", () => {
    expect(parseSettings('{"cardBorder":false,"imageCompress":false}')).toEqual({
      theme: "system",
      accent: "blue",
      cardBorder: false,
      imageCompress: false,
      launch: "last",
      showRightPanel: true,
      showToolbar: true,
      snapshotKeep: 30,
      snapshotIntervalMin: 5,
    });
    expect(parseSettings('{"cardBorder":"off"}').cardBorder).toBe(true);
    expect(parseSettings('{"imageCompress":0}').imageCompress).toBe(true);
  });
  it("快照设置(§8 存储,V2):整数直读并钳制,缺失/异型回默认(30 份 / 5 分钟)", () => {
    expect(parseSettings('{"snapshotKeep":10,"snapshotIntervalMin":1}')).toMatchObject({
      snapshotKeep: 10,
      snapshotIntervalMin: 1,
    });
    expect(parseSettings('{"snapshotKeep":0}').snapshotKeep).toBe(1); // 上限至少 1
    expect(parseSettings('{"snapshotKeep":9999}').snapshotKeep).toBe(200);
    expect(parseSettings('{"snapshotIntervalMin":-5}').snapshotIntervalMin).toBe(0); // 0 = 每次保存都尝试
    expect(parseSettings('{"snapshotIntervalMin":9999}').snapshotIntervalMin).toBe(120);
    expect(parseSettings('{"snapshotKeep":"30"}').snapshotKeep).toBe(30); // 字符串异型回默认
  });
  it("启动偏好:welcome 直读,缺失/异型/未知回 last(5.0.4 默认直开上次库)", () => {
    expect(parseSettings('{"launch":"welcome"}').launch).toBe("welcome");
    expect(parseSettings('{"launch":"last"}').launch).toBe("last");
    expect(parseSettings('{"launch":"resume"}').launch).toBe("last");
    expect(parseSettings('{"launch":null}').launch).toBe("last");
  });
  it("显示菜单项(右侧面板/工具栏):布尔直读,缺失或异型回 true(默认显示)", () => {
    expect(parseSettings('{"showRightPanel":false,"showToolbar":false}').showRightPanel).toBe(false);
    expect(parseSettings('{"showToolbar":false}').showToolbar).toBe(false);
    expect(parseSettings('{"showToolbar":"off"}').showToolbar).toBe(true);
    expect(parseSettings('{"showRightPanel":0}').showRightPanel).toBe(true);
  });
});

describe("applyTheme 主色覆盖(浅/深两套)", () => {
  it("浅色挂 light 值,深色挂 dark 值;全部预设变量齐全", () => {
    applyTheme({ theme: "light", accent: "violet" }, false);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("hsl(258 78% 48%)");
    applyTheme({ theme: "dark", accent: "violet" }, false);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("hsl(258 74% 62%)");
    for (const p of ACCENT_PRESETS) {
      for (const key of ["--primary", "--primary-foreground", "--ring", "--accent", "--accent-foreground"]) {
        expect(p.light[key], `${p.id} light ${key}`).toMatch(/^hsl\(/);
        expect(p.dark[key], `${p.id} dark ${key}`).toMatch(/^hsl\(/);
      }
    }
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
