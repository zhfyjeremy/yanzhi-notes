import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  DEFAULT_SETTINGS,
  accentPresetOf,
  applyTheme,
  deskPresetOf,
  parseSettings,
  resolvedIsDark,
} from "../settings";

describe("settings 解析(PRD §8)", () => {
  it("合法值直读,缺失/损坏回默认", () => {
    expect(parseSettings('{"theme":"dark","accent":"violet"}')).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "dark",
      accent: "violet",
    });
    expect(parseSettings("{}")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not json")).toEqual(DEFAULT_SETTINGS);
  });
  it("未知主题值回 system(向前兼容旧配置)", () => {
    expect(parseSettings('{"theme":"sepia"}').theme).toBe("system");
    expect(parseSettings('{"theme":null}').theme).toBe("system");
  });
  it("界面风格:合法值直读,缺失/未知回 flat", () => {
    expect(parseSettings('{"uiStyle":"flat"}').uiStyle).toBe("flat");
    expect(parseSettings('{"uiStyle":"card"}').uiStyle).toBe("card");
    expect(parseSettings("{}").uiStyle).toBe("flat");
    expect(parseSettings('{"uiStyle":"glass"}').uiStyle).toBe("flat");
  });
  it("台面背景:合法 id 直读,缺失/未知回云白", () => {
    expect(parseSettings('{"desk":"mist"}').desk).toBe("mist");
    expect(parseSettings('{"desk":"ink"}').desk).toBe("ink");
    expect(parseSettings("{}").desk).toBe("cloud");
    expect(parseSettings('{"desk":"neon"}').desk).toBe("cloud");
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
      ...DEFAULT_SETTINGS,
      cardBorder: false,
      imageCompress: false,
    });
    expect(parseSettings('{"cardBorder":"off"}').cardBorder).toBe(true);
    expect(parseSettings('{"imageCompress":0}').imageCompress).toBe(true);
  });
  it("打字机滚动:布尔直读,缺失或异型回 false(默认关)", () => {
    expect(parseSettings('{"typewriterMode":true}').typewriterMode).toBe(true);
    expect(parseSettings("{}").typewriterMode).toBe(false);
    expect(parseSettings('{"typewriterMode":"on"}').typewriterMode).toBe(false);
  });
  it("AI 设置:默认关;布尔/URL/模型/温度钳制;Key 不进 settings.json", () => {
    expect(parseSettings("{}").aiEnabled).toBe(false);
    expect(parseSettings("{}").aiProvider).toBe("custom");
    expect(parseSettings('{"aiEnabled":true}').aiEnabled).toBe(true);
    expect(parseSettings('{"aiBaseUrl":" http://127.0.0.1:11434/v1 "}').aiBaseUrl).toBe(
      "http://127.0.0.1:11434/v1",
    );
    expect(parseSettings('{"aiModel":" qwen "}').aiModel).toBe("qwen");
    expect(parseSettings('{"aiProvider":"kimi"}').aiProvider).toBe("custom");
    expect(parseSettings('{"aiProvider":"kimi_coding"}').aiProvider).toBe("kimi_coding");
    expect(parseSettings('{"aiBaseUrl":"https://api.deepseek.com/v1"}').aiProvider).toBe(
      "deepseek",
    );
    expect(parseSettings('{"aiBaseUrl":"https://open.bigmodel.cn/api/paas/v4"}').aiProvider).toBe(
      "zhipu",
    );
    expect(parseSettings('{"aiBaseUrl":"https://open.bigmodel.cn/api/v1"}').aiBaseUrl).toBe(
      "https://open.bigmodel.cn/api/paas/v4",
    );
    expect(parseSettings('{"aiTemperature":9}').aiTemperature).toBe(2);
    expect(parseSettings('{"aiMaxTokens":-1}').aiMaxTokens).toBe(0);
    expect(parseSettings('{"aiVerified":true}').aiVerified).toBe(true);
    expect(parseSettings('{"aiVerified":"true"}').aiVerified).toBe(false);
    expect(JSON.stringify(parseSettings('{"aiEnabled":true}'))).not.toMatch(/sk-/);
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
  it("关闭窗口时保持后台:布尔直读,缺失或异型回 false(默认关)", () => {
    expect(parseSettings('{"closeToTray":true}').closeToTray).toBe(true);
    expect(parseSettings("{}").closeToTray).toBe(false);
    expect(parseSettings('{"closeToTray":"on"}').closeToTray).toBe(false);
  });
  it("显示菜单项(右侧面板/工具栏):布尔直读,缺失或异型回 true(默认显示)", () => {
    expect(parseSettings('{"showRightPanel":false,"showToolbar":false}').showRightPanel).toBe(false);
    expect(parseSettings('{"showToolbar":false}').showToolbar).toBe(false);
    expect(parseSettings('{"showToolbar":"off"}').showToolbar).toBe(true);
    expect(parseSettings('{"showRightPanel":0}').showRightPanel).toBe(true);
    // 右栏分区独立显隐:布尔直读,异型回 true
    expect(parseSettings('{"showTags":false,"showHistory":false}').showTags).toBe(false);
    expect(parseSettings('{"showOutline":"off"}').showOutline).toBe(true);
    expect(parseSettings('{"showBacklinks":0}').showBacklinks).toBe(true);
  });
  it("V3 阅读参数与自定义主题:逐字段校验并钳制", () => {
    const s = parseSettings(
      '{"customAccent":"#AABBCC","readerFont":"serif","readerFontSize":99,"readerLineHeight":1.4,"readerParagraphSpacing":0.4}',
    );
    expect(s.customAccent).toBe("#aabbcc");
    expect(s.readerFont).toBe("serif");
    expect(s.readerFontSize).toBe(22);
    expect(s.readerLineHeight).toBe(1.4);
    expect(s.readerParagraphSpacing).toBe(0.4);
    expect(parseSettings('{"customAccent":"red","readerFont":"mono"}')).toMatchObject({
      customAccent: null,
      readerFont: "default",
    });
  });
  it("快捷键:合法组合逐项读取,缺失/冲突格式回默认", () => {
    const s = parseSettings(
      '{"shortcuts":{"focus":"Alt+KeyG","find":"Mod+Alt+KeyF","replace":"KeyF"}}',
    );
    expect(s.shortcuts.focus).toBe("Alt+KeyG");
    expect(s.shortcuts.find).toBe("Mod+Alt+KeyF");
    expect(s.shortcuts.replace).toBe(DEFAULT_SETTINGS.shortcuts.replace);
    expect(s.shortcuts.slashMenu).toBe(DEFAULT_SETTINGS.shortcuts.slashMenu);
    expect(s.shortcuts.aiMenu).toBe(DEFAULT_SETTINGS.shortcuts.aiMenu);
  });
});

describe("applyTheme 主色覆盖(浅/深两套)", () => {
  it("浅色挂 light 值,深色挂 dark 值;全部预设变量齐全", () => {
    applyTheme({ ...DEFAULT_SETTINGS, theme: "light", accent: "violet", uiStyle: "card" }, false);
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("hsl(258 78% 48%)");
    expect(document.documentElement.dataset.uiStyle).toBe("card");
    expect(document.documentElement.style.getPropertyValue("--workspace")).toBe(
      deskPresetOf("cloud").light.workspace,
    );
    expect(document.documentElement.style.getPropertyValue("--code-bg")).toBe(
      deskPresetOf("cloud").light.codeBg,
    );
    applyTheme(
      { ...DEFAULT_SETTINGS, theme: "dark", accent: "violet", uiStyle: "flat", desk: "mist" },
      false,
    );
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("hsl(258 74% 62%)");
    expect(document.documentElement.dataset.uiStyle).toBe("flat");
    expect(document.documentElement.style.getPropertyValue("--workspace")).toBe(
      deskPresetOf("mist").dark.workspace,
    );
    expect(document.documentElement.style.getPropertyValue("--sidebar")).toBe(
      deskPresetOf("mist").dark.workspace,
    );
    expect(document.documentElement.style.getPropertyValue("--code-bg")).toBe(
      deskPresetOf("mist").dark.codeBg,
    );
    for (const p of ACCENT_PRESETS) {
      for (const key of ["--primary", "--primary-foreground", "--ring", "--accent", "--accent-foreground"]) {
        expect(p.light[key], `${p.id} light ${key}`).toMatch(/^hsl\(/);
        expect(p.dark[key], `${p.id} dark ${key}`).toMatch(/^hsl\(/);
      }
    }
  });
  it("V3 主题参数写入编辑器 CSS 变量,自定义色覆盖主色", () => {
    applyTheme(
      {
        ...DEFAULT_SETTINGS,
        customAccent: "#336699",
        readerFont: "kai",
        readerFontSize: 19,
        readerLineHeight: 1.9,
        readerParagraphSpacing: 1.1,
      },
      false,
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--editor-font-size")).toBe("19px");
    expect(root.style.getPropertyValue("--editor-line-height")).toBe("1.9");
    expect(root.style.getPropertyValue("--editor-paragraph-gap")).toBe("1.1em");
    expect(root.style.getPropertyValue("--editor-font-family")).toContain("Kaiti");
    expect(root.style.getPropertyValue("--primary")).toContain("210.0");
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
