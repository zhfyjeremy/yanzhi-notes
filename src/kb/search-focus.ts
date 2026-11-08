/**
 * 全局搜索框聚焦信号(App 快捷键 → DocTree → SearchBox 跨层)。
 * 同 asset-src 的模块级 handler 模式:避免把 ref 从 App 一路透传到搜索输入框。
 */

type FocusHandler = () => void;

let handler: FocusHandler | null = null;

export function setSearchFocusHandler(fn: FocusHandler | null): void {
  handler = fn;
}

/** 聚焦全局搜索框(⌘/Ctrl+P);未挂载时静默 */
export function focusGlobalSearch(): void {
  handler?.();
}
