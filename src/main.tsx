import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsWindow } from "./kb/SettingsWindow";
import { ShortcutsWindow } from "./ShortcutsWindow";
import "./index.css";

// 窗口路由:主窗口走 App;辅助独立窗口(open_aux_window 创建)按 hash 分流
// (设置 / 快捷键说明),不挂主应用;设置窗与主窗各持 useSettings,经 yz-settings 事件同步。
const hash = window.location.hash;
const settingsMatch = hash.match(/^#\/settings(?:\?(.*))?$/);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {settingsMatch ? (
      <SettingsWindow initialTab={new URLSearchParams(settingsMatch[1] ?? "").get("tab") ?? "general"} />
    ) : hash.startsWith("#/shortcuts") ? (
      <ShortcutsWindow />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
