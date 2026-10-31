import { useEffect, useState } from "react";
import {
  Check,
  Database,
  Image as ImageIcon,
  Info,
  Monitor,
  Moon,
  Palette,
  PenLine,
  Search,
  SlidersHorizontal,
  Sun,
  Trash2,
  Vault,
} from "lucide-react";
import { kbBackend } from "./backend";
import { TemplateManager } from "./TemplateManager";
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
  | "appearance"
  | "editor"
  | "storage"
  | "image"
  | "search"
  | "about";

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "editor", label: "编辑器", icon: PenLine },
  { id: "storage", label: "存储", icon: Database },
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

/** 模板文件夹行(7.5):设置窗独立于主窗,root 经 getRecent 取;
 *  主入口 = 应用内管理对话框,「打开」文件夹留给习惯文件系统的用户 */
function TemplatesRow() {
  const [root, setRoot] = useState<string | null>(null);
  const [mgrOpen, setMgrOpen] = useState(false);
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
    <Row label="模板文件夹">
      {root ? (
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            aria-label="管理模板"
            onClick={() => setMgrOpen(true)}
          >
            管理模板…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-7 px-2.5 text-xs"
            aria-label="打开模板文件夹"
            onClick={() => void kbBackend.openTemplatesDir(root)}
          >
            打开
          </Button>
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">未打开知识库</span>
      )}
      <TemplateManager open={mgrOpen} onOpenChange={setMgrOpen} root={root} />
    </Row>
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
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className="border-border bg-background focus:ring-ring h-8 w-24 rounded-md border px-2 text-right text-sm tabular-nums outline-none focus:ring-2"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
    />
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-muted-foreground text-xs font-medium">{children}</h3>
);

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
              <section className="space-y-2">
                <SectionTitle>文档模板</SectionTitle>
                <Group>
                  <TemplatesRow />
                </Group>
                <Hint>模板是知识库 `.yanzhi/templates` 文件夹里的 .md 文件;放入后新建文档可选择从模板创建</Hint>
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
                        className="border-border bg-background h-7 w-10 cursor-pointer rounded border p-0.5"
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
                <Hint>自定义颜色会生成匹配的浅色、深色主色与选中底色</Hint>
              </section>
              <section className="space-y-2">
                <SectionTitle>排版</SectionTitle>
                <Group>
                  <Row label="字体">
                    <select
                      aria-label="正文字体"
                      className="border-border bg-background h-8 cursor-pointer rounded-md border px-2 text-xs outline-none"
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
                <Hint>只影响正文阅读观感,不写入 Markdown</Hint>
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

          {tab === "storage" && (
            <>
              <section className="space-y-2">
                <SectionTitle>历史快照</SectionTitle>
                <Group>
                <Row label="每篇文档保留快照上限">
                  <NumberInput
                    ariaLabel="保留快照上限"
                    value={settings.snapshotKeep}
                    min={1}
                    max={200}
                    onChange={(v) => onChange({ snapshotKeep: v })}
                  />
                </Row>
                <Row label="自动快照最小间隔(分钟)">
                  <NumberInput
                    ariaLabel="自动快照最小间隔分钟"
                    value={settings.snapshotIntervalMin}
                    min={0}
                    max={120}
                    onChange={(v) => onChange({ snapshotIntervalMin: v })}
                  />
                </Row>
                </Group>
                <Hint>
                  快照存在知识库的 .yanzhi/history 里;自动快照要求内容有变化,超出上限自动清理最旧的
                </Hint>
              </section>
              <section className="space-y-2">
                <SectionTitle>资源文件</SectionTitle>
                <Group>
                  <AssetCleanupRow />
                </Group>
                <Hint>删除后不可恢复;Markdown 仍会引用到的图片和附件不会出现在候选列表</Hint>
              </section>
            </>
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
