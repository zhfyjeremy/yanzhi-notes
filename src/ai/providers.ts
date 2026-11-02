/**
 * AI 服务商预设(OpenAI 兼容 Chat Completions)。
 * Key 仍走安全存储;此处只固化 Base URL 与常用模型名。
 */

export type AiProviderId = "kimi" | "zhipu" | "deepseek" | "custom";

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  /** 展示用一句话 */
  hint: string;
  baseUrl: string;
  /** 默认模型 */
  model: string;
  /** 下拉可选;自定义仍可手填 */
  models: readonly string[];
}

export const AI_PROVIDERS: readonly AiProviderPreset[] = [
  {
    id: "kimi",
    label: "Kimi",
    hint: "月之暗面 Moonshot(国内 api.moonshot.cn)",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k", "kimi-latest"],
  },
  {
    id: "zhipu",
    label: "智谱",
    hint: "智谱 GLM(OpenAI 兼容 /api/paas/v4)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    models: ["glm-4-flash", "glm-4.7-flash", "glm-4.5-flash", "glm-5-turbo", "glm-4.6"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "深度求索(OpenAI 兼容)",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner", "deepseek-flash"],
  },
  {
    id: "custom",
    label: "自定义",
    hint: "任意 OpenAI 兼容 Endpoint(含 Ollama 本机)",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    models: [],
  },
] as const;

export function aiProviderById(id: string | undefined | null): AiProviderPreset {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS.find((p) => p.id === "custom")!;
}

/** 按已存 Base URL 反推服务商(旧配置无 aiProvider 时迁移) */
export function inferAiProvider(baseUrl: string): AiProviderId {
  const u = baseUrl.trim().toLowerCase().replace(/\/$/, "");
  if (u.includes("moonshot.cn") || u.includes("moonshot.ai") || u.includes("kimi.ai")) {
    return "kimi";
  }
  if (u.includes("bigmodel.cn") || u.includes("zhipuai")) return "zhipu";
  if (u.includes("deepseek.com")) return "deepseek";
  return "custom";
}

/** 拼 Chat Completions 完整 URL(与 Rust ai::chat_url 对齐) */
export function aiChatUrl(base: string): string {
  const b = base.trim().replace(/\/$/, "");
  if (b.endsWith("/chat/completions")) return b;
  // /v1、智谱 /v4 等版本后缀
  if (/\/v\d+$/i.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}
