import { useSettings } from "./settings";

/**
 * 快捷键说明独立窗口(hash 路由 #/shortcuts,帮助菜单进入):
 * 条目与实现一一对应——全局(App/YanzhiEditor keydown)、文本格式与块级
 * (Tiptap 扩展默认键)、查找条(find-replace)。改键或新增时同步此表。
 * useSettings 只为挂主题(跟随主窗/设置窗的 yz-settings 广播)。
 */

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "全局",
    rows: [
      ["专注模式", "⌘⇧F"],
      ["后退 / 前进(双链历史)", "⌘[ · ⌘]"],
      ["后退 / 前进", "⌥← · ⌥→"],
      ["查找", "⌘F"],
      ["查找并替换", "⌥⌘F"],
      ["关闭浮层(查找条/斜杠/双链建议)", "Esc"],
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
  useSettings();
  return (
    <div className="bg-background text-foreground h-screen overflow-y-auto">
      <div className="mx-auto max-w-md space-y-6 p-6 pb-10 text-sm">
        <header>
          <h1 className="text-base font-semibold">快捷键</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            ⌘ / ⌥ 对应 Windows 的 Ctrl / Alt;列表与当前版本行为一致
          </p>
        </header>
        {GROUPS.map((g) => (
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
