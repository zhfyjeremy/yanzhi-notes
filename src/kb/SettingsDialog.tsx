import { useEffect, useState } from "react";
import type { AppSettings } from "../settings";
import { SettingsPage, type SettingsTab } from "./SettingsPage";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 设置的浏览器 dev / E2E 容器:同一 SettingsPage,Tauri 下由 SettingsWindow
 * 独立窗口承载(菜单/齿轮走 open_aux_window),不走此 Dialog。
 */

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  /** 局部更新(合并 + 落盘由 useSettings 负责) */
  onChange: (patch: Partial<AppSettings>) => void;
  onRebuildIndex: () => void;
  onCreateTemplateFromCurrent?: () => void;
  /** 打开时直落分类(如 AI 引导 → ai) */
  initialTab?: string;
}

const VALID: SettingsTab[] = [
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

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onRebuildIndex,
  onCreateTemplateFromCurrent,
  initialTab = "general",
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(
    VALID.includes(initialTab as SettingsTab) ? (initialTab as SettingsTab) : "general",
  );
  useEffect(() => {
    if (open && VALID.includes(initialTab as SettingsTab)) {
      setTab(initialTab as SettingsTab);
    }
  }, [open, initialTab]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[540px] max-w-[720px] gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">设置存放在本机应用目录,与知识库文件互不影响</DialogDescription>
        {open && (
          <SettingsPage
            settings={settings}
            onChange={onChange}
            onRebuildIndex={onRebuildIndex}
            onCreateTemplateFromCurrent={onCreateTemplateFromCurrent}
            tab={tab}
            onTabChange={setTab}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
