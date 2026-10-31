/**
 * 可自定义的全局快捷键(PRD V3)。
 * 存储统一使用 KeyboardEvent.code,显示时再按平台转换为 ⌘/Ctrl + 可读键名;
 * 这样 macOS Option 组合产生的特殊字符不会影响匹配。
 */

export const SHORTCUT_ACTIONS = [
  "focus",
  "navBack",
  "navForward",
  "find",
  "replace",
  "slashMenu",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutBindings = Record<ShortcutAction, string>;

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  focus: "切换专注模式",
  navBack: "后退",
  navForward: "前进",
  find: "文档内查找",
  replace: "查找并替换",
  slashMenu: "唤起斜杠菜单",
};

export const DEFAULT_SHORTCUTS: ShortcutBindings = {
  focus: "Mod+Shift+KeyF",
  navBack: "Mod+BracketLeft",
  navForward: "Mod+BracketRight",
  find: "Mod+KeyF",
  replace: "Mod+Alt+KeyF",
  slashMenu: "Mod+Shift+Slash",
};

const MODIFIER_CODES = new Set([
  "MetaLeft",
  "MetaRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
]);

const CODE_LABELS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Space: "Space",
  Enter: "↩",
  Escape: "Esc",
  Tab: "Tab",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "Delete",
  Backspace: "Backspace",
};

/** 规范化存储格式;非法值回退 fallback */
export function normalizeShortcut(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const parts = raw.split("+").filter(Boolean);
  if (parts.length < 2) return fallback;
  const code = parts[parts.length - 1];
  if (!code || MODIFIER_CODES.has(code)) return fallback;
  const mods = new Set(parts.slice(0, -1));
  const known = ["Mod", "Alt", "Shift"];
  if ([...mods].some((m) => !known.includes(m))) return fallback;
  // 全局键至少需要 Mod/Alt,避免普通输入字符被误吞
  if (!mods.has("Mod") && !mods.has("Alt")) return fallback;
  return [...known.filter((m) => mods.has(m)), code].join("+");
}

export function normalizeShortcutBindings(raw: unknown): ShortcutBindings {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map((action) => [
      action,
      normalizeShortcut(source[action], DEFAULT_SHORTCUTS[action]),
    ]),
  ) as ShortcutBindings;
}

/** 键盘事件 → 规范化组合键;只按修饰键或非全局组合返回 null */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (e.repeat || !e.code || MODIFIER_CODES.has(e.code)) return null;
  if (!(e.metaKey || e.ctrlKey || e.altKey)) return null;
  const mods = [
    ...(e.metaKey || e.ctrlKey ? ["Mod"] : []),
    ...(e.altKey ? ["Alt"] : []),
    ...(e.shiftKey ? ["Shift"] : []),
  ];
  return [...mods, e.code].join("+");
}

function parsed(binding: string): { mod: boolean; alt: boolean; shift: boolean; code: string } | null {
  const normalized = normalizeShortcut(binding, "");
  if (!normalized) return null;
  const parts = normalized.split("+");
  return {
    mod: parts.includes("Mod"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    code: parts[parts.length - 1] ?? "",
  };
}

export function shortcutMatches(e: KeyboardEvent, binding: string): boolean {
  const p = parsed(binding);
  if (!p) return false;
  return (
    (e.metaKey || e.ctrlKey) === p.mod &&
    e.altKey === p.alt &&
    e.shiftKey === p.shift &&
    e.code === p.code
  );
}

export function formatShortcut(binding: string, isMac = /Mac|iPhone|iPad/.test(navigator.platform)): string {
  const p = parsed(binding);
  if (!p) return "未设置";
  const key =
    CODE_LABELS[p.code] ??
    (p.code.startsWith("Key")
      ? p.code.slice(3)
      : p.code.startsWith("Digit")
        ? p.code.slice(5)
        : p.code);
  if (isMac) return `${p.mod ? "⌘" : ""}${p.alt ? "⌥" : ""}${p.shift ? "⇧" : ""}${key}`;
  return [p.mod ? "Ctrl" : "", p.alt ? "Alt" : "", p.shift ? "Shift" : "", key]
    .filter(Boolean)
    .join("+");
}

export function shortcutConflict(
  bindings: ShortcutBindings,
  action: ShortcutAction,
  binding: string,
): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((other) => other !== action && bindings[other] === binding) ?? null;
}
