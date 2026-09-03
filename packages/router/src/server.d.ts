import type { Server } from "node:http";
import type { RouterConfig } from "./types";

export const ROUTER_SERVICE_ID: "codenexus-embedded-router";
export const ROUTER_PROTOCOL_VERSION: 1;
export function createRouterServer(config?: RouterConfig): Server;
export function startServer(config?: RouterConfig): Server;
