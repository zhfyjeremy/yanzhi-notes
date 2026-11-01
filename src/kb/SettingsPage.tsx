import { useEffect, useState } from "react";
import {
  Check,
  Database,
  Image as ImageIcon,
  Info,
  LayoutTemplate,
  Monitor,
  Moon,
  Palette,
  PenLine,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  Vault,
} from "lucide-react";
import { Minus, RotateCcw } from "lucide-react";
import { kbBackend } from "./backend";
import { TemplateWorkbench } from "./TemplateManager";
import { AssetCleanupDialog } from "./AssetCleanupDialog";
import type { AppSettings, LaunchMode, ReaderFont, ThemeMode } from "../settings";
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

export type SettingsTab =
  | "general"
  | "templates"
  | "appearance"
  | "editor"
  | "storage"
  | "image"
  | "search"
  | "about";

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "templates", label: "模板", icon: LayoutTemplate },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "editor", label: "编辑器", icon: PenLine },
  { id: "storage", label: "存储", icon: Database },
  { id: "image", label: "图片", icon: ImageIcon },
  { id: "search", label: "搜索", icon: Search },
  { id: "about", label: "关于", icon: Info },
];

const NAV_GROUPS: { title: string; tabs: SettingsTab[] }[] = [
  { title: "偏好", tabs: ["general", "appearance", "editor"] },
  { title: "内容", tabs: ["templates", "storage", "image", "search"] },
  { title: "软件", tabs: ["about"] },
];

const PAGE_META: Record<SettingsTab, { title: string; description: string }> = {
  general: { title: "通用", description: "控制砚知启动方式,并查看应用数据的存放边界。" },
  templates: { title: "模板", description: "管理当前知识库的文档模板,模板仍是标准 Markdown 文件。" },
  appearance: { title: "外观", description: "调整主题、主色与正文排版,所有变化即时预览。" },
  editor: { title: "编辑器", description: "控制编辑器中的卡片视觉细节。" },
  storage: { title: "存储", description: "管理历史快照与冗余资源,保持知识库可备份、可迁移。" },
  image: { title: "图片", description: "控制图片进入知识库时的处理方式。" },
  search: { title: "搜索", description: "查看索引策略,并在异常时手动恢复搜索能力。" },
  about: { title: "关于", description: "了解砚知的产品原则与本地优先存储方式。" },
};

const THEME_OPTIONS: {
  value: ThemeMode;
  label: string;
  description: string;
  icon: typeof Sun;
}[] = [
  { value: "system", label: "跟随系统", description: "随 OS 外观即时切换", icon: Monitor },
  { value: "light", label: "浅色", description: "暖白纸面,适合日间", icon: Sun },
  { value: "dark", label: "深色", description: "墨色外壳,适合夜间", icon: Moon },
];

const LAUNCH_OPTIONS: { value: LaunchMode; label: string; description: string }[] = [
  { value: "last", label: "打开上次的知识库", description: "路径失效时回到欢迎页" },
  { value: "welcome", label: "显示欢迎页", description: "手动选择要进入的知识库" },
];

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="border-border-subtle mb-1 border-b pb-4">
      <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="text-muted-foreground mt-1 text-xs leading-5">{description}</p>
    </header>
  );
}

function SettingsSection({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-foreground/80 text-xs font-semibold tracking-[0.03em]">{title}</h3>
        {action}
      </div>
      {children}
      {hint && <Hint>{hint}</Hint>}
    </section>
  );
}

/** 卡片式单选:比分段控件能承载一句说明,适合主题/启动这类语义选择。 */
function OptionCards<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns = 1,
}: {
  options: { value: T; label: string; description?: string; icon?: typeof Sun }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  columns?: 1 | 3;
}) {
  return (
    <div
      className={cn("gap-2", columns === 3 ? "grid grid-cols-3" : "flex flex-col")}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map(({ value: optionValue, label, description, icon: Icon }) => {
        const active = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            className={cn(
              "border-border-subtle bg-raised/55 hover:border-primary/25 flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
              active && "bg-selection border-primary/25 ring-primary/10 ring-1",
              columns === 3 && "flex-col items-start",
            )}
            onClick={() => onChange(optionValue)}
          >
            {Icon && (
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-md",
                  active ? "bg-primary/15 text-primary" : "bg-hover text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">{label}</span>
              {description && (
                <span className="text-muted-foreground mt-0.5 block text-[10px] leading-4">
                  {description}
                </span>
              )}
            </span>
            {active && <Check className="text-primary size-3.5 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}

/** 行组:统一卡片容器 + 行分隔(设置行的唯一形态) */
function Group({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border-subtle border-border-subtle overflow-hidden rounded-lg border">{children}</div>;
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

/** 独立模板分类:模板属于当前知识库,不再混入“通用”的应用级设置。 */
function TemplatesPane({
  onCreateFromCurrent,
  onDirtyChange,
}: {
  onCreateFromCurrent?: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void kbBackend
      .getRecent()
      .then((r) => {
        if (alive) setRoot(r.last);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <TemplateWorkbench
      root={root}
      onCreateFromCurrent={onCreateFromCurrent}
      onDirtyChange={onDirtyChange}
    />
  );
}

function AssetCleanupRow() {
  const [root, setRoot] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void kbBackend
      .getRecent()
      .then((r) => {
        if (alive) setRoot(r.last);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Row label="未引用资源">
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2.5 text-xs"
        disabled={!root}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        扫描并清理…
      </Button>
      <AssetCleanupDialog open={open} onOpenChange={setOpen} root={root} />
    </Row>
  );
}

/** 数字输入(快照上限/间隔):失焦与输入都即时钳制,parseSettings 同口径兜底 */
function NumberInput({
  value,
  min,
  max,
  onChange,
  ariaLabel,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  unit?: string;
}) {
  const set = (next: number) => onChange(Math.min(max, Math.max(min, Math.round(next))));
  return (
    <span className="border-border-subtle bg-raised flex h-8 items-center rounded-lg border">
      <button
        type="button"
        aria-label={`减少${ariaLabel}`}
        className="text-muted-foreground hover:text-foreground hover:bg-hover flex size-7 cursor-pointer items-center justify-center rounded-l-md"
        disabled={value <= min}
        onClick={() => set(value - 1)}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        aria-label={ariaLabel}
        className="h-full w-14 bg-transparent text-center text-sm tabular-nums outline-none"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set(n);
        }}
      />
      {unit && (
        <span className="text-muted-foreground pr-2 text-[10px] tabular-nums">{unit}</span>
      )}
      <button
        type="button"
        aria-label={`增加${ariaLabel}`}
        className="text-muted-foreground hover:text-foreground hover:bg-hover flex size-7 cursor-pointer items-center justify-center rounded-r-md"
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        <Plus className="size-3.5" />
      </button>
    </span>
  );
}

/** 主色色板(长方形色块 + 名称,3 列) */
function AccentPicker({
  value,
  customAccent,
  onChange,
}: {
  value: string;
  customAccent: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {ACCENT_PRESETS.map((p) => {
        const active = !customAccent && value === p.id;
        return (
          <button
            key={p.id}
            aria-label={`主色:${p.name}`}
            aria-pressed={active}
            className={cn(
              "hover:border-primary/50 cursor-pointer rounded-lg border p-2 text-left transition-colors",
              active ? "ring-primary border-primary/40 ring-2" : "border-border-subtle hover:border-primary/25",
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

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <span className="flex items-center gap-2">
        <input
          type="range"
          aria-label={label}
          className="accent-primary w-28 cursor-pointer"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{display}</span>
      </span>
    </Row>
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

      <div className="bg-hover rounded-lg p-4">
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
  onCreateTemplateFromCurrent?: () => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsPage({
  settings,
  onChange,
  onRebuildIndex,
  onCreateTemplateFromCurrent,
  tab,
  onTabChange,
}: SettingsPageProps) {
  const [templateDirty, setTemplateDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);
  const changeTab = (next: SettingsTab) => {
    if (tab === "templates" && templateDirty && next !== "templates") {
      setPendingTab(next);
      return;
    }
    onTabChange(next);
  };
  const typographyDefault =
    settings.readerFont === "default" &&
    settings.readerFontSize === 16 &&
    settings.readerLineHeight === 1.75 &&
    settings.readerParagraphSpacing === 0.75;
  const snapshotDefault = settings.snapshotKeep === 30 && settings.snapshotIntervalMin === 5;
  return (
    <div className="bg-editor text-foreground flex h-full min-h-0 text-sm">
      <nav className="bg-sidebar border-border-subtle flex w-44 shrink-0 flex-col gap-3 border-r p-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="text-muted-foreground/60 px-2.5 text-[10px] font-semibold tracking-[0.06em]">
              {group.title}
            </p>
            {group.tabs
              .map((id) => TABS.find((item) => item.id === id)!)
              .map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  aria-current={tab === id}
                  className={cn(
                    "flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors",
                    tab === id
                      ? "bg-raised text-foreground ring-primary/15 shadow-[0_1px_2px_color-mix(in_oklab,var(--workspace)_45%,transparent)] font-medium ring-1"
                      : "text-muted-foreground hover:text-foreground hover:bg-hover",
                  )}
                  onClick={() => changeTab(id)}
                >
                  <Icon className={cn("size-4 shrink-0", tab === id && "text-primary")} />
                  {label}
                </button>
              ))}
          </div>
        ))}
        <span className="text-muted-foreground/60 mt-auto px-2.5 pt-2 text-[10px]">砚知 v{APP_VERSION}</span>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto space-y-5 p-6", tab === "templates" ? "max-w-2xl" : "max-w-lg")}>
          <PageHeader title={PAGE_META[tab].title} description={PAGE_META[tab].description} />

          {tab === "general" && (
            <>
              <SettingsSection title="启动" hint="选择砚知启动后的第一步行为">
                <OptionCards
                  ariaLabel="启动时"
                  options={LAUNCH_OPTIONS}
                  value={settings.launch}
                  onChange={(v) => onChange({ launch: v })}
                />
              </SettingsSection>
              <SettingsSection
                title="数据边界"
                hint="应用设置不进入知识库;复制或备份知识库文件夹不会带走这里的偏好"
              >
                <Group>
                  <ValueRow label="应用设置" value="本机应用目录" />
                  <ValueRow label="知识库数据" value="用户选择的知识库文件夹" />
                </Group>
              </SettingsSection>
            </>
          )}

          {tab === "templates" && (
            <>
              {pendingTab && (
                <div className="border-border-subtle bg-hover/50 mb-3 rounded-lg border p-3 text-xs">
                  <p className="font-medium">模板修改尚未保存,切换分类会丢弃这些修改。</p>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setPendingTab(null)}>
                      继续编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setTemplateDirty(false);
                        setPendingTab(null);
                        onTabChange(pendingTab);
                      }}
                    >
                      丢弃修改
                    </Button>
                  </div>
                </div>
              )}
              <TemplatesPane
                onCreateFromCurrent={onCreateTemplateFromCurrent}
                onDirtyChange={setTemplateDirty}
              />
            </>
          )}

          {tab === "appearance" && (
            <>
              <SettingsSection title="主题" hint="选择砚知的整体明暗关系;跟随系统会实时响应 OS 切换">
                <OptionCards
                  ariaLabel="主题"
                  options={THEME_OPTIONS}
                  value={settings.theme}
                  onChange={(v) => onChange({ theme: v })}
                  columns={3}
                />
              </SettingsSection>
              <SettingsSection title="主色" hint="自定义颜色会生成匹配的浅色、深色主色与选中底色">
                <AccentPicker
                  value={settings.accent}
                  customAccent={settings.customAccent}
                  onChange={(id) => onChange({ accent: id, customAccent: null })}
                />
                <Group>
                  <Row label="自定义主色">
                    <span className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="自定义主色"
                        className="border-border-subtle bg-raised h-7 w-10 cursor-pointer rounded border p-0.5"
                        value={settings.customAccent ?? "#2f80c1"}
                        onChange={(e) => onChange({ customAccent: e.target.value })}
                      />
                      {settings.customAccent && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground h-7 px-2 text-xs"
                          onClick={() => onChange({ customAccent: null })}
                        >
                          恢复预设
                        </Button>
                      )}
                    </span>
                  </Row>
                </Group>
              </SettingsSection>
              <SettingsSection
                title="正文排版"
                hint="只影响阅读观感,不写入 Markdown"
                action={
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={typographyDefault}
                    onClick={() =>
                      onChange({
                        readerFont: "default",
                        readerFontSize: 16,
                        readerLineHeight: 1.75,
                        readerParagraphSpacing: 0.75,
                      })
                    }
                  >
                    <RotateCcw className="size-3" />
                    恢复默认
                  </Button>
                }
              >
                <Group>
                  <Row label="字体">
                    <select
                      aria-label="正文字体"
                      className="border-border-subtle bg-raised h-8 cursor-pointer rounded-md border px-2 text-xs outline-none"
                      value={settings.readerFont}
                      onChange={(e) => onChange({ readerFont: e.target.value as ReaderFont })}
                    >
                      <option value="default">系统默认</option>
                      <option value="serif">宋体</option>
                      <option value="kai">楷体</option>
                    </select>
                  </Row>
                  <RangeRow
                    label="字号"
                    value={settings.readerFontSize}
                    min={13}
                    max={22}
                    step={1}
                    display={`${settings.readerFontSize}px`}
                    onChange={(v) => onChange({ readerFontSize: v })}
                  />
                  <RangeRow
                    label="行高"
                    value={settings.readerLineHeight}
                    min={1.3}
                    max={2.2}
                    step={0.05}
                    display={settings.readerLineHeight.toFixed(2)}
                    onChange={(v) => onChange({ readerLineHeight: v })}
                  />
                  <RangeRow
                    label="段间距"
                    value={settings.readerParagraphSpacing}
                    min={0.2}
                    max={1.6}
                    step={0.05}
                    display={`${settings.readerParagraphSpacing.toFixed(2)}em`}
                    onChange={(v) => onChange({ readerParagraphSpacing: v })}
                  />
                </Group>
              </SettingsSection>
            </>
          )}

          {tab === "editor" && (
            <SettingsSection title="卡片视觉" hint="关闭后保留占位与底色,避免内容布局跳动">
              <Group>
                <SwitchRow
                  label="特殊卡片显示边框"
                  checked={settings.cardBorder}
                  onCheckedChange={(v) => onChange({ cardBorder: v })}
                />
              </Group>
            </SettingsSection>
          )}

          {tab === "storage" && (
            <>
              <SettingsSection
                title="历史快照"
                hint="快照存在知识库的 .yanzhi/history;自动快照要求内容有变化,超出上限清理最旧"
                action={
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={snapshotDefault}
                    onClick={() => onChange({ snapshotKeep: 30, snapshotIntervalMin: 5 })}
                  >
                    <RotateCcw className="size-3" />
                    恢复默认
                  </Button>
                }
              >
                <Group>
                <Row label="每篇保留上限">
                  <NumberInput
                    ariaLabel="保留快照上限"
                    unit="份"
                    value={settings.snapshotKeep}
                    min={1}
                    max={200}
                    onChange={(v) => onChange({ snapshotKeep: v })}
                  />
                </Row>
                <Row label="自动快照间隔">
                  <NumberInput
                    ariaLabel="自动快照最小间隔分钟"
                    unit="分钟"
                    value={settings.snapshotIntervalMin}
                    min={0}
                    max={120}
                    onChange={(v) => onChange({ snapshotIntervalMin: v })}
                  />
                </Row>
                </Group>
              </SettingsSection>
              <SettingsSection
                title="资源维护"
                hint="删除后不可恢复;Markdown 仍会引用到的图片和附件不会出现在候选列表"
              >
                <Group>
                  <AssetCleanupRow />
                </Group>
              </SettingsSection>
            </>
          )}

          {tab === "image" && (
            <SettingsSection
              title="图片处理"
              hint="WebP 质量 85;SVG、GIF 或压缩后更大时保留原图"
            >
              <Group>
                <SwitchRow
                  label="粘贴图片自动压缩"
                  checked={settings.imageCompress}
                  onCheckedChange={(v) => onChange({ imageCompress: v })}
                />
              </Group>
            </SettingsSection>
          )}

          {tab === "search" && (
            <SettingsSection title="全文索引" hint="索引只在本机构建,不会上传任何文档内容">
              <Group>
                <ValueRow label="索引时机" value="保存时自动更新" />
                <Row label="索引异常或内容缺失">
                  <Button size="sm" variant="outline" onClick={onRebuildIndex}>
                    重建索引
                  </Button>
                </Row>
              </Group>
            </SettingsSection>
          )}

          {tab === "about" && <AboutPane />}
        </div>
      </div>
    </div>
  );
}
