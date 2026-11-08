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
import { cn } from "@/lib/utils";

/**
 * 快捷键说明独立窗口(hash 路由 #/shortcuts,帮助菜单进入):
 * 全局快捷键可直接录制;固定条目与文本格式/块级(Tiptap 扩展默认键)、
 * 查找条(find-replace)实现一一对应。改键或新增时同步此表。
 * useSettings 只为挂主题(跟随主窗/设置窗的 yz-settings 广播)。
 *
 * 视觉:工程「规格表」——等宽小标 + 键帽 + 点线引线,信息密而不吵。
 * 颜色只走 design token(PRD §12),浅深主题同一套结构。
 */

const FIXED_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "文件",
    rows: [
      ["保存 / 立即保存", "⌘S"],
      ["另存为…(单文件)", "⌘⇧S"],
    ],
  },
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
      ["段落上下移动", "⌘⌥↑ · ⌘⌥↓"],
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

/** 键帽:等宽字 + 底部投影,像真键盘上的键 */
function Kbd({ combo, active }: { combo: string; active?: boolean }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-[6px] border px-1.5",
        "font-mono text-[11px] leading-none tracking-tight whitespace-nowrap",
        "border-border bg-raised text-foreground/85",
        "shadow-[0_1px_0_var(--border-subtle),0_2px_5px_-3px_color-mix(in_oklab,var(--foreground)_40%,transparent)]",
        active &&
          "border-primary text-primary bg-accent/60 shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_18%,transparent)]",
      )}
    >
      {combo}
    </kbd>
  );
}

/** 分组小标:等宽 + 大字距 */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground font-mono text-[10px] tracking-[0.22em] uppercase">
      {children}
    </h2>
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
      <div className="mx-auto w-full max-w-[760px]">
      {/* 标题带:细发丝线 + 一层极淡的主色晕,把"参考页"的调性立住 */}
      <header className="border-border-subtle relative overflow-hidden border-b px-7 pt-7 pb-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(130%_150%_at_6%_-30%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_60%)]" />
        <div className="relative">
          <p className="text-muted-foreground font-mono text-[10px] tracking-[0.3em] uppercase">
            Keyboard Reference
          </p>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">快捷键</h1>
            <span className="text-muted-foreground text-xs">
              手不离键 —— 点击任意键位即可重新录制
            </span>
          </div>
          <p className="text-muted-foreground/80 mt-2 text-[11px]">
            ⌘ / ⌥ 对应 Windows 的 Ctrl / Alt · 文档自动保存,⌘S 可立即保存
          </p>
        </div>
      </header>

      {/* 全局快捷键:可改键区 */}
      <section className="px-7 py-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <GroupLabel>全局 · 可改键</GroupLabel>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground h-6 gap-1.5 px-2 text-[11px]"
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

        <div className="border-border-subtle divide-border-subtle divide-y overflow-hidden rounded-xl border">
          {SHORTCUT_ACTIONS.map((action) => (
            <div
              key={action}
              className="hover:bg-hover/45 flex items-center justify-between gap-6 px-4 py-2.5 transition-colors"
            >
              <span className="text-[13px]">{SHORTCUT_LABELS[action]}</span>
              <button
                type="button"
                aria-label={`修改快捷键:${SHORTCUT_LABELS[action]}`}
                className="focus-visible:ring-ring -m-1 rounded-lg p-1 outline-none focus-visible:ring-2"
                onClick={() => {
                  setNotice("");
                  setCapturing(action);
                }}
              >
                <Kbd
                  combo={
                    capturing === action ? "请按键…" : formatShortcut(settings.shortcuts[action])
                  }
                  active={capturing === action}
                />
              </button>
            </div>
          ))}
          <div className="text-muted-foreground flex items-center justify-between gap-6 px-4 py-2.5 text-[13px]">
            <span>关闭浮层</span>
            <Kbd combo="Esc" />
          </div>
        </div>

        <p
          className={cn(
            "text-muted-foreground mt-2 min-h-4 px-1 text-[11px] transition-opacity",
            notice ? "opacity-100" : "opacity-0",
          )}
        >
          {notice || "占位"}
        </p>
      </section>

      {/* 固定条目:点线引线的规格表 */}
      <section className="px-7 pt-1 pb-8">
        <GroupLabel>固定 · Tiptap 内置</GroupLabel>
        <div className="mt-3 columns-2 gap-10 sm:[column-fill:_balance]">
          {FIXED_GROUPS.map((g) => (
            <div key={g.title} className="mb-6 break-inside-avoid">
              <div className="border-border-subtle mb-1 flex items-center gap-2 border-b pb-1.5">
                <span className="text-foreground/85 text-[13px] font-medium">{g.title}</span>
              </div>
              <div>
                {g.rows.map(([desc, combos]) => (
                  <div
                    key={desc}
                    className="hover:bg-hover/35 group flex items-center gap-3 rounded-md px-1 py-[7px] transition-colors"
                  >
                    <span className="text-foreground/85 shrink-0 text-[13px]">{desc}</span>
                    <span className="border-border-subtle hidden h-px flex-1 border-t border-dashed sm:block" />
                    <span className="flex shrink-0 items-center gap-1">
                      {combos.split(" · ").map((c) => (
                        <Kbd key={c} combo={c} />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
}
