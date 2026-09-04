import { describe, expect, it } from "vitest";
import { createDefaultRouterConfig } from "./defaultConfig";
import { requireApiKey } from "./config.js";
import {
  BUILTIN_PROVIDER_REGISTRY,
  createProviderRouterConfig,
  providerDefinition,
  validateProviderBaseUrl,
} from "./providerRegistry";

describe("Provider Registry", () => {
  it("defines the four initial providers and their real CodexBridge model IDs", () => {
    expect(BUILTIN_PROVIDER_REGISTRY.map((provider) => provider.id)).toEqual([
      "deepseek",
      "kimi",
      "qwen",
      "zhipu",
    ]);
    expect(
      providerDefinition("deepseek").models.map((model) => model.id),
    ).toEqual(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-r1"]);
    expect(providerDefinition("kimi").models.map((model) => model.id)).toEqual([
      "kimi-k2-7-code",
      "kimi-k2-6",
    ]);
    expect(providerDefinition("qwen").models.map((model) => model.id)).toEqual([
      "qwen3-coder-plus",
      "qwen3-vl-plus",
      "qwen3-vl-flash",
      "qwen-plus",
      "qwen-max",
    ]);
    expect(providerDefinition("zhipu").models.map((model) => model.id)).toEqual(
      ["glm-4-6", "glm-4-6v"],
    );
  });

  it.each([
    ["deepseek", "https://api.deepseek.com/v1"],
    ["kimi", "https://api.moonshot.cn/v1"],
    ["qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1"],
    ["zhipu", "https://open.bigmodel.cn/api/paas/v4"],
  ])("accepts the registered HTTPS host for %s", (providerId, baseUrl) => {
    expect(validateProviderBaseUrl(providerId, baseUrl)).toBe(baseUrl);
  });

  it.each([
    ["deepseek", "http://api.deepseek.com/v1"],
    ["deepseek", "https://evil.example/v1"],
    ["deepseek", "https://api.deepseek.com:444/v1"],
    ["kimi", "https://user:password@api.moonshot.cn/v1"],
    ["qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1?token=secret"],
  ])("rejects unsafe provider URLs", (providerId, baseUrl) => {
    expect(() => validateProviderBaseUrl(providerId, baseUrl)).toThrow(
      "Provider URL",
    );
  });

  it("rejects unknown providers and models", () => {
    expect(() => providerDefinition("unknown")).toThrow("Unknown provider");
    expect(() =>
      createProviderRouterConfig(createDefaultRouterConfig(), [
        { providerId: "deepseek", modelIds: ["not-a-model"] },
      ]),
    ).toThrow("Unknown provider model");
  });

  it("generates secret-reference routes without inline keys or env keys", () => {
    const config = createProviderRouterConfig(createDefaultRouterConfig(), [
      { providerId: "deepseek", modelIds: ["deepseek-v4-pro"] },
      { providerId: "kimi", modelIds: ["kimi-k2-7-code"] },
      { providerId: "qwen", modelIds: ["qwen3-coder-plus"] },
      { providerId: "zhipu", modelIds: ["glm-4-6"] },
    ]);
    const apiRoutes = config.models.filter(
      (route) => route.authMode === "api_key",
    );

    expect(apiRoutes.map((route) => route.id)).toEqual([
      "deepseek-v4-pro",
      "kimi-k2-7-code",
      "qwen3-coder-plus",
      "glm-4-6",
    ]);
    expect(apiRoutes.map((route) => route.apiKeyRef)).toEqual([
      "deepseek",
      "kimi",
      "qwen",
      "zhipu",
    ]);
    expect(JSON.stringify(apiRoutes)).not.toContain("apiKeyEnv");
    expect(JSON.stringify(apiRoutes)).not.toContain('apiKey"');
  });

  it("returns provider_not_configured when a runtime secret is missing", () => {
    expect(() =>
      requireApiKey(
        {
          id: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
          provider: "deepseek",
          api: "chat_completions",
          baseUrl: "https://api.deepseek.com/v1",
          model: "deepseek-v4-pro",
          apiKeyRef: "deepseek",
        },
        () => undefined,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "provider_not_configured",
        message: "Provider deepseek is not configured.",
      }),
    );
  });
});
