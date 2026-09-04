import type { RouterConfig, RouterModelRoute } from "./types";

export function resolveConfigPath(configPath?: string): string;
export function loadConfig(configPath?: string): RouterConfig;
export function validateConfig(config: RouterConfig): void;
export function normalizeRouterHost(value?: unknown): string;
export function validateRouterHost(value?: unknown): void;
export function routeForModel(
  config: RouterConfig,
  requestedModel?: string,
): RouterModelRoute;
export type RouterSecretResolver = (secretRef: string) => string | undefined;
export function apiKeyForRoute(
  route: RouterModelRoute,
  resolveSecret?: RouterSecretResolver,
): string | undefined;
export function secretValuesForConfig(config: RouterConfig): string[];
export function authModeForRoute(
  route: RouterModelRoute,
): "api_key" | "codex_openai";
export function requireApiKey(
  route: RouterModelRoute,
  resolveSecret?: RouterSecretResolver,
): string;
export function joinUpstreamUrl(baseUrl: string, endpoint: string): string;
export function routerOrigin(config: RouterConfig): string;
