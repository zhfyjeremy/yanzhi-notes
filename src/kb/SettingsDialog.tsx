import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { AppSettings, ThemeMode } from "../settings";
import { ACCENT_PRESETS } from "../settings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * 全局设置(PRD §8):只渲染已交付项——编辑器(卡片边框)、外观(主题三选一 +
 * 排版只读说明)、图片(粘贴压缩)、搜索(索引说明 + 重建按钮);
 * V2/V3 项(快照/主色色板/字体滑条/AI)解锁前不渲染,避免半截设置。
 */

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
  /** 局部更新(合并 + 落盘由 useSettings 负责) */
  onChange: (patch: Partial<AppSettings>) => void;
  onRebuildIndex: () => void;
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

/** 开关行:label + Switch(行高与只读行一致,同盒分列) */
function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

/** 只读行:label + 当前值(无交互项的统一形态) */
function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="text-muted-foreground text-xs">{value}</span>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  onRebuildIndex,
}: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>设置存放在本机应用目录,与知识库文件互不影响</DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">编辑器</h3>
          <div className="divide-y divide-border rounded-lg border border-border">
            <SwitchRow
              label="特殊卡片显示边框"
              checked={settings.cardBorder}
              onCheckedChange={(v) => onChange({ cardBorder: v })}
            />
          </div>
          <p className="text-muted-foreground text-[11px]">代码块、表格、图片卡片的边框,关闭后仅保留底色</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">外观</h3>
          <div className="bg-muted/40 flex rounded-lg p-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors",
                  settings.theme === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onChange({ theme: value })}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <p className="text-muted-foreground text-[11px]">「跟随系统」会随操作系统外观实时切换</p>
          <div className="flex items-center gap-2.5 px-1 pt-1">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.id}
                title={p.name}
                aria-label={`主色:${p.name}`}
                className={cn(
                  "flex size-6 cursor-pointer items-center justify-center rounded-full transition-transform",
                  settings.accent === p.id
                    ? "ring-primary ring-2 ring-offset-2 ring-offset-background"
                    : "hover:scale-110",
                )}
                style={{ backgroundColor: p.swatch }}
                onClick={() => onChange({ accent: p.id })}
              >
                {settings.accent === p.id && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
            <span className="text-muted-foreground ml-1 text-xs">
              {ACCENT_PRESETS.find((p) => p.id === settings.accent)?.name ?? "语雀蓝"}
            </span>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border">
            <ValueRow label="字体" value="语雀默认" />
            <ValueRow label="行高" value="语雀默认" />
            <ValueRow label="段间距" value="语雀默认" />
          </div>
          <p className="text-muted-foreground text-[11px]">自定义排版参数将在后续版本提供</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">图片</h3>
          <div className="divide-y divide-border rounded-lg border border-border">
            <SwitchRow
              label="粘贴图片自动压缩"
              checked={settings.imageCompress}
              onCheckedChange={(v) => onChange({ imageCompress: v })}
            />
          </div>
          <p className="text-muted-foreground text-[11px]">WebP 质量 85;SVG、GIF 或压缩后更大时保留原图</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium">搜索</h3>
          <div className="divide-y divide-border rounded-lg border border-border">
            <ValueRow label="索引时机" value="保存时自动更新" />
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>索引异常或内容缺失时,手动全量重建</span>
              <Button size="sm" variant="outline" onClick={onRebuildIndex}>
                重建索引
              </Button>
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
