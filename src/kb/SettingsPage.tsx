import {
  Check,
  Image as ImageIcon,
  Info,
  Monitor,
  Moon,
  Palette,
  PenLine,
  Search,
  SlidersHorizontal,
  Sun,
  Vault,
} from "lucide-react";
import type { AppSettings, LaunchMode, ThemeMode } from "../settings";
import { ACCENT_PRESETS } from "../settings";
import { APP_VERSION } from "../version";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * 设置页(§8,Typora 式左右结构):左分类导航 + 右内容。
 * 同一组件两处容器:Tauri 独立窗口(SettingsWindow)/ 浏览器 dev 的 Dialog
 * (SettingsDialog 包壳)。只渲染已交付项,V2/V3 项解锁前不出现。
 */

export type SettingsTab = "general" | "appearance" | "editor" | "image" | "search" | "about";

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "editor", label: "编辑器", icon: PenLine },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "search", label: "搜索", icon: Search },
  { id: "about", label: "关于", icon: Info },
];

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
];

const LAUNCH_OPTIONS: { value: LaunchMode; label: string }[] = [
  { value: "last", label: "打开上次的知识库" },
  { value: "welcome", label: "显示欢迎页" },
];

/** 分段选择(主题/启动共用形态):bg-muted 底 + 选中项浮起 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: typeof Sun }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="bg-muted/60 flex rounded-lg p-1" role="radiogroup" aria-label={ariaLabel}>
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          role="radio"
          aria-checked={value === v}
          className={cn(
            "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors",
            value === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(v)}
        >
          {Icon && <Icon className="size-3.5 shrink-0" />}
          {label}
        </button>
      ))}
    </div>
  );
}

/** 行组:统一卡片容器 + 行分隔(设置行的唯一形态) */
function Group({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">{children}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5 text-sm">
      <span>{label}</span>
      {children}
    </div>
  );
}

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
    <Row label={label}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </Row>
  );
}

function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <Row label={label}>
      <span className="text-muted-foreground text-xs">{value}</span>
    </Row>
  );
}

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground text-[11px]">{children}</p>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-muted-foreground text-xs font-medium">{children}</h3>
);

/** 主色色板(长方形色块 + 名称,3 列) */
function AccentPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ACCENT_PRESETS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            aria-label={`主色:${p.name}`}
            aria-pressed={active}
            className={cn(
              "hover:border-primary/50 cursor-pointer rounded-lg border p-2 text-left transition-colors",
              active ? "ring-primary border-primary/40 ring-2" : "border-border",
            )}
            onClick={() => onChange(p.id)}
          >
            <span
              className="relative block h-7 w-full rounded-md"
              style={{ backgroundColor: p.swatch }}
            >
              {active && (
                <Check className="absolute top-1/2 left-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 text-white" strokeWidth={3} />
              )}
            </span>
            <span className="mt-1.5 flex items-center justify-between text-xs">
              {p.name}
              {p.id === "blue" && <span className="text-muted-foreground text-[10px]">默认</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 关于砚知:品牌块 + slogan + 简介与三条产品事实 */
function AboutPane() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="bg-primary text-primary-foreground flex size-16 shrink-0 items-center justify-center rounded-2xl shadow-sm">
          <Vault className="size-8" />
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold">砚知</span>
            <span className="text-muted-foreground text-xs">v{APP_VERSION}</span>
          </div>
          <p className="text-muted-foreground text-xs">本地离线知识库编辑器 · Windows / macOS</p>
        </div>
      </div>

      <div className="bg-muted/40 rounded-lg p-4">
        <p className="text-center text-base font-medium tracking-wide">一方砚,存所知</p>
      </div>

      <p className="text-muted-foreground text-sm leading-6">
        「砚」为落笔之器,「知」为所积之识。砚知把笔记存进你电脑上的文件夹:文档是标准
        Markdown,双链串联所思,复制整个文件夹即完成备份。不上云、无账号,数据始终在你手里。
      </p>

      <Group>
        <ValueRow label="本地优先" value="未开启 AI 时无任何网络请求" />
        <ValueRow label="开放格式" value="标准 Markdown + assets 相对路径" />
        <ValueRow label="数据自持" value="复制文件夹即备份,随时带走" />
      </Group>

      <p className="text-muted-foreground/70 text-center text-[11px]">© 2026 砚知 · Tauri 2</p>
    </div>
  );
}

export interface SettingsPageProps {
  settings: AppSettings;
  /** 局部更新(合并 + 落盘由 useSettings 负责) */
  onChange: (patch: Partial<AppSettings>) => void;
  onRebuildIndex: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsPage({ settings, onChange, onRebuildIndex, tab, onTabChange }: SettingsPageProps) {
  return (
    <div className="bg-background text-foreground flex h-full min-h-0 text-sm">
      <nav className="bg-muted/40 flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-current={tab === id}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm",
              tab === id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
            )}
            onClick={() => onTabChange(id)}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        ))}
        <span className="text-muted-foreground/60 mt-auto px-2.5 pt-2 text-[10px]">砚知 v{APP_VERSION}</span>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-sm space-y-5 p-6">
          {tab === "general" && (
            <>
              <section className="space-y-2">
                <SectionTitle>启动</SectionTitle>
                <Segmented
                  ariaLabel="启动时"
                  options={LAUNCH_OPTIONS}
                  value={settings.launch}
                  onChange={(v) => onChange({ launch: v })}
                />
                <Hint>「打开上次的知识库」:路径失效时自动回到欢迎页</Hint>
              </section>
              <section className="space-y-2">
                <SectionTitle>存储</SectionTitle>
                <Group>
                  <ValueRow label="设置存放位置" value="本机应用目录" />
                </Group>
                <Hint>设置与知识库分开存放,不写进知识库文件夹</Hint>
              </section>
            </>
          )}

          {tab === "appearance" && (
            <>
              <section className="space-y-2">
                <SectionTitle>主题</SectionTitle>
                <Segmented
                  ariaLabel="主题"
                  options={THEME_OPTIONS}
                  value={settings.theme}
                  onChange={(v) => onChange({ theme: v })}
                />
                <Hint>「跟随系统」会随操作系统外观实时切换</Hint>
              </section>
              <section className="space-y-2">
                <SectionTitle>主色</SectionTitle>
                <AccentPicker value={settings.accent} onChange={(id) => onChange({ accent: id })} />
                <Hint>仅覆盖主色系;自定义色值将在后续版本提供</Hint>
              </section>
              <section className="space-y-2">
                <SectionTitle>排版</SectionTitle>
                <Group>
                  <ValueRow label="字体" value="默认" />
                  <ValueRow label="行高" value="默认" />
                  <ValueRow label="段间距" value="默认" />
                </Group>
                <Hint>自定义排版参数将在后续版本提供</Hint>
              </section>
            </>
          )}

          {tab === "editor" && (
            <section className="space-y-2">
              <SectionTitle>卡片</SectionTitle>
              <Group>
                <SwitchRow
                  label="特殊卡片显示边框"
                  checked={settings.cardBorder}
                  onCheckedChange={(v) => onChange({ cardBorder: v })}
                />
              </Group>
              <Hint>代码块、表格、图片卡片的边框,关闭后仅保留底色</Hint>
            </section>
          )}

          {tab === "image" && (
            <section className="space-y-2">
              <SectionTitle>插入图片</SectionTitle>
              <Group>
                <SwitchRow
                  label="粘贴图片自动压缩"
                  checked={settings.imageCompress}
                  onCheckedChange={(v) => onChange({ imageCompress: v })}
                />
              </Group>
              <Hint>WebP 质量 85;SVG、GIF 或压缩后更大时保留原图</Hint>
            </section>
          )}

          {tab === "search" && (
            <section className="space-y-2">
              <SectionTitle>索引</SectionTitle>
              <Group>
                <ValueRow label="索引时机" value="保存时自动更新" />
                <Row label="内容缺失或索引异常时,手动全量重建">
                  <Button size="sm" variant="outline" onClick={onRebuildIndex}>
                    重建索引
                  </Button>
                </Row>
              </Group>
            </section>
          )}

          {tab === "about" && <AboutPane />}
        </div>
      </div>
    </div>
  );
}
