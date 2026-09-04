/*! @license Provider metadata adapted from CodexBridge (https://github.com/wangzhezbz/codex-bridge).
 * Copyright (c) 2026 wangzhezbz. Licensed under the MIT License; see the package LICENSE.
 */
import type { RouterApi, RouterConfig, RouterModelRoute } from "./types";

export type ProviderModelDefinition = {
  id: string;
  displayName: string;
  upstreamModel: string;
  contextWindow: number;
  inputModalities?: readonly ("text" | "image")[];
  dropParams?: readonly string[];
  rpm?: number;
};

export type ProviderDefinition = {
  id: string;
  displayName: string;
  baseUrl: string;
  api: RouterApi;
  requiresApiKey: true;
  defaultModelId: string;
  allowedHosts: readonly string[];
  models: readonly ProviderModelDefinition[];
};

export type EnabledProviderSelection = {
  providerId: string;
  modelIds: readonly string[];
};

export const BUILTIN_PROVIDER_REGISTRY = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    api: "chat_completions",
    requiresApiKey: true,
    defaultModelId: "deepseek-v4-pro",
    allowedHosts: ["api.deepseek.com"],
    models: [
      model(
        "deepseek-v4-pro",
        "DeepSeek V4 Pro",
        "deepseek-v4-pro",
        1_000_000,
        {
          dropParams: ["response_format", "parallel_tool_calls"],
        },
      ),
      model(
        "deepseek-v4-flash",
        "DeepSeek V4 Flash",
        "deepseek-v4-flash",
        1_000_000,
        {
          dropParams: ["response_format", "parallel_tool_calls"],
        },
      ),
      model("deepseek-r1", "DeepSeek R1", "deepseek-reasoner", 64_000, {
        dropParams: ["response_format", "parallel_tool_calls"],
      }),
    ],
  },
  {
    id: "kimi",
    displayName: "Kimi / Moonshot",
    baseUrl: "https://api.moonshot.cn/v1",
    api: "chat_completions",
    requiresApiKey: true,
    defaultModelId: "kimi-k2-7-code",
    allowedHosts: ["api.moonshot.cn"],
    models: [
      model("kimi-k2-7-code", "Kimi K2.7 Code", "kimi-k2.7-code", 258_400, {
        inputModalities: ["text", "image"],
        dropParams: ["response_format", "parallel_tool_calls"],
        rpm: 12,
      }),
      model("kimi-k2-6", "Kimi K2.6", "kimi-k2.6", 258_400, {
        inputModalities: ["text", "image"],
        dropParams: ["response_format", "parallel_tool_calls"],
        rpm: 12,
      }),
    ],
  },
  {
    id: "qwen",
    displayName: "Qwen / DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    api: "chat_completions",
    requiresApiKey: true,
    defaultModelId: "qwen3-coder-plus",
    allowedHosts: ["dashscope.aliyuncs.com"],
    models: [
      model(
        "qwen3-coder-plus",
        "Qwen3 Coder Plus",
        "qwen3-coder-plus",
        258_400,
        {
          dropParams: ["parallel_tool_calls"],
        },
      ),
      model("qwen3-vl-plus", "Qwen3 VL Plus", "qwen3-vl-plus", 258_400, {
        inputModalities: ["text", "image"],
        dropParams: ["parallel_tool_calls"],
      }),
      model("qwen3-vl-flash", "Qwen3 VL Flash", "qwen3-vl-flash", 258_400, {
        inputModalities: ["text", "image"],
        dropParams: ["parallel_tool_calls"],
      }),
      model("qwen-plus", "Qwen Plus", "qwen-plus", 128_000, {
        dropParams: ["parallel_tool_calls"],
      }),
      model("qwen-max", "Qwen Max", "qwen-max", 128_000, {
        dropParams: ["parallel_tool_calls"],
      }),
    ],
  },
  {
    id: "zhipu",
    displayName: "GLM / Zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    api: "chat_completions",
    requiresApiKey: true,
    defaultModelId: "glm-4-6",
    allowedHosts: ["open.bigmodel.cn"],
    models: [
      model("glm-4-6", "GLM-4.6", "glm-4.6", 128_000, {
        dropParams: ["parallel_tool_calls"],
      }),
      model("glm-4-6v", "GLM-4.6V", "glm-4.6v", 128_000, {
        inputModalities: ["text", "image"],
        dropParams: ["parallel_tool_calls"],
      }),
    ],
  },
] as const satisfies readonly ProviderDefinition[];

export function providerDefinition(providerId: string): ProviderDefinition {
  const provider = BUILTIN_PROVIDER_REGISTRY.find(
    (entry) => entry.id === providerId,
  );
  if (!provider)
    throw providerRegistryError("unknown_provider", "Unknown provider.");
  return provider;
}

export function validateProviderBaseUrl(
  providerId: string,
  value?: string,
): string {
  const provider = providerDefinition(providerId);
  const candidate = String(value ?? provider.baseUrl).trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw providerRegistryError(
      "invalid_provider_url",
      "Provider URL is invalid.",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    !provider.allowedHosts.includes(parsed.hostname.toLowerCase()) ||
    (parsed.port && parsed.port !== "443") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw providerRegistryError(
      "invalid_provider_url",
      "Provider URL is not allowed.",
    );
  }
  return parsed.toString().replace(/\/$/, "");
}

export function createProviderRouterConfig(
  baseConfig: RouterConfig,
  selections: readonly EnabledProviderSelection[],
): RouterConfig {
  const subscriptionRoutes = baseConfig.models
    .filter((route) => route.authMode === "codex_openai")
    .map((route) => ({ ...route }));
  const providerRoutes: RouterModelRoute[] = [];
  const seenModels = new Set(subscriptionRoutes.map((route) => route.id));

  for (const selection of selections) {
    const provider = providerDefinition(selection.providerId);
    const selectedIds = new Set(selection.modelIds);
    for (const modelDefinition of provider.models) {
      if (!selectedIds.has(modelDefinition.id)) continue;
      if (seenModels.has(modelDefinition.id)) {
        throw providerRegistryError(
          "duplicate_model_id",
          "Provider model ID is duplicated.",
        );
      }
      seenModels.add(modelDefinition.id);
      providerRoutes.push(
        providerRoute(
          provider,
          modelDefinition,
          subscriptionRoutes.length + providerRoutes.length,
        ),
      );
    }
    for (const selectedId of selectedIds) {
      if (!provider.models.some((modelEntry) => modelEntry.id === selectedId)) {
        throw providerRegistryError(
          "unknown_provider_model",
          "Unknown provider model.",
        );
      }
    }
  }

  return {
    ...baseConfig,
    clientAuth: { ...baseConfig.clientAuth, allowOpenAiBearer: false },
    catalog: { ...baseConfig.catalog },
    models: [...subscriptionRoutes, ...providerRoutes],
  };
}

function model(
  id: string,
  displayName: string,
  upstreamModel: string,
  contextWindow: number,
  extra: Omit<
    ProviderModelDefinition,
    "id" | "displayName" | "upstreamModel" | "contextWindow"
  > = {},
): ProviderModelDefinition {
  return { id, displayName, upstreamModel, contextWindow, ...extra };
}

function providerRoute(
  provider: ProviderDefinition,
  definition: ProviderModelDefinition,
  priority: number,
): RouterModelRoute {
  return {
    id: definition.id,
    displayName: definition.displayName,
    description: `${definition.displayName} via ${provider.displayName}.`,
    provider: provider.id,
    api: provider.api,
    baseUrl: validateProviderBaseUrl(provider.id),
    model: definition.upstreamModel,
    authMode: "api_key",
    apiKeyRef: provider.id,
    contextWindow: definition.contextWindow,
    inputModalities: definition.inputModalities
      ? [...definition.inputModalities]
      : undefined,
    dropParams: definition.dropParams ? [...definition.dropParams] : undefined,
    rpm: definition.rpm,
    priority,
  };
}

function providerRegistryError(
  code: string,
  message: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
