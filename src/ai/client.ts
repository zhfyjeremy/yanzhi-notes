/**
 * AI 请求层:Tauri invoke / 浏览器 mock(localStorage Key + fetch)。
 * Key 存储统一走本模块:Tauri=系统安全存储+进程内兜底缓存;浏览器 dev=localStorage。
 * Key 只会作为鉴权头发往用户填写的模型 Endpoint,不上传砚知服务器。
 * 关闭总开关时上层不得调用;本层仍假定调用方已检查。
 */

import { invoke } from "@tauri-apps/api/core";
import { aiChatUrl, aiModelsUrl, isAnthropicBase } from "./providers";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const MOCK_KEY = "yz-ai-api-key";

export interface AiChatParams {
  baseUrl: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  requestId: string;
}

function chatUrl(base: string): string {
  return aiChatUrl(base);
}

function assertBase(base: string): string {
  const raw = base.trim().replace(/\/$/, "");
  if (!raw) throw new Error("请填写 API Base URL");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("API Base URL 无效");
  }
  if (u.protocol === "https:") return raw;
  if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
    return raw;
  }
  throw new Error("仅允许 https,或本机 http://127.0.0.1 / localhost");
}

const abortMap = new Map<string, AbortController>();

export async function setAiKey(key: string): Promise<void> {
  if (isTauri()) {
    await invoke("set_ai_key", { key });
    return;
  }
  const k = key.trim();
  if (!k) localStorage.removeItem(MOCK_KEY);
  else localStorage.setItem(MOCK_KEY, k);
}

export async function clearAiKey(): Promise<void> {
  if (isTauri()) {
    await invoke("clear_ai_key");
    return;
  }
  localStorage.removeItem(MOCK_KEY);
}

export async function hasAiKey(): Promise<boolean> {
  if (isTauri()) return invoke<boolean>("has_ai_key");
  return Boolean(localStorage.getItem(MOCK_KEY)?.trim());
}

export async function listAiModels(baseUrl: string, keyDraft?: string): Promise<string[]> {
  if (isTauri()) {
    return invoke<string[]>("ai_list_models", {
      baseUrl,
      key: keyDraft?.trim() || null,
    });
  }
  const base = assertBase(baseUrl);
  const key = keyDraft?.trim() || localStorage.getItem(MOCK_KEY)?.trim();
  if (!key) throw new Error("未配置 API Key");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (isAnthropicBase(base)) {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  }
  const res = await fetch(aiModelsUrl(base), { headers });
  const text = await res.text();
  let json: { data?: { id?: string }[]; error?: { message?: string } };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (json.error?.message) throw new Error(json.error.message);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const models = (json.data ?? [])
    .map((m) => m.id?.trim())
    .filter((m): m is string => Boolean(m));
  if (!models.length) throw new Error("接口未返回可用模型");
  return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}

export async function testAiConnection(
  baseUrl: string,
  model: string,
  keyDraft?: string,
): Promise<string> {
  if (isTauri()) {
    return invoke<string>("ai_test_connection", {
      baseUrl,
      model,
      key: keyDraft?.trim() || null,
    });
  }
  const id = `test-${Date.now()}`;
  const previousKey = localStorage.getItem(MOCK_KEY);
  if (keyDraft?.trim()) localStorage.setItem(MOCK_KEY, keyDraft.trim());
  try {
    await aiChat({
      baseUrl,
      model,
      system: "You are a connection probe. Reply with exactly: ok",
      user: "ping",
      temperature: 0,
      maxTokens: 64,
      requestId: id,
    });
    return "连接成功";
  } finally {
    if (keyDraft?.trim()) {
      if (previousKey === null) localStorage.removeItem(MOCK_KEY);
      else localStorage.setItem(MOCK_KEY, previousKey);
    }
  }
}

export async function aiChat(p: AiChatParams): Promise<string> {
  if (isTauri()) {
    return invoke<string>("ai_chat", {
      baseUrl: p.baseUrl,
      model: p.model,
      system: p.system,
      user: p.user,
      temperature: p.temperature,
      maxTokens: p.maxTokens > 0 ? p.maxTokens : null,
      requestId: p.requestId,
    });
  }
  const base = assertBase(p.baseUrl);
  const key = localStorage.getItem(MOCK_KEY)?.trim();
  if (!key) throw new Error("未配置 API Key");
  const ctrl = new AbortController();
  abortMap.set(p.requestId, ctrl);
  try {
    const anthropic = isAnthropicBase(base);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
    if (anthropic) {
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
    }
    const body = anthropic
      ? {
          model: p.model,
          system: p.system,
          messages: [{ role: "user", content: p.user }],
          temperature: p.temperature,
          max_tokens: p.maxTokens > 0 ? p.maxTokens : 2048,
        }
      : {
          model: p.model,
          messages: [
            { role: "system", content: p.system },
            { role: "user", content: p.user },
          ],
          temperature: p.temperature,
          ...(p.maxTokens > 0 ? { max_tokens: p.maxTokens } : {}),
        };
    const res = await fetch(chatUrl(base), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: {
      choices?: { message?: { content?: string } }[];
      content?: { type?: string; text?: string }[];
      error?: { message?: string };
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (json.error?.message) throw new Error(json.error.message);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    const content = anthropic
      ? (json.content ?? [])
          .filter((part) => !part.type || part.type === "text")
          .map((part) => part.text ?? "")
          .join("")
          .trim()
      : json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) throw new Error("模型返回空内容");
    return content;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("已取消");
    throw e;
  } finally {
    abortMap.delete(p.requestId);
  }
}

export async function cancelAi(requestId: string): Promise<void> {
  if (isTauri()) {
    await invoke("ai_cancel", { requestId });
    return;
  }
  abortMap.get(requestId)?.abort();
  abortMap.delete(requestId);
}

/** 从 Base URL 解析展示用 host */
export function hostOfBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host || baseUrl;
  } catch {
    return baseUrl.trim() || "—";
  }
}
