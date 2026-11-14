import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriEnv, kbBackend } from "./kb/backend";
import {
  DEFAULT_SHORTCUTS,
  normalizeShortcutBindings,
  type ShortcutBindings,
} from "./shortcuts";

/**
 * 全局设置(PRD §8):存 Tauri 应用配置目录 / mock localStorage,**不进知识库 meta**。
 * MVP:主题三选一 + 界面风格(卡片/平铺) + 特殊卡片边框 + 图片粘贴压缩;
 * 后续批次在此结构上扩,未交付项不出现在设置页。token 双值见 index.css(:root / .dark)。
 */

export type ThemeMode = "system" | "light" | "dark";

/** §8 通用-启动:last = 直开上次的知识库(5.0.4 默认);welcome = 总是先看欢迎页 */
export type LaunchMode = "last" | "welcome";
export type ReaderFont = "default" | "serif" | "kai";
/** 正文列宽:adaptive 保持现有 48/56rem 断点;fixed 使用用户设定 */
export type EditorWidthMode = "adaptive" | "fixed";

/**
 * 壳层 UI 风格(外观):只改工作区面板怎么摆,不改 Markdown / token 色源。
 * card = 浮卡台面(圆角+阴影+留白);flat = 线框平铺(贴边+发丝分隔)。
 */
export type UiStyle = "card" | "flat";
export type DocxRemoteImageMode = "ask" | "always" | "never";

/** 主色预设(§12:仅覆盖主色系 token,浅/深两套;自定义色值仍 V3)。
 *  accent 系是「主色相的浅灰底/深字」(hover 态),跟随色相走 */
export interface AccentPreset {
  id: string;
  name: string;
  /** 展示色块(浅色主色) */
  swatch: string;
  light: Record<string, string>;
  dark: Record<string, string>;
}

const accentVars = (h: number, pS: number, pL: number, aS: number, aL: number, fL: number) => ({
  "--primary": `hsl(${h} ${pS}% ${pL}%)`,
  "--primary-foreground": "hsl(0 0% 100%)",
  "--ring": `hsl(${h} ${pS}% ${pL}%)`,
  "--accent": `hsl(${h} ${aS}% ${aL}%)`,
  "--accent-foreground": `hsl(${h} ${pS}% ${fL}%)`,
});

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: "blue",
    name: "砚蓝",
    swatch: "hsl(204 89% 44%)",
    light: accentVars(204, 89, 44, 60, 95, 30),
    dark: accentVars(204, 85, 56, 30, 20, 80),
  },
  {
    id: "violet",
    name: "紫罗兰",
    swatch: "hsl(258 78% 48%)",
    light: accentVars(258, 78, 48, 45, 95, 32),
    dark: accentVars(258, 74, 62, 30, 20, 80),
  },
  {
    id: "green",
    name: "苔绿",
    swatch: "hsl(152 62% 36%)",
    light: accentVars(152, 62, 36, 45, 94, 28),
    dark: accentVars(152, 58, 50, 25, 18, 76),
  },
  {
    id: "teal",
    name: "青碧",
    swatch: "hsl(187 72% 34%)",
    light: accentVars(187, 72, 34, 50, 93, 28),
    dark: accentVars(187, 65, 52, 28, 18, 76),
  },
  {
    id: "orange",
    name: "暖橙",
    swatch: "hsl(27 92% 46%)",
    light: accentVars(27, 92, 46, 80, 95, 34),
    dark: accentVars(27, 88, 58, 35, 22, 78),
  },
  {
    id: "red",
    name: "绯红",
    swatch: "hsl(4 78% 48%)",
    light: accentVars(4, 78, 48, 70, 95, 36),
    dark: accentVars(4, 74, 60, 30, 20, 78),
  },
];

const ACCENT_IDS = new Set(ACCENT_PRESETS.map((p) => p.id));
export const DEFAULT_ACCENT = "blue";

/** id → 预设(未知 id 回默认,与 parseSettings 同一容错口径) */
export function accentPresetOf(id: string | undefined): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0];
}

/** 台面背景预设:workspace/sidebar/hover/editor(平铺)/codeBg,不碰主色 */
export interface DeskPreset {
  id: string;
  name: string;
  /** 设置页浅色缩略外框;深色预览改用 dark.workspace */
  swatch: string;
  light: {
    workspace: string;
    sidebar: string;
    hover: string;
    /** 平铺时编辑区底,卡片模式不用 */
    editor: string;
    /** 代码块底色,随台面色相走 */
    codeBg: string;
  };
  dark: {
    workspace: string;
    sidebar: string;
    hover: string;
    editor: string;
    codeBg: string;
  };
}

export const DESK_PRESETS: DeskPreset[] = [
  {
    id: "cloud",
    name: "云白",
    swatch: "hsl(40 12% 96%)",
    light: {
      workspace: "hsl(40 12% 96%)",
      sidebar: "hsl(40 10% 97.5%)",
      hover: "hsl(40 8% 92%)",
      editor: "hsl(0 0% 100%)",
      codeBg: "hsl(40 10% 96%)",
    },
    dark: {
      workspace: "hsl(240 4% 9%)",
      sidebar: "hsl(240 3% 11%)",
      hover: "hsl(240 3% 17%)",
      editor: "hsl(240 3% 13%)",
      codeBg: "hsl(240 3% 16%)",
    },
  },
  {
    id: "warm",
    name: "暖玉",
    swatch: "hsl(38 16% 92%)",
    light: {
      workspace: "hsl(38 16% 92%)",
      sidebar: "hsl(38 14% 95%)",
      hover: "hsl(38 14% 88%)",
      editor: "hsl(40 40% 99.5%)",
      codeBg: "hsl(36 18% 95%)",
    },
    dark: {
      workspace: "hsl(28 10% 7.5%)",
      sidebar: "hsl(28 9% 10%)",
      hover: "hsl(28 8% 16%)",
      editor: "hsl(28 9% 12.5%)",
      codeBg: "hsl(28 8% 16%)",
    },
  },
  {
    id: "mist",
    name: "青雾",
    swatch: "hsl(210 16% 92%)",
    light: {
      workspace: "hsl(210 16% 92%)",
      sidebar: "hsl(210 12% 95%)",
      hover: "hsl(210 12% 87%)",
      editor: "hsl(210 25% 99.5%)",
      codeBg: "hsl(210 18% 95%)",
    },
    dark: {
      workspace: "hsl(220 12% 7%)",
      sidebar: "hsl(220 10% 9.5%)",
      hover: "hsl(220 9% 16%)",
      editor: "hsl(220 10% 12%)",
      codeBg: "hsl(220 10% 16%)",
    },
  },
  {
    id: "stone",
    name: "冷石",
    swatch: "hsl(220 8% 91%)",
    light: {
      workspace: "hsl(220 8% 91%)",
      sidebar: "hsl(220 6% 94%)",
      hover: "hsl(220 6% 86%)",
      editor: "hsl(220 15% 99.5%)",
      codeBg: "hsl(220 8% 94.5%)",
    },
    dark: {
      workspace: "hsl(220 8% 6.5%)",
      sidebar: "hsl(220 7% 9%)",
      hover: "hsl(220 6% 15%)",
      editor: "hsl(220 7% 11.5%)",
      codeBg: "hsl(220 6% 15%)",
    },
  },
  {
    id: "sage",
    name: "苔灰",
    swatch: "hsl(150 10% 92%)",
    light: {
      workspace: "hsl(150 10% 92%)",
      sidebar: "hsl(150 8% 95%)",
      hover: "hsl(150 8% 87%)",
      editor: "hsl(90 20% 99.5%)",
      codeBg: "hsl(150 10% 95%)",
    },
    dark: {
      workspace: "hsl(150 8% 7%)",
      sidebar: "hsl(150 7% 9.5%)",
      hover: "hsl(150 6% 15.5%)",
      editor: "hsl(150 7% 12%)",
      codeBg: "hsl(150 6% 15.5%)",
    },
  },
  {
    id: "ink",
    name: "墨台",
    swatch: "hsl(30 8% 86%)",
    light: {
      workspace: "hsl(30 8% 86%)",
      sidebar: "hsl(30 7% 90%)",
      hover: "hsl(30 7% 80%)",
      editor: "hsl(40 35% 99.5%)",
      codeBg: "hsl(30 8% 93%)",
    },
    dark: {
      workspace: "hsl(24 10% 5%)",
      sidebar: "hsl(24 9% 7.5%)",
      hover: "hsl(24 8% 14%)",
      editor: "hsl(28 8% 11%)",
      codeBg: "hsl(24 8% 14%)",
    },
  },
];

const DESK_IDS = new Set(DESK_PRESETS.map((p) => p.id));
export const DEFAULT_DESK = "cloud";
export const DEFAULT_UI_STYLE: UiStyle = "flat";

export function deskPresetOf(id: string | undefined): DeskPreset {
  return DESK_PRESETS.find((p) => p.id === id) ?? DESK_PRESETS[0];
}

export interface AppSettings {
  theme: ThemeMode;
  /** §8 外观:工作区壳层布局风格 */
  uiStyle: UiStyle;
  /** §8 外观:台面背景预设 id */
  desk: string;
  /** §8 外观:主色预设 id(默认语雀系蓝) */
  accent: string;
  /** V3 有限主题:自定义主色(#rrggbb);null = 使用 accent 预设 */
  customAccent: string | null;
  /** V3 阅读参数 */
  readerFont: ReaderFont;
  readerFontSize: number;
  readerLineHeight: number;
  readerParagraphSpacing: number;
  /** 正文列宽模式;默认随窗口使用现有断点 */
  editorWidthMode: EditorWidthMode;
  /** fixed 模式下的正文内容宽度(不含左右留白);adaptive 下作为下次切换初始值 */
  editorWidth: number;
  /** §8 编辑器设置:特殊卡片(代码块/表格/图片)显示边框,默认开 */
  cardBorder: boolean;
  /** §8 编辑器:表格单元格悬停显示复制按钮,默认关(账号/口令类表才需要) */
  tableCellCopy: boolean;
  /** §8 编辑器:打字机滚动(专注模式子项),默认关;仅专注模式下生效 */
  typewriterMode: boolean;
  /** 正文普通文本/代码块与 Markdown 源码态按一次 Tab 插入的缩进字符数 */
  tabIndentSize: number;
  /** §8 图片:粘贴自动压缩(无透明 JPG q85 / 有透明 PNG),默认开 */
  imageCompress: boolean;
  /** §8 通用:启动时直开上次库(默认,5.0.4-1)或显示欢迎页 */
  launch: LaunchMode;
  /** §8 通用:关闭主窗口时隐藏到系统托盘/菜单栏,不退出;默认关 */
  closeToTray: boolean;
  /** 显示菜单勾选项(非设置页项,菜单「显示」控制):右侧大纲+反链面板 */
  showRightPanel: boolean;
  /** 显示菜单勾选项:编辑器顶部格式工具栏 */
  showToolbar: boolean;
  /** 显示菜单勾选项:右栏四个分区独立显隐(2026-10-31 用户需求),全关时右栏收起 */
  showOutline: boolean;
  showBacklinks: boolean;
  showTags: boolean;
  showHistory: boolean;
  /** §8 存储&快照(V2,6.2-5):每篇文档快照上限(自动+手动共用),超出清最旧 */
  snapshotKeep: number;
  /** §8 存储&快照(6.2-1):自动快照最小间隔(分钟;0 = 每次保存都尝试,仍要求内容有差异) */
  snapshotIntervalMin: number;
  /** V3 全局快捷键(KeyboardEvent.code 存储,跨平台显示) */
  shortcuts: ShortcutBindings;
  /** 每个知识库最近打开的文档(POSIX 相对路径;应用配置,不写入知识库) */
  recentDocs: Record<string, string[]>;
  /** 代码块语言选择的最近使用项(最多 5 个) */
  recentCodeLanguages: string[];
  /* ---- DOCX 导出(PRD 5.6;Pandoc 为用户自装外部工具) ---- */
  /** 手动指定的 pandoc 路径;null = 自动检测 PATH / 常见安装位置 */
  pandocPath: string | null;
  /** 用户自定义 Word reference doc;null = 使用内置模板 */
  docxReferencePath: string | null;
  /** 外链图片导出策略:ask = 每次询问,always = 总是下载嵌入,never = 降级链接 */
  docxRemoteImageMode: DocxRemoteImageMode;
  /* ---- AI 助手 BYOK(§7.8);Key 不进本结构,走安全存储 ---- */
  /** 总开关,默认关;关则隐藏编辑器 AI 入口 */
  aiEnabled: boolean;
  /** 服务商预设:kimi / zhipu / deepseek / custom */
  aiProvider: string;
  /** OpenAI 兼容 Base URL */
  aiBaseUrl: string;
  aiModel: string;
  /** 最近一次配置是否通过测试连接;只记录状态,不保存 Key */
  aiVerified: boolean;
  aiTemperature: number;
  /** 0 = 不传 max_tokens */
  aiMaxTokens: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  uiStyle: DEFAULT_UI_STYLE,
  desk: DEFAULT_DESK,
  accent: DEFAULT_ACCENT,
  customAccent: null,
  readerFont: "default",
  readerFontSize: 16,
  readerLineHeight: 1.6,
  readerParagraphSpacing: 0.75,
  editorWidthMode: "adaptive",
  editorWidth: 800,
  cardBorder: true,
  tableCellCopy: false,
  typewriterMode: false,
  tabIndentSize: 4,
  imageCompress: true,
  launch: "last",
  closeToTray: false,
  showRightPanel: true,
  showToolbar: true,
  showOutline: true,
  showBacklinks: true,
  showTags: true,
  showHistory: true,
  snapshotKeep: 30,
  snapshotIntervalMin: 5,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  recentDocs: {},
  recentCodeLanguages: [],
  pandocPath: null,
  docxReferencePath: null,
  docxRemoteImageMode: "ask",
  aiEnabled: false,
  aiProvider: "custom",
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "gpt-4o-mini",
  aiVerified: false,
  aiTemperature: 0.7,
  aiMaxTokens: 2048,
};

const clampInt = (v: unknown, dflt: number, min: number, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(max, Math.max(min, n));
};
const clampNumber = (v: unknown, dflt: number, min: number, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
  return Math.min(max, Math.max(min, n));
};

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];
const UI_STYLES: readonly UiStyle[] = ["card", "flat"];
const READER_FONTS: readonly ReaderFont[] = ["default", "serif", "kai"];
const EDITOR_WIDTH_MODES: readonly EditorWidthMode[] = ["adaptive", "fixed"];
const DOCX_REMOTE_IMAGE_MODES: readonly DocxRemoteImageMode[] = ["ask", "always", "never"];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const stringList = (value: unknown, max: number): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const v = item.trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
};

const recentDocsMap = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [root, paths] of Object.entries(value)) {
    const cleanRoot = root.trim();
    const clean = stringList(paths, 12);
    if (cleanRoot && clean.length) out[cleanRoot] = clean;
  }
  return out;
};

/** 容错解析:损坏/缺失/未知值逐字段回默认(丢的只是偏好,不阻塞启动) */
export function parseSettings(raw: string): AppSettings {
  try {
    const v = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: THEME_MODES.includes(v?.theme as ThemeMode) ? (v.theme as ThemeMode) : "system",
      uiStyle: UI_STYLES.includes(v?.uiStyle as UiStyle) ? (v.uiStyle as UiStyle) : DEFAULT_UI_STYLE,
      desk: typeof v?.desk === "string" && DESK_IDS.has(v.desk) ? v.desk : DEFAULT_DESK,
      accent: typeof v?.accent === "string" && ACCENT_IDS.has(v.accent) ? v.accent : DEFAULT_ACCENT,
      customAccent:
        typeof v?.customAccent === "string" && HEX_COLOR.test(v.customAccent)
          ? v.customAccent.toLowerCase()
          : null,
      readerFont: READER_FONTS.includes(v?.readerFont as ReaderFont)
        ? (v.readerFont as ReaderFont)
        : "default",
      readerFontSize: clampInt(v?.readerFontSize, 16, 13, 22),
      readerLineHeight: clampNumber(v?.readerLineHeight, 1.6, 1.3, 2.2),
      readerParagraphSpacing: clampNumber(v?.readerParagraphSpacing, 0.75, 0.2, 1.6),
      editorWidthMode: EDITOR_WIDTH_MODES.includes(v?.editorWidthMode as EditorWidthMode)
        ? (v.editorWidthMode as EditorWidthMode)
        : "adaptive",
      editorWidth: clampInt(v?.editorWidth, 800, 600, 1200),
      cardBorder: typeof v?.cardBorder === "boolean" ? v.cardBorder : true,
      tableCellCopy: typeof v?.tableCellCopy === "boolean" ? v.tableCellCopy : false,
      typewriterMode: typeof v?.typewriterMode === "boolean" ? v.typewriterMode : false,
      tabIndentSize: clampInt(v?.tabIndentSize, 4, 1, 8),
      imageCompress: typeof v?.imageCompress === "boolean" ? v.imageCompress : true,
      launch: v?.launch === "welcome" ? "welcome" : "last",
      closeToTray: typeof v?.closeToTray === "boolean" ? v.closeToTray : false,
      showRightPanel: typeof v?.showRightPanel === "boolean" ? v.showRightPanel : true,
      showToolbar: typeof v?.showToolbar === "boolean" ? v.showToolbar : true,
      showOutline: typeof v?.showOutline === "boolean" ? v.showOutline : true,
      showBacklinks: typeof v?.showBacklinks === "boolean" ? v.showBacklinks : true,
      showTags: typeof v?.showTags === "boolean" ? v.showTags : true,
      showHistory: typeof v?.showHistory === "boolean" ? v.showHistory : true,
      snapshotKeep: clampInt(v?.snapshotKeep, 30, 1, 200),
      snapshotIntervalMin: clampInt(v?.snapshotIntervalMin, 5, 0, 120),
      shortcuts: normalizeShortcutBindings(v?.shortcuts),
      recentDocs: recentDocsMap(v?.recentDocs),
      recentCodeLanguages: stringList(v?.recentCodeLanguages, 5),
      pandocPath: typeof v?.pandocPath === "string" && v.pandocPath.trim() ? v.pandocPath.trim() : null,
      docxReferencePath:
        typeof v?.docxReferencePath === "string" && v.docxReferencePath.trim()
          ? v.docxReferencePath.trim()
          : null,
      docxRemoteImageMode: DOCX_REMOTE_IMAGE_MODES.includes(v?.docxRemoteImageMode as DocxRemoteImageMode)
        ? (v.docxRemoteImageMode as DocxRemoteImageMode)
        : "ask",
      aiEnabled: typeof v?.aiEnabled === "boolean" ? v.aiEnabled : false,
      aiBaseUrl: (() => {
        const raw =
          typeof v?.aiBaseUrl === "string" && v.aiBaseUrl.trim()
            ? v.aiBaseUrl.trim()
            : DEFAULT_SETTINGS.aiBaseUrl;
        // 误用 Responses 基址 /api/v1 → 对话补全 paas/v4(本应用只支持 chat/completions)
        if (/^https:\/\/open\.bigmodel\.cn\/api\/v1\/?$/i.test(raw)) {
          return "https://open.bigmodel.cn/api/paas/v4";
        }
        return raw;
      })(),
      aiModel:
        typeof v?.aiModel === "string" && v.aiModel.trim()
          ? v.aiModel.trim()
          : DEFAULT_SETTINGS.aiModel,
      aiVerified: typeof v?.aiVerified === "boolean" ? v.aiVerified : false,
      aiProvider: (() => {
        const raw = typeof v?.aiProvider === "string" ? v.aiProvider.trim() : "";
        if (
          raw === "kimi_coding" ||
          raw === "zhipu" ||
          raw === "deepseek" ||
          raw === "custom"
        ) {
          return raw;
        }
        // 旧配置无字段:按 Base URL 反推
        const base =
          typeof v?.aiBaseUrl === "string" && v.aiBaseUrl.trim()
            ? v.aiBaseUrl.trim()
            : DEFAULT_SETTINGS.aiBaseUrl;
        if (base.includes("api.kimi.com/coding")) return "kimi_coding";
        if (base.includes("bigmodel.") || base.includes("zhipuai")) return "zhipu";
        if (base.includes("deepseek.")) return "deepseek";
        return "custom";
      })(),
      aiTemperature: clampNumber(v?.aiTemperature, 0.7, 0, 2),
      aiMaxTokens: clampInt(v?.aiMaxTokens, 2048, 0, 128000),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 三态 → 当前是否深色(system 态看 OS) */
export function resolvedIsDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}

const READER_FONT_STACKS: Record<ReaderFont, string> = {
  default:
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif',
};

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h =
    max === r
      ? (g - b) / d + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / d + 2
        : (r - g) / d + 4;
  h *= 60;
  return { h, s: s * 100, l: l * 100 };
}

function customAccentVars(hex: string, dark: boolean): Record<string, string> {
  const { h, s, l } = hexToHsl(hex);
  const primaryL = dark ? Math.max(52, Math.min(68, l)) : Math.max(34, Math.min(52, l));
  const accentS = Math.max(20, Math.min(65, s * (dark ? 0.45 : 0.6)));
  return {
    "--primary": `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${primaryL.toFixed(1)}%)`,
    "--primary-foreground":
      primaryL >= 62 ? "hsl(0 0% 12%)" : "hsl(0 0% 100%)",
    "--ring": `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${primaryL.toFixed(1)}%)`,
    "--accent": dark
      ? `hsl(${h.toFixed(1)} ${accentS.toFixed(1)}% 20%)`
      : `hsl(${h.toFixed(1)} ${accentS.toFixed(1)}% 95%)`,
    "--accent-foreground": dark
      ? `hsl(${h.toFixed(1)} ${Math.max(35, s * 0.7).toFixed(1)}% 80%)`
      : `hsl(${h.toFixed(1)} ${Math.max(35, s * 0.7).toFixed(1)}% 30%)`,
  };
}

/** 挂载主题:.dark class 驱动灰阶 token 切换;colorScheme 让滚动条/原生控件跟随;
 *  主色用内联变量覆盖(浅/深值随模式一起换,所以每次主题变化都要重设) */
export function applyTheme(
  s: Pick<
    AppSettings,
    | "theme"
    | "uiStyle"
    | "desk"
    | "accent"
    | "customAccent"
    | "readerFont"
    | "readerFontSize"
    | "readerLineHeight"
    | "readerParagraphSpacing"
    | "editorWidthMode"
    | "editorWidth"
  >,
  systemDark: boolean,
): void {
  const dark = resolvedIsDark(s.theme, systemDark);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.uiStyle = s.uiStyle;
  root.style.colorScheme = dark ? "dark" : "light";
  const accentVars = s.customAccent
    ? customAccentVars(s.customAccent, dark)
    : accentPresetOf(s.accent)[dark ? "dark" : "light"];
  for (const [k, v] of Object.entries(accentVars)) {
    root.style.setProperty(k, v);
  }
  const desk = deskPresetOf(s.desk)[dark ? "dark" : "light"];
  // 平铺:台面与侧栏同层;卡片:侧栏略抬、台面略沉
  if (s.uiStyle === "flat") {
    root.style.setProperty("--workspace", desk.workspace);
    root.style.setProperty("--sidebar", desk.workspace);
    root.style.setProperty("--editor", desk.editor);
  } else {
    root.style.setProperty("--workspace", desk.workspace);
    root.style.setProperty("--sidebar", desk.sidebar);
    root.style.removeProperty("--editor");
  }
  root.style.setProperty("--surface-hover", desk.hover);
  root.style.setProperty("--code-bg", desk.codeBg);
  root.style.setProperty("--editor-font-family", READER_FONT_STACKS[s.readerFont]);
  root.style.setProperty("--editor-font-size", `${s.readerFontSize}px`);
  root.style.setProperty("--editor-line-height", String(s.readerLineHeight));
  root.style.setProperty("--editor-paragraph-gap", `${s.readerParagraphSpacing}em`);
  // adaptive 不能留 inline 覆盖,否则 editor.css 的 1600px 断点永远失效
  if (s.editorWidthMode === "fixed") {
    root.style.setProperty("--editor-content-max", `${s.editorWidth}px`);
  } else {
    root.style.removeProperty("--editor-content-max");
  }
}

const systemDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * 设置 hook:启动恢复 → 即时切换 → 持久化;「跟随系统」监听 OS 切换实时重挂。
 * 设置与知识库无关,欢迎页也要生效,故独立于 useKb。
 * Tauri 下设置跑在独立窗口:改动经 yz-settings 事件广播,主窗/设置窗各自即时应用
 * (浏览器 mock 单窗,无此链路)。
 */
export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const ref = useRef(settings);
  const media = useRef<MediaQueryList | null>(null);

  useEffect(() => {
    let alive = true;
    let unListen: (() => void) | undefined;
    media.current = window.matchMedia("(prefers-color-scheme: dark)");
    void kbBackend
      .getSettings()
      .then((raw) => {
        if (!alive) return;
        const s = parseSettings(raw);
        ref.current = s;
        setSettingsState(s);
        applyTheme(s, systemDark());
        setReady(true);
      })
      .catch(() => {
        if (!alive) return;
        applyTheme(DEFAULT_SETTINGS, systemDark());
        setReady(true);
      });
    const onChange = () => applyTheme(ref.current, systemDark());
    media.current.addEventListener("change", onChange);
    // 另一窗口改了设置(如设置窗切主色):拉平到同一份,不回写避免环路
    if (isTauriEnv()) {
      void import("@tauri-apps/api/event").then(async ({ listen }) => {
        const un = await listen<AppSettings>("yz-settings", (e) => {
          const s = e.payload;
          if (!alive || JSON.stringify(s) === JSON.stringify(ref.current)) return;
          const parsed = parseSettings(JSON.stringify(s));
          ref.current = parsed;
          setSettingsState(parsed);
          applyTheme(parsed, systemDark());
        });
        if (!alive) un();
        else unListen = un;
      });
    }
    return () => {
      alive = false;
      unListen?.();
      media.current?.removeEventListener("change", onChange);
    };
  }, []);

  /** 更新并落盘(全量 JSON 写,后端校验),并广播给其它窗口 */
  const update = useCallback((patch: Partial<AppSettings>) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setSettingsState(next);
    applyTheme(next, systemDark());
    void kbBackend.setSettings(JSON.stringify(next)).catch(console.error);
    if (isTauriEnv()) {
      void import("@tauri-apps/api/event").then(({ emit }) => emit("yz-settings", next));
    }
  }, []);

  return { settings, update, ready };
}
