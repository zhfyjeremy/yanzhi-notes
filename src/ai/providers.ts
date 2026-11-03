/**
 * AI 服务商预设;Kimi Coding 使用 Anthropic Messages,其余为 OpenAI 兼容。
 * Key 仍走安全存储;此处只固化 Base URL 与常用模型名。
 */

export type AiProviderId = "kimi_coding" | "zhipu" | "deepseek" | "custom";

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
    id: "kimi_coding",
    label: "Kimi Coding",
    hint: "Kimi Coding 套餐(Anthropic 兼容 api.kimi.com/coding)",
    baseUrl: "https://api.kimi.com/coding",
    model: "kimi-for-coding",
    models: ["kimi-for-coding", "kimi-for-coding-highspeed", "k3"],
  },
  {
    id: "zhipu",
    label: "智谱",
    // 对话补全用 paas/v4;/api/v1 是 Responses(Codex/CCSwitch),本应用不走该协议
    hint: "智谱 GLM 对话补全(OpenAI 兼容 /api/paas/v4)",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    models: ["glm-4-flash", "glm-5.3", "glm-5-turbo", "glm-4.7-flash", "glm-4.6"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "深度求索(OpenAI 兼容)",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-flash", "deepseek-v4-pro", "deepseek-reasoner"],
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
  if (u.startsWith("https://api.kimi.com/coding")) return "kimi_coding";
  if (u.includes("bigmodel.cn") || u.includes("zhipuai")) return "zhipu";
  if (u.includes("deepseek.com")) return "deepseek";
  return "custom";
}

/** 拼 Chat Completions 完整 URL(与 Rust ai::chat_url 对齐) */
export function aiChatUrl(base: string): string {
  const b = base.trim().replace(/\/$/, "");
  if (isAnthropicBase(b)) return `${b}/v1/messages`;
  if (b.endsWith("/chat/completions")) return b;
  // /v1、/v4 等版本后缀
  if (/\/v\d+$/i.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

/** Kimi Coding 走 Anthropic Messages 协议 */
export function isAnthropicBase(base: string): boolean {
  return base.trim().toLowerCase().startsWith("https://api.kimi.com/coding");
}

/** 拼 OpenAI-compatible 模型列表 URL(与 Rust ai::models_url 对齐) */
export function aiModelsUrl(base: string): string {
  const b = base.trim().replace(/\/$/, "").replace(/\/chat\/completions$/, "");
  if (isAnthropicBase(b)) return `${b}/v1/models`;
  if (b.endsWith("/models")) return b;
  if (/\/v\d+$/i.test(b)) return `${b}/models`;
  return `${b}/v1/models`;
}
