import { useEffect, useState } from "react";
import { useSettings } from "../settings";
import { SettingsPage, type SettingsTab } from "./SettingsPage";
import { isTauriEnv } from "./backend";

/**
 * 设置独立窗口页(hash 路由 #/settings?tab=…,main.tsx 分流):
 * 自持 useSettings(读写同一 settings.json,改动经 yz-settings 广播给主窗);
 * 「重建索引」要动主窗的 KB 状态,经 yz-settings-action 事件回主窗执行。
 */

const VALID_TABS: SettingsTab[] = [
  "general",
  "templates",
  "appearance",
  "editor",
  "storage",
  "export",
  "image",
  "search",
  "ai",
  "about",
];

export function SettingsWindow({ initialTab }: { initialTab: string }) {
  const [tab, setTab] = useState<SettingsTab>(
    VALID_TABS.includes(initialTab as SettingsTab) ? (initialTab as SettingsTab) : "general",
  );
  const { settings, update } = useSettings();

  // 已开窗口时菜单「关于砚知」直落分类:Rust 侧广播 tab 切换
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let un: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const fn = await listen<string>("yz-settings-tab", (e) => {
        if (VALID_TABS.includes(e.payload as SettingsTab)) setTab(e.payload as SettingsTab);
      });
      if (disposed) fn();
      else un = fn;
    })();
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  const onRebuildIndex = () => {
    if (!isTauriEnv()) return;
    void import("@tauri-apps/api/event").then(({ emit }) =>
      emit("yz-settings-action", { action: "rebuild" }),
    );
  };

  const onCreateTemplateFromCurrent = () => {
    if (!isTauriEnv()) return;
    void import("@tauri-apps/api/event").then(({ emit }) =>
      emit("yz-settings-action", { action: "template-from-current" }),
    );
  };

  return (
    <div className="bg-workspace h-screen overflow-hidden">
      <SettingsPage
        settings={settings}
        onChange={update}
        onRebuildIndex={onRebuildIndex}
        onCreateTemplateFromCurrent={onCreateTemplateFromCurrent}
        tab={tab}
        onTabChange={setTab}
      />
    </div>
  );
}
