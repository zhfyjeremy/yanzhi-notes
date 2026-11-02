/**
 * AI 请求层:Tauri invoke / 浏览器 mock(localStorage Key + fetch)。
 * 关闭总开关时上层不得调用;本层仍假定调用方已检查。
 */

import { invoke } from "@tauri-apps/api/core";
import { aiChatUrl } from "./providers";

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

export async function testAiConnection(baseUrl: string, model: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>("ai_test_connection", { baseUrl, model });
  }
  const id = `test-${Date.now()}`;
  await aiChat({
    baseUrl,
    model,
    system: "You are a connection probe. Reply with exactly: ok",
    user: "ping",
    temperature: 0,
    maxTokens: 8,
    requestId: id,
  });
  return "连接成功";
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
    const res = await fetch(chatUrl(base), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: "system", content: p.system },
          { role: "user", content: p.user },
        ],
        temperature: p.temperature,
        ...(p.maxTokens > 0 ? { max_tokens: p.maxTokens } : {}),
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (json.error?.message) throw new Error(json.error.message);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
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
