import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  normalizeShortcut,
  normalizeShortcutBindings,
  shortcutConflict,
  shortcutFromEvent,
  shortcutMatches,
} from "../shortcuts";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("V3 快捷键自定义", () => {
  it("规范化顺序并拒绝无主修饰键的组合", () => {
    expect(normalizeShortcut("Shift+Alt+Mod+KeyG", "fallback")).toBe("Mod+Alt+Shift+KeyG");
    expect(normalizeShortcut("KeyF", "fallback")).toBe("fallback");
    expect(normalizeShortcut("MetaLeft", "fallback")).toBe("fallback");
  });

  it("录制与匹配使用 KeyboardEvent.code", () => {
    const event = key({ code: "KeyF", metaKey: true, shiftKey: true });
    expect(shortcutFromEvent(event)).toBe("Mod+Shift+KeyF");
    expect(shortcutMatches(event, "Mod+Shift+KeyF")).toBe(true);
    expect(shortcutMatches(event, "Mod+KeyF")).toBe(false);
  });

  it("格式按平台显示,冲突检测与旧配置补默认值", () => {
    expect(formatShortcut("Mod+Alt+BracketLeft", true)).toBe("⌘⌥[");
    expect(formatShortcut("Mod+Alt+BracketLeft", false)).toBe("Ctrl+Alt+[");
    const bindings = normalizeShortcutBindings({ focus: "Alt+KeyG" });
    expect(bindings.focus).toBe("Alt+KeyG");
    expect(bindings.find).toBe(DEFAULT_SHORTCUTS.find);
    expect(bindings.aiMenu).toBe(DEFAULT_SHORTCUTS.aiMenu);
    expect(DEFAULT_SHORTCUTS.aiMenu).toBe("Mod+Shift+KeyA");
    expect(shortcutConflict(bindings, "navBack", "Mod+Alt+KeyF")).toBe("replace");
  });
});
