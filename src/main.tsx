import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { HelpDocsWindow } from "./HelpDocsWindow";
import { SettingsWindow } from "./kb/SettingsWindow";
import { ShortcutsWindow } from "./ShortcutsWindow";
import "./index.css";

// 图谱窗懒加载:d3 全家桶进独立 chunk,主窗口 bundle 不背图谱依赖
const GraphWindow = lazy(() =>
  import("./GraphWindow").then((m) => ({ default: m.GraphWindow })),
);

// 窗口路由:主窗口走 App;辅助独立窗口(open_aux_window 创建)按 hash 分流
// (设置 / 快捷键 / 使用文档 / 文档图谱),不挂主应用;设置窗与主窗各持 useSettings,经 yz-settings 事件同步。
const hash = window.location.hash;
const settingsMatch = hash.match(/^#\/settings(?:\?(.*))?$/);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {settingsMatch ? (
      <SettingsWindow initialTab={new URLSearchParams(settingsMatch[1] ?? "").get("tab") ?? "general"} />
    ) : hash.startsWith("#/shortcuts") ? (
      <ShortcutsWindow />
    ) : hash.startsWith("#/help") ? (
      <HelpDocsWindow />
    ) : hash.startsWith("#/graph") ? (
      <Suspense fallback={null}>
        <GraphWindow />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
