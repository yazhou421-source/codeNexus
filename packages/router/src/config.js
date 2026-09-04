/*! @license Adapted from CodexBridge (https://github.com/wangzhezbz/codex-bridge).
 * Copyright (c) 2026 wangzhezbz. Licensed under the MIT License; see the package LICENSE.
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = path.resolve("config", "router.config.json");
const EXAMPLE_CONFIG = path.resolve("config", "router.config.example.json");

export function resolveConfigPath(configPath = process.env.ROUTER_CONFIG) {
  if (configPath) {
    return path.resolve(configPath);
  }
  if (fs.existsSync(DEFAULT_CONFIG)) {
    return DEFAULT_CONFIG;
  }
  return EXAMPLE_CONFIG;
}

export function loadConfig(configPath) {
  const resolved = resolveConfigPath(configPath);
  const raw = fs.readFileSync(resolved, "utf8");
  const config = JSON.parse(raw);
  config.__path = resolved;
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("router config must be an object");
  }
  validateRouterHost(config.host);
  if (!Array.isArray(config.models) || config.models.length === 0) {
    throw new Error("router config must contain a non-empty models array");
  }

  const seen = new Set();
  for (const model of config.models) {
    for (const field of ["id", "displayName", "api", "baseUrl", "model"]) {
      if (!model[field] || typeof model[field] !== "string") {
        throw new Error(`model entry is missing string field ${field}`);
      }
    }
    validateUpstreamBaseUrl(model.baseUrl, model.id);
    if (seen.has(model.id)) {
      throw new Error(`duplicate model id: ${model.id}`);
    }
    if (!["responses", "chat_completions"].includes(model.api)) {
      throw new Error(`model ${model.id} has unsupported api ${model.api}`);
    }
    if (
      model.authMode &&
      !["api_key", "codex_openai"].includes(model.authMode)
    ) {
      throw new Error(
        `model ${model.id} has unsupported authMode ${model.authMode}`,
      );
    }
    seen.add(model.id);
  }
}

export function normalizeRouterHost(value) {
  const host =
    String(value ?? "")
      .trim()
      .toLowerCase() || "127.0.0.1";
  return host === "[::1]" ? "::1" : host;
}

export function validateRouterHost(value) {
  const host = normalizeRouterHost(value);
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(
      `embedded Router host must be loopback (127.0.0.1, localhost, or ::1): ${host}`,
    );
  }
}

function validateUpstreamBaseUrl(value, modelId) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`model ${modelId} has an invalid baseUrl`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(
      `model ${modelId} baseUrl must use http or https, not ${parsed.protocol}`,
    );
  }
}

export function routeForModel(config, requestedModel) {
  if (!requestedModel) {
    return defaultRoute(config);
  }
  const requested = String(requestedModel || "").trim();
  const normalized = normalizeModelName(requested);
  const route = config.models.find((model) =>
    modelNameAliases(model).some((alias) => alias === normalized),
  );
  if (route) {
    return route;
  }
  const available = config.models
    .flatMap((model) => [model.id, model.displayName, model.model])
    .filter(Boolean)
    .join(", ");
  const error = new Error(
    `Model is not configured in CodeNexus Embedded Router: ${requested}. Available models: ${available}`,
  );
  error.statusCode = 404;
  error.code = "model_not_configured";
  throw error;
}

function defaultRoute(config) {
  return (
    config.models.find((model) => model.id === config.defaultModel) ||
    config.models[0]
  );
}

function modelNameAliases(model) {
  return [
    model.id,
    model.displayName,
    model.model,
    model.slotLabel,
    model.sourcePresetId,
  ]
    .filter(Boolean)
    .flatMap((value) => [
      normalizeModelName(value),
      normalizeModelName(String(value).replace(/^codex-/, "")),
    ]);
}

function normalizeModelName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function apiKeyForRoute(route, resolveSecret) {
  if (route.apiKeyRef && typeof resolveSecret === "function") {
    const resolved = resolveSecret(route.apiKeyRef);
    if (typeof resolved === "string" && resolved.trim()) {
      return resolved.trim();
    }
  }
  if (route.apiKey) {
    return route.apiKey;
  }
  if (route.apiKeyEnv) {
    return process.env[route.apiKeyEnv] || secretFileValue(route.apiKeyEnv);
  }
  return undefined;
}

export function secretValuesForConfig(config) {
  const values = new Set();
  collectNamedSecrets(config, values);
  for (const route of config?.models || []) {
    collectSecretValue(apiKeyForRoute(route), values);
    const image = route?.imageGeneration;
    if (image && typeof image === "object") {
      collectSecretValue(image.apiKey, values);
      if (image.apiKeyEnv) {
        collectSecretValue(process.env[image.apiKeyEnv], values);
      }
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function collectNamedSecrets(value, result, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === "string" &&
      /(?:authorization|api[-_]?key|access[-_]?token|secret|auth[-_]?token|token)$/i.test(
        key,
      )
    ) {
      collectSecretValue(entry, result);
      continue;
    }
    collectNamedSecrets(entry, result, seen);
  }
}

function collectSecretValue(value, result) {
  const secret = typeof value === "string" ? value.trim() : "";
  if (secret.length >= 6) {
    result.add(secret);
  }
}

function secretFileValue(keyEnv) {
  const secretsFile = process.env.CODEXBRIDGE_SECRETS_FILE;
  if (!secretsFile || !fs.existsSync(secretsFile)) {
    return undefined;
  }
  try {
    const secrets = JSON.parse(fs.readFileSync(secretsFile, "utf8"));
    const value = secrets?.[keyEnv];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function authModeForRoute(route) {
  return route.authMode || "api_key";
}

export function requireApiKey(route, resolveSecret) {
  const key = apiKeyForRoute(route, resolveSecret);
  if (!key) {
    const label = [route.displayName, route.id].filter(Boolean).join(" / ");
    const hint = route.apiKeyEnv
      ? ` Set ${route.apiKeyEnv} in the CodeNexus Router environment.`
      : " Configure an API key for the CodeNexus Embedded Router.";
    const error = new Error(
      route.apiKeyRef
        ? `Provider ${route.provider || route.apiKeyRef} is not configured.`
        : `Missing API key for ${label || route.id}.${hint}`,
    );
    error.statusCode = 400;
    error.code = route.apiKeyRef
      ? "provider_not_configured"
      : "missing_provider_api_key";
    throw error;
  }
  return key;
}

export function joinUpstreamUrl(baseUrl, endpoint) {
  const cleanBase = String(baseUrl).replace(/\/+$/, "");
  if (cleanBase.endsWith(endpoint)) {
    return cleanBase;
  }
  return `${cleanBase}${endpoint}`;
}

export function routerOrigin(config) {
  return `http://${config.host || "127.0.0.1"}:${config.port || 15722}`;
}
