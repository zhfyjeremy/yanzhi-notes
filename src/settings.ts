import { useCallback, useEffect, useRef, useState } from "react";
import { kbBackend } from "./kb/backend";

/**
 * 全局设置(PRD §8):存 Tauri 应用配置目录 / mock localStorage,**不进知识库 meta**。
 * MVP:主题三选一 + 特殊卡片边框 + 图片粘贴压缩;后续批次在此结构上扩,
 * 未交付项不出现在设置页。token 双值见 index.css(:root / .dark)。
 */

export type ThemeMode = "system" | "light" | "dark";

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
    name: "语雀蓝",
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

export interface AppSettings {
  theme: ThemeMode;
  /** §8 外观:主色预设 id(默认语雀系蓝) */
  accent: string;
  /** §8 编辑器设置:特殊卡片(代码块/表格/图片)显示边框,默认开 */
  cardBorder: boolean;
  /** §8 图片:粘贴自动压缩(WebP 质量 85),默认开 */
  imageCompress: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  accent: DEFAULT_ACCENT,
  cardBorder: true,
  imageCompress: true,
};

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

/** 容错解析:损坏/缺失/未知值逐字段回默认(丢的只是偏好,不阻塞启动) */
export function parseSettings(raw: string): AppSettings {
  try {
    const v = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: THEME_MODES.includes(v?.theme as ThemeMode) ? (v.theme as ThemeMode) : "system",
      accent: typeof v?.accent === "string" && ACCENT_IDS.has(v.accent) ? v.accent : DEFAULT_ACCENT,
      cardBorder: typeof v?.cardBorder === "boolean" ? v.cardBorder : true,
      imageCompress: typeof v?.imageCompress === "boolean" ? v.imageCompress : true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 三态 → 当前是否深色(system 态看 OS) */
export function resolvedIsDark(mode: ThemeMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}

/** 挂载主题:.dark class 驱动灰阶 token 切换;colorScheme 让滚动条/原生控件跟随;
 *  主色用内联变量覆盖(浅/深值随模式一起换,所以每次主题变化都要重设) */
export function applyTheme(s: Pick<AppSettings, "theme" | "accent">, systemDark: boolean): void {
  const dark = resolvedIsDark(s.theme, systemDark);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  for (const [k, v] of Object.entries(accentPresetOf(s.accent)[dark ? "dark" : "light"])) {
    root.style.setProperty(k, v);
  }
}

const systemDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * 设置 hook:启动恢复 → 即时切换 → 持久化;「跟随系统」监听 OS 切换实时重挂。
 * 设置与知识库无关,欢迎页也要生效,故独立于 useKb。
 */
export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const ref = useRef(settings);
  const media = useRef<MediaQueryList | null>(null);

  useEffect(() => {
    let alive = true;
    media.current = window.matchMedia("(prefers-color-scheme: dark)");
    void kbBackend
      .getSettings()
      .then((raw) => {
        if (!alive) return;
        const s = parseSettings(raw);
        ref.current = s;
        setSettingsState(s);
        applyTheme(s, systemDark());
      })
      .catch(() => applyTheme(DEFAULT_SETTINGS, systemDark()));
    const onChange = () => applyTheme(ref.current, systemDark());
    media.current.addEventListener("change", onChange);
    return () => {
      alive = false;
      media.current?.removeEventListener("change", onChange);
    };
  }, []);

  /** 更新并落盘(全量 JSON 写,后端校验) */
  const update = useCallback((patch: Partial<AppSettings>) => {
    const next = { ...ref.current, ...patch };
    ref.current = next;
    setSettingsState(next);
    applyTheme(next, systemDark());
    void kbBackend.setSettings(JSON.stringify(next)).catch(console.error);
  }, []);

  return { settings, update };
}
