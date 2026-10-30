import { useCallback, useEffect, useRef, useState } from "react";
import { kbBackend } from "./kb/backend";

/**
 * 全局设置(PRD §8):存 Tauri 应用配置目录 / mock localStorage,**不进知识库 meta**。
 * MVP:主题三选一 + 特殊卡片边框 + 图片粘贴压缩;后续批次在此结构上扩,
 * 未交付项不出现在设置页。token 双值见 index.css(:root / .dark)。
 */

export type ThemeMode = "system" | "light" | "dark";

export interface AppSettings {
  theme: ThemeMode;
  /** §8 编辑器设置:特殊卡片(代码块/表格/图片)显示边框,默认开 */
  cardBorder: boolean;
  /** §8 图片:粘贴自动压缩(WebP 质量 85),默认开 */
  imageCompress: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { theme: "system", cardBorder: true, imageCompress: true };

const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

/** 容错解析:损坏/缺失/未知值逐字段回默认(丢的只是偏好,不阻塞启动) */
export function parseSettings(raw: string): AppSettings {
  try {
    const v = JSON.parse(raw) as Partial<AppSettings>;
    return {
      theme: THEME_MODES.includes(v?.theme as ThemeMode) ? (v.theme as ThemeMode) : "system",
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

/** 挂载主题:.dark class 驱动全部 token 切换;colorScheme 让滚动条/原生控件跟随 */
export function applyTheme(mode: ThemeMode, systemDark: boolean): void {
  const dark = resolvedIsDark(mode, systemDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
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
        applyTheme(s.theme, systemDark());
      })
      .catch(() => applyTheme("system", systemDark()));
    const onChange = () => applyTheme(ref.current.theme, systemDark());
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
    applyTheme(next.theme, systemDark());
    void kbBackend.setSettings(JSON.stringify(next)).catch(console.error);
  }, []);

  return { settings, update };
}
