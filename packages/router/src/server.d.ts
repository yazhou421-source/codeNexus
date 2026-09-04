import type { Server } from "node:http";
import type { RouterConfig } from "./types";
import type { RouterSecretResolver } from "./config.js";

export const ROUTER_SERVICE_ID: "codenexus-embedded-router";
export const ROUTER_PROTOCOL_VERSION: 1;
export type RouterServerRuntime = {
  getConfig?: () => RouterConfig;
  resolveSecret?: RouterSecretResolver;
};
export function createRouterServer(
  config?: RouterConfig,
  runtime?: RouterServerRuntime,
): Server;
export function startServer(config?: RouterConfig): Server;
