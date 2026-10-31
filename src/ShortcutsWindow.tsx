import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useSettings } from "./settings";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  formatShortcut,
  shortcutConflict,
  shortcutFromEvent,
  type ShortcutAction,
} from "./shortcuts";

/**
 * 快捷键说明独立窗口(hash 路由 #/shortcuts,帮助菜单进入):
 * 全局快捷键可直接录制;固定条目与文本格式/块级(Tiptap 扩展默认键)、
 * 查找条(find-replace)实现一一对应。改键或新增时同步此表。
 * useSettings 只为挂主题(跟随主窗/设置窗的 yz-settings 广播)。
 */

const FIXED_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "文本格式",
    rows: [
      ["加粗 / 斜体 / 下划线", "⌘B · ⌘I · ⌘U"],
      ["删除线 / 行内代码 / 高亮", "⌘⇧X · ⌘E · ⌘⇧H"],
      ["撤销 / 重做", "⌘Z · ⌘⇧Z"],
    ],
  },
  {
    title: "块级",
    rows: [
      ["引用", "⌘⇧B"],
      ["无序 / 有序列表", "⌘⇧8 · ⌘⇧7"],
      ["任务列表项", "⌘⇧9"],
    ],
  },
  {
    title: "查找条内",
    rows: [["下一处 / 上一处", "↩ · ⇧↩"]],
  },
  {
    title: "输入触发",
    rows: [
      ["斜杠菜单(插入图片/表格/代码块…)", "/"],
      ["双链建议", "[["],
      ["高亮", "==文字=="],
    ],
  },
];

function Kbd({ combo }: { combo: string }) {
  return (
    <kbd className="bg-muted text-foreground inline-flex h-6 items-center rounded-md border border-border px-1.5 font-mono text-[11px] leading-none shadow-[0_1px_0_var(--border)]">
      {combo}
    </kbd>
  );
}

export function ShortcutsWindow() {
  const { settings, update } = useSettings();
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        setNotice("已取消改键");
        return;
      }
      const combo = shortcutFromEvent(e);
      if (!combo) {
        setNotice("快捷键需包含 ⌘/Ctrl 或 Alt,且不能只按修饰键");
        return;
      }
      const conflict = shortcutConflict(settings.shortcuts, capturing, combo);
      if (conflict) {
        setNotice(`与「${SHORTCUT_LABELS[conflict]}」冲突,请换一个组合`);
        return;
      }
      update({ shortcuts: { ...settings.shortcuts, [capturing]: combo } });
      setNotice(`已将「${SHORTCUT_LABELS[capturing]}」设为 ${formatShortcut(combo)}`);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, settings.shortcuts, update]);

  return (
    <div className="bg-background text-foreground h-screen overflow-y-auto">
      <div className="mx-auto max-w-md space-y-6 p-6 pb-10 text-sm">
        <header>
          <h1 className="text-base font-semibold">快捷键</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            ⌘ / ⌥ 对应 Windows 的 Ctrl / Alt;点击快捷键即可重新录制
          </p>
        </header>
        <section className="space-y-1">
          <div className="flex items-center justify-between">
            <h2 className="text-muted-foreground text-xs font-medium">全局</h2>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground h-6 px-2 text-[11px]"
              onClick={() => {
                update({ shortcuts: { ...DEFAULT_SHORTCUTS } });
                setCapturing(null);
                setNotice("已恢复默认快捷键");
              }}
            >
              <RotateCcw className="size-3" />
              恢复默认
            </Button>
          </div>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {SHORTCUT_ACTIONS.map((action) => (
              <div key={action} className="flex items-center justify-between gap-4 px-3 py-2">
                <span>{SHORTCUT_LABELS[action]}</span>
                <button
                  type="button"
                  aria-label={`修改快捷键:${SHORTCUT_LABELS[action]}`}
                  className={`focus:ring-ring rounded-md outline-none focus:ring-2 ${
                    capturing === action ? "text-primary animate-pulse" : ""
                  }`}
                  onClick={() => {
                    setNotice("");
                    setCapturing(action);
                  }}
                >
                  <Kbd combo={capturing === action ? "请按键…" : formatShortcut(settings.shortcuts[action])} />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 px-3 py-2">
              <span>关闭浮层</span>
              <Kbd combo="Esc" />
            </div>
          </div>
          {notice && <p className="text-muted-foreground px-1 text-[11px]">{notice}</p>}
        </section>
        {FIXED_GROUPS.map((g) => (
          <section key={g.title} className="space-y-1">
            <h2 className="text-muted-foreground text-xs font-medium">{g.title}</h2>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {g.rows.map(([desc, combos]) => (
                <div key={desc} className="flex items-center justify-between gap-4 px-3 py-2">
                  <span>{desc}</span>
                  <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                    {combos.split(" · ").map((c) => (
                      <Kbd key={c} combo={c} />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
        <p className="text-muted-foreground/70 text-center text-[11px]">
          文档自动保存,无需 ⌘S;列表随版本更新
        </p>
      </div>
    </div>
  );
}
