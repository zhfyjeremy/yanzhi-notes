import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleSlash,
  Eye,
  EyeOff,
  KeyRound,
  ListChecks,
  Loader2,
  RefreshCw,
  Shield,
  ShieldCheck,
} from "lucide-react";
import type { AppSettings } from "../settings";
import { clearAiKey, hasAiKey, hostOfBaseUrl, listAiModels, setAiKey, testAiConnection } from "./client";
import {
  AI_PROVIDERS,
  aiProviderById,
  type AiProviderId,
} from "./providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * 设置 → AI 助手(§7.8)
 * 服务商:Kimi / 智谱 / DeepSeek 预设 + 自定义 OpenAI 兼容 Endpoint。
 */

function Group({ children }: { children: React.ReactNode }) {
  return <div className="border-border-subtle divide-border-subtle divide-y overflow-hidden rounded-xl border">{children}</div>;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-3.5 py-3">
      <div className="min-w-0 pt-0.5">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  step,
  stepState,
  children,
}: {
  label: string;
  hint?: string;
  step?: string;
  stepState?: "done" | "active" | "locked";
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 px-3.5 py-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        {step && (
          <span
            className={cn(
              "mt-px flex size-5 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold tabular-nums",
              stepState === "done"
                ? "border-primary/35 bg-selection text-primary"
                : stepState === "active"
                  ? "border-primary/45 bg-primary/10 text-primary"
                  : "border-border-subtle bg-raised/70 text-muted-foreground",
            )}
            aria-hidden
          >
            {stepState === "done" ? "✓" : step}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[13px] font-medium">{label}</p>
          {hint && <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">{hint}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

type AiSetupPhase = "disabled" | "checking" | "connect" | "select" | "untested" | "ready";

const PHASE_META: Record<AiSetupPhase, { title: string; detail: string; badge: string }> = {
  disabled: { title: "AI 未开启", detail: "打开开关后开始三步配置", badge: "未开启" },
  checking: { title: "正在检查本机 Key", detail: "读取系统安全存储，不会发起网络请求", badge: "检查中" },
  connect: { title: "第 1 步 · 连接账号", detail: "粘贴 API Key，并连接获取模型", badge: "待连接" },
  select: { title: "第 2 步 · 选择模型", detail: "点击加载出的模型，或手填模型名", badge: "待选模型" },
  untested: { title: "配置完成 · 待测试", detail: "基础配置已保存，建议测试一次连接", badge: "待测试" },
  ready: { title: "AI 配置成功", detail: "可在选区 AI、右键 AI 与 /ai 中使用", badge: "可用" },
};

function PhaseIcon({ phase }: { phase: AiSetupPhase }) {
  const common = "size-4 shrink-0";
  if (phase === "ready") return <CheckCircle2 className={cn(common, "text-primary")} />;
  if (phase === "disabled") return <CircleSlash className={cn(common, "text-muted-foreground")} />;
  if (phase === "connect") return <KeyRound className={cn(common, "text-primary")} />;
  if (phase === "select") return <ListChecks className={cn(common, "text-primary")} />;
  if (phase === "untested") return <ShieldCheck className={cn(common, "text-primary")} />;
  return <Loader2 className={cn(common, "text-muted-foreground animate-spin")} />;
}

export function AiSettingsPanel({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [keyChecked, setKeyChecked] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const provider = aiProviderById(settings.aiProvider);
  const isCustom = provider.id === "custom";
  const availableModels = remoteModels;
  const modelReady = Boolean(settings.aiModel.trim());
  const interfaceReady = Boolean(settings.aiBaseUrl.trim());
  const phase: AiSetupPhase = !settings.aiEnabled
    ? "disabled"
    : !keyChecked
      ? "checking"
      : !configured
        ? "connect"
        : !modelReady
          ? "select"
          : !settings.aiVerified
            ? "untested"
            : "ready";
  const providerName = isCustom ? hostOfBaseUrl(settings.aiBaseUrl) : provider.label;
  const status = PHASE_META[phase];

  const refreshHasKey = () => {
    void hasAiKey()
      .then((has) => {
        setConfigured(has);
        setKeyChecked(true);
      })
      .catch(() => {
        setConfigured(false);
        setKeyChecked(true);
      });
  };

  useEffect(() => {
    refreshHasKey();
  }, []);

  // Key 被系统存储清除/读取失败时，不能让“测试通过”残留为虚假可用状态。
  useEffect(() => {
    if (keyChecked && !configured && settings.aiVerified) {
      onChange({ aiVerified: false });
    }
  }, [configured, keyChecked, settings.aiVerified]);

  const selectProvider = (id: AiProviderId) => {
    const next = aiProviderById(id);
    setTestMsg(null);
    setRemoteModels([]);
    setManualModel(false);
    if (id === "custom") {
      onChange({ aiProvider: id, aiVerified: false });
      return;
    }
    onChange({
      aiProvider: id,
      aiBaseUrl: next.baseUrl,
      aiModel: "",
      aiVerified: false,
    });
  };

  const removeKey = async () => {
    setTestMsg(null);
    try {
      await clearAiKey();
      setKeyDraft("");
      refreshHasKey();
      setTestMsg("已清除 Key");
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const onFetchModels = async () => {
    setLoadingModels(true);
    setTestMsg(null);
    setManualModel(false);
    try {
      if (keyDraft.trim()) await setAiKey(keyDraft.trim());
      const models = await listAiModels(settings.aiBaseUrl, keyDraft);
      setRemoteModels(models);
      refreshHasKey();
      if (!models.length) {
        setManualModel(true);
        setTestMsg("接口未返回模型列表，请手填模型名后测试连接");
        return;
      }
      setTestMsg(`已获取 ${models.length} 个模型，请选择`);
      if (!models.includes(settings.aiModel)) {
        onChange({ aiModel: models[0], aiVerified: false });
      }
    } catch (e) {
      setRemoteModels([]);
      setManualModel(true);
      setTestMsg(e instanceof Error ? e.message : String(e));
      refreshHasKey();
    } finally {
      setLoadingModels(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      if (keyDraft.trim()) await setAiKey(keyDraft.trim());
      const msg = await testAiConnection(settings.aiBaseUrl, settings.aiModel, keyDraft);
      onChange({ aiVerified: true });
      refreshHasKey();
      setTestMsg(msg);
      setKeyDraft("");
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <aside className="border-primary/35 bg-selection/40 relative overflow-hidden rounded-xl border border-l-[3px] border-l-primary px-3.5 py-3">
        <div className="flex gap-2.5">
          <Shield className="text-primary mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-1 text-[12px] leading-5">
            <p className="text-foreground font-medium">本地钥匙 · 直连你的模型</p>
            <p className="text-muted-foreground">
              请求只在你点击生成时发往你填写的服务商;砚知不中转、不代扣费。Key
              只保存在你这台电脑上,不会写入知识库或导出包。
            </p>
          </div>
        </div>
      </aside>

      <div className="border-border-subtle bg-raised/45 rounded-xl border px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <PhaseIcon phase={phase} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[13px] font-medium">{status.title}</p>
              <span
                className={cn(
                  "border-border-subtle rounded-md border px-1.5 py-0.5 text-[10px]",
                  phase === "ready" ? "bg-selection text-primary" : "text-muted-foreground",
                )}
              >
                {status.badge}
              </span>
            </div>
            <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
              {phase === "ready" ? `${providerName} · ${settings.aiModel}` : status.detail}
            </p>
          </div>
        </div>
        <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]" aria-label="AI 配置进度">
          {[
            { label: "开启", done: settings.aiEnabled },
            { label: "Key", done: configured },
            { label: "模型", done: configured && modelReady },
            { label: "测试", done: configured && modelReady && settings.aiVerified },
          ].map((step, i) => (
            <li
              key={step.label}
              className={cn(
                "border-border-subtle rounded-md border px-1.5 py-0.5",
                step.done ? "bg-selection text-primary" : "text-muted-foreground",
              )}
            >
              {i + 1}. {step.label}
            </li>
          ))}
        </ol>
      </div>

      <section className="space-y-2">
        <h3 className="text-muted-foreground px-0.5 text-[11px] font-semibold tracking-wide">开关与连接</h3>
        <Group>
          <Row label="启用 AI 助手" hint="关闭后编辑器内隐藏 AI 入口,且不发起模型请求">
            <Switch
              checked={settings.aiEnabled}
              onCheckedChange={(v) => onChange({ aiEnabled: v })}
            />
          </Row>

          {settings.aiEnabled && (
          <>
          <Field
            label="服务商与接口"
            hint={provider.hint}
            step="1"
            stepState={interfaceReady ? "done" : "active"}
          >
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {AI_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className={cn(
                    "border-border-subtle h-9 rounded-lg border text-[12px] font-medium transition-colors",
                    settings.aiProvider === p.id
                      ? "bg-selection text-foreground ring-primary/25 ring-1"
                      : "bg-raised/60 text-muted-foreground hover:text-foreground hover:bg-hover",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Input
              value={settings.aiBaseUrl}
              placeholder="https://api.openai.com/v1"
              readOnly={!isCustom}
              onChange={(e) => {
                setRemoteModels([]);
                onChange({
                  aiBaseUrl: e.target.value,
                  aiProvider: "custom",
                  aiVerified: false,
                });
              }}
              className={cn(!isCustom && "bg-muted/40 text-muted-foreground")}
            />
          </Field>

          <Field
            label="连接账号"
            hint={
              configured
                ? "Key 已保存在本机安全存储。输入新 Key 后点击连接可覆盖。"
                : "先粘贴 API Key，再连接并获取模型；Key 只写入本机安全存储。"
            }
            step="2"
            stepState={configured ? "done" : "active"}
          >
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={keyDraft}
                  placeholder={configured ? "••••••••  (已保存)" : "sk-…"}
                  autoComplete="off"
                  onChange={(e) => setKeyDraft(e.target.value)}
                  className="pr-9"
                />
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                >
                  {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={loadingModels || !settings.aiBaseUrl.trim() || (!keyDraft.trim() && !configured)}
                onClick={() => void onFetchModels()}
                className="h-9 shrink-0"
              >
                {loadingModels ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                连接并获取
              </Button>
            </div>
            {configured && (
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive text-[11px]"
                onClick={() => {
                  void removeKey();
                  setRemoteModels([]);
                  onChange({ aiVerified: false });
                }}
              >
                清除已存 Key
              </button>
            )}
          </Field>

          <Field
            label="选择模型"
            hint={
              availableModels.length
                ? "已从服务商加载，点击选择后可测试连接"
                : "连接并获取后展示可用模型；若接口无列表请手填模型名"
            }
            step="3"
            stepState={!configured ? "locked" : modelReady ? "done" : "active"}
          >
            {availableModels.length > 0 && (
              <div className="border-border-subtle bg-muted/25 max-h-44 overflow-y-auto rounded-lg border p-2">
                <div className="flex flex-wrap gap-1.5">
                  {availableModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setManualModel(false);
                        onChange({ aiModel: m, aiVerified: false });
                      }}
                      className={cn(
                        "border-border-subtle rounded-md border px-2.5 py-1 text-[11px] transition-colors",
                        !manualModel && settings.aiModel === m
                          ? "bg-selection text-foreground ring-primary/25 ring-1"
                          : "text-muted-foreground hover:text-foreground hover:bg-hover",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={settings.aiModel}
                placeholder={provider.model || "模型名"}
                readOnly={!manualModel && availableModels.length > 0}
                onChange={(e) => onChange({ aiModel: e.target.value, aiVerified: false })}
                className={cn(
                  !manualModel && availableModels.length > 0 && "bg-muted/40 text-muted-foreground",
                )}
              />
              {availableModels.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setManualModel((v) => !v)}
                  className="h-9 shrink-0"
                >
                  {manualModel ? "选择模型" : "手填模型"}
                </Button>
              )}
            </div>
          </Field>

          <div className="flex items-center gap-2 px-3.5 py-3">
            <Button
              type="button"
              size="sm"
              disabled={testing || !settings.aiBaseUrl.trim() || !settings.aiModel.trim()}
              onClick={() => void onTest()}
            >
              {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
              测试连接
            </Button>
            {testMsg && (
              <p
                className={`min-w-0 flex-1 text-[11px] leading-4 ${
                  testMsg.includes("成功") || testMsg.includes("已获取") || testMsg.includes("已清除")
                    ? "text-muted-foreground"
                    : "text-destructive"
                }`}
              >
                {testMsg}
              </p>
            )}
          </div>
          </>
          )}
        </Group>
      </section>

    </div>
  );
}
