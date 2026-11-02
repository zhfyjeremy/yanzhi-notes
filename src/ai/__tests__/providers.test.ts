import { describe, expect, it } from "vitest";
import { aiChatUrl, aiProviderById, inferAiProvider } from "../providers";

describe("ai providers", () => {
  it("预设含 kimi / 智谱 / deepseek / 自定义", () => {
    expect(aiProviderById("kimi").baseUrl).toContain("moonshot.cn");
    expect(aiProviderById("zhipu").baseUrl).toContain("bigmodel.cn");
    expect(aiProviderById("deepseek").baseUrl).toContain("deepseek.com");
    expect(aiProviderById("custom").id).toBe("custom");
    expect(aiProviderById("nope").id).toBe("custom");
  });

  it("按 Base URL 反推服务商", () => {
    expect(inferAiProvider("https://api.moonshot.cn/v1")).toBe("kimi");
    expect(inferAiProvider("https://open.bigmodel.cn/api/paas/v4")).toBe("zhipu");
    expect(inferAiProvider("https://api.deepseek.com/v1")).toBe("deepseek");
    expect(inferAiProvider("http://127.0.0.1:11434/v1")).toBe("custom");
  });

  it("chat URL: /v1 与智谱 /v4 都拼 chat/completions", () => {
    expect(aiChatUrl("https://api.moonshot.cn/v1")).toBe(
      "https://api.moonshot.cn/v1/chat/completions",
    );
    expect(aiChatUrl("https://open.bigmodel.cn/api/paas/v4")).toBe(
      "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    );
    expect(aiChatUrl("https://api.deepseek.com/v1")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
    expect(aiChatUrl("https://x.test/v1/chat/completions")).toBe(
      "https://x.test/v1/chat/completions",
    );
  });
});
