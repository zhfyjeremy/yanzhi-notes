import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Shield } from "lucide-react";
import type { AppSettings } from "../settings";
import { clearAiKey, hasAiKey, setAiKey, testAiConnection } from "./client";
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
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 px-3.5 py-3">
      <div>
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">{hint}</p>}
      </div>
      {children}
    </div>
  );
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
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const provider = aiProviderById(settings.aiProvider);
  const isCustom = provider.id === "custom";

  const refreshHasKey = () => {
    void hasAiKey()
      .then(setConfigured)
      .catch(() => setConfigured(false));
  };

  useEffect(() => {
    refreshHasKey();
  }, []);

  const selectProvider = (id: AiProviderId) => {
    const next = aiProviderById(id);
    setTestMsg(null);
    if (id === "custom") {
      onChange({ aiProvider: id });
      return;
    }
    onChange({
      aiProvider: id,
      aiBaseUrl: next.baseUrl,
      aiModel: next.model,
    });
  };

  const saveKey = async () => {
    setTestMsg(null);
    try {
      if (keyDraft.trim()) await setAiKey(keyDraft.trim());
      setKeyDraft("");
      refreshHasKey();
      setTestMsg(keyDraft.trim() ? "Key 已保存到本机安全存储" : null);
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : String(e));
    }
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

  const onTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      if (keyDraft.trim()) await setAiKey(keyDraft.trim());
      const msg = await testAiConnection(settings.aiBaseUrl, settings.aiModel);
      refreshHasKey();
      setKeyDraft("");
      setTestMsg(msg);
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
              仅存本机安全存储,永不写入知识库或导出包。
            </p>
          </div>
        </div>
      </aside>

      <section className="space-y-2">
        <h3 className="text-muted-foreground px-0.5 text-[11px] font-semibold tracking-wide">开关与连接</h3>
        <Group>
          <Row label="启用 AI 助手" hint="关闭后编辑器内隐藏 AI 入口,且不发起模型请求">
            <Switch
              checked={settings.aiEnabled}
              onCheckedChange={(v) => onChange({ aiEnabled: v })}
            />
          </Row>

          <Field label="服务商" hint={provider.hint}>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {AI_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className={cn(
                    "border-border-subtle h-8 rounded-lg border text-[12px] font-medium transition-colors",
                    settings.aiProvider === p.id
                      ? "bg-selection text-foreground ring-primary/25 ring-1"
                      : "bg-raised/60 text-muted-foreground hover:text-foreground hover:bg-hover",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="API Base URL"
            hint={
              isCustom
                ? "OpenAI 兼容;本地 Ollama 可用 http://127.0.0.1:11434/v1"
                : "由服务商预设填充;改用其它地址请选「自定义」"
            }
          >
            <Input
              value={settings.aiBaseUrl}
              placeholder="https://api.openai.com/v1"
              readOnly={!isCustom}
              onChange={(e) => onChange({ aiBaseUrl: e.target.value, aiProvider: "custom" })}
              className={cn(!isCustom && "bg-muted/40 text-muted-foreground")}
            />
          </Field>

          <Field
            label="模型"
            hint={
              !isCustom && provider.models.length
                ? "可点选常用模型,也可直接改输入框"
                : undefined
            }
          >
            {!isCustom && provider.models.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {provider.models.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onChange({ aiModel: m })}
                    className={cn(
                      "border-border-subtle rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                      settings.aiModel === m
                        ? "bg-selection text-foreground ring-primary/20 ring-1"
                        : "text-muted-foreground hover:text-foreground hover:bg-hover",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={settings.aiModel}
              placeholder={provider.model}
              onChange={(e) => onChange({ aiModel: e.target.value })}
            />
          </Field>

          <Field
            label="API Key"
            hint={
              configured
                ? "已配置(掩码存储)。输入新值可覆盖;留空点保存不改动。"
                : "尚未配置。保存后写入系统钥匙串 / 本机安全存储。"
            }
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
              <Button type="button" size="sm" variant="secondary" onClick={() => void saveKey()}>
                保存 Key
              </Button>
            </div>
            {configured && (
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive mt-1.5 text-[11px]"
                onClick={() => void removeKey()}
              >
                清除已存 Key
              </button>
            )}
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
                  testMsg.includes("成功") || testMsg.includes("已保存") || testMsg.includes("已清除")
                    ? "text-muted-foreground"
                    : "text-destructive"
                }`}
              >
                {testMsg}
              </p>
            )}
          </div>
        </Group>
      </section>

      <section className="space-y-2">
        <h3 className="text-muted-foreground px-0.5 text-[11px] font-semibold tracking-wide">生成参数</h3>
        <Group>
          <Field label="温度" hint="0 更稳,2 更发散;默认 0.7">
            <Input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={settings.aiTemperature}
              onChange={(e) => onChange({ aiTemperature: Number(e.target.value) || 0 })}
              className="w-28"
            />
          </Field>
          <Field label="最大输出长度" hint="0 表示不限制(由服务商决定)">
            <Input
              type="number"
              min={0}
              max={128000}
              step={256}
              value={settings.aiMaxTokens}
              onChange={(e) => onChange({ aiMaxTokens: Math.round(Number(e.target.value) || 0) })}
              className="w-28"
            />
          </Field>
        </Group>
      </section>
    </div>
  );
}
