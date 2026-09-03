import type { EmbeddedRouterOwnedConnection } from "@codenexus/router";

export const CODEX_ROUTER_PROVIDER_ID = "codenexus-router";
export const CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID = "codenexus-router-codex";
export const CODEX_ROUTER_TOKEN_ENV = "CODENEXUS_ROUTER_TOKEN";

export type CodexAppServerRuntimeConfig = {
  globalConfigOverrides: readonly string[];
  childEnv: Readonly<Record<string, string>>;
  sensitiveValues: readonly string[];
  localTokenModelIds: ReadonlySet<string>;
};

function tomlString(value: string): string {
  if (value.includes("'") || /[\r\n]/.test(value)) {
    throw new Error("unsupported value in process-scoped Codex configuration");
  }
  // Single-quoted TOML strings survive the Windows codex.cmd fallback without
  // cmd.exe consuming the quotes that Codex needs to parse string values.
  return `'${value}'`;
}

function routerLocalApiBase(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/v1`;
}

function routerCodexAuthApiBase(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/codex-auth/v1`;
}

/**
 * One provider retains Codex/ChatGPT bearer auth for subscription routes. API-key
 * routes use a second provider whose local credential is read only from child env.
 */
export function createCodexRouterRuntime(
  connection: EmbeddedRouterOwnedConnection | null
): CodexAppServerRuntimeConfig | null {
  if (!connection?.origin || !connection.authToken) return null;

  const localBaseUrl = routerLocalApiBase(connection.origin);
  const codexAuthBaseUrl = routerCodexAuthApiBase(connection.origin);
  const localTokenModelIds = new Set(
    connection.routes.filter((route) => route.authMode !== "codex_openai").map((route) => route.modelId)
  );

  return {
    globalConfigOverrides: [
      `model_provider=${tomlString(CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID)}`,
      `openai_base_url=${tomlString(codexAuthBaseUrl)}`,
      `model_providers.${CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID}.name=${tomlString("CodeNexusRouterCodexAuth")}`,
      `model_providers.${CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID}.base_url=${tomlString(codexAuthBaseUrl)}`,
      `model_providers.${CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID}.wire_api=${tomlString("responses")}`,
      `model_providers.${CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID}.requires_openai_auth=true`,
      `model_providers.${CODEX_ROUTER_PROVIDER_ID}.name=${tomlString("CodeNexusRouter")}`,
      `model_providers.${CODEX_ROUTER_PROVIDER_ID}.base_url=${tomlString(localBaseUrl)}`,
      `model_providers.${CODEX_ROUTER_PROVIDER_ID}.wire_api=${tomlString("responses")}`,
      `model_providers.${CODEX_ROUTER_PROVIDER_ID}.env_key=${tomlString(CODEX_ROUTER_TOKEN_ENV)}`,
      `model_providers.${CODEX_ROUTER_PROVIDER_ID}.requires_openai_auth=false`,
    ],
    childEnv: { [CODEX_ROUTER_TOKEN_ENV]: connection.authToken },
    sensitiveValues: [connection.authToken],
    localTokenModelIds,
  };
}

export function applyCodexRouterModelProvider(
  method: string,
  params: unknown,
  runtime: CodexAppServerRuntimeConfig | null
): unknown {
  if (
    !runtime ||
    !["thread/start", "thread/resume", "thread/fork"].includes(method) ||
    !params ||
    typeof params !== "object" ||
    Array.isArray(params)
  ) {
    return params;
  }

  const record = params as Record<string, unknown>;
  const model = typeof record.model === "string" ? record.model.trim() : "";
  if (!model) return params;

  return {
    ...record,
    modelProvider: runtime.localTokenModelIds.has(model)
      ? CODEX_ROUTER_PROVIDER_ID
      : CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID,
  };
}
