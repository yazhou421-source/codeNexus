import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { normalizeRouterHost, validateConfig } from "./config.js";
import {
  createRouterServer,
  ROUTER_PROTOCOL_VERSION,
  ROUTER_SERVICE_ID,
} from "./server.js";
import type { RouterConfig } from "./types";

export type RouterStartStatus =
  | "started"
  | "already-running"
  | "compatible-router-present"
  | "foreign-port-in-use"
  | "invalid-health-response"
  | "health-unreachable"
  | "start-cancelled";

export type RouterStartResult = {
  status: RouterStartStatus;
  host: string;
  port: number;
  origin: string;
};

export type EmbeddedRouterLog = (
  level: "info" | "warn" | "error",
  message: string,
  error?: unknown,
) => void;

export type EmbeddedRouterManagerOptions = {
  healthProbeTimeoutMs?: number;
};

type LifecycleState = "idle" | "starting" | "running" | "stopping";

const HEALTH_RESPONSE_LIMIT_BYTES = 4 * 1024;

export class EmbeddedRouterManager {
  private server: Server | null = null;
  private startPromise: Promise<RouterStartResult> | null = null;
  private stopPromise: Promise<void> | null = null;
  private listenAbortController: AbortController | null = null;
  private lastAddress: { host: string; port: number } | null = null;
  private state: LifecycleState = "idle";
  private readonly healthProbeTimeoutMs: number;

  constructor(
    private readonly log: EmbeddedRouterLog = () => undefined,
    options: EmbeddedRouterManagerOptions = {},
  ) {
    this.healthProbeTimeoutMs = positiveTimeout(
      options.healthProbeTimeoutMs,
      500,
    );
  }

  get running(): boolean {
    return this.state === "running" && Boolean(this.server?.listening);
  }

  get ownedOrigin(): string | null {
    if (!this.running || !this.lastAddress) return null;
    return routerOrigin(this.lastAddress.host, this.lastAddress.port);
  }

  async start(config: RouterConfig): Promise<RouterStartResult> {
    if (this.stopPromise) await this.stopPromise;
    if (this.running && this.lastAddress) {
      return resultFor(
        "already-running",
        this.lastAddress.host,
        this.lastAddress.port,
      );
    }
    if (this.startPromise) return await this.startPromise;

    validateConfig(config);
    const host = normalizeRouterHost(config.host);
    const port = normalizedPort(config.port);
    const server = createRouterServer(config);
    const listenAbortController = new AbortController();
    this.server = server;
    this.listenAbortController = listenAbortController;
    this.state = "starting";

    const attempt = this.listen(server, listenAbortController, host, port);
    this.startPromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.startPromise === attempt) this.startPromise = null;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return await this.stopPromise;
    const server = this.server;
    const pendingStart = this.startPromise;
    const listenAbortController = this.listenAbortController;

    this.state = "stopping";
    this.server = null;
    this.listenAbortController = null;
    this.lastAddress = null;

    const stop = (async () => {
      listenAbortController?.abort();
      if (server?.listening) await closeListeningServer(server, this.log);
      if (pendingStart) await pendingStart.catch(() => undefined);
      if (server?.listening) await closeListeningServer(server, this.log);
    })();
    this.stopPromise = stop;
    try {
      await stop;
      if (server) this.log("info", "embedded Router stopped");
    } finally {
      if (this.stopPromise === stop) this.stopPromise = null;
      this.state = "idle";
    }
  }

  private listen(
    server: Server,
    listenAbortController: AbortController,
    host: string,
    port: number,
  ): Promise<RouterStartResult> {
    return new Promise<RouterStartResult>((resolve, reject) => {
      let startupSettled = false;

      const clearOwnedServer = () => {
        if (this.server === server) this.server = null;
        if (this.listenAbortController === listenAbortController) {
          this.listenAbortController = null;
        }
        this.lastAddress = null;
        if (this.state !== "stopping") this.state = "idle";
      };
      const cleanupStartupListeners = () => {
        server.off("listening", onListening);
        server.off("close", onCloseBeforeListening);
      };
      const onCloseBeforeListening = () => {
        if (startupSettled) return;
        startupSettled = true;
        cleanupStartupListeners();
        clearOwnedServer();
        resolve(resultFor("start-cancelled", host, port));
      };
      const onListening = () => {
        if (startupSettled) return;
        if (listenAbortController.signal.aborted) {
          void closeListeningServer(server, this.log);
          return;
        }
        startupSettled = true;
        cleanupStartupListeners();
        const address = server.address() as AddressInfo | null;
        const listeningPort =
          address && typeof address === "object" ? address.port : port;
        if (this.listenAbortController === listenAbortController) {
          this.listenAbortController = null;
        }
        this.lastAddress = { host, port: listeningPort };
        this.state = "running";
        this.log(
          "info",
          `embedded Router listening on ${routerOrigin(host, listeningPort)}`,
        );
        resolve(resultFor("started", host, listeningPort));
      };

      server.once("close", onCloseBeforeListening);
      server.once("listening", onListening);
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (startupSettled) {
          this.log("error", "embedded Router runtime error", error);
          return;
        }
        startupSettled = true;
        cleanupStartupListeners();
        clearOwnedServer();
        if (error.code === "EADDRINUSE") {
          this.log(
            "warn",
            `embedded Router port is already in use: ${host}:${port}`,
          );
          void classifyPortConflict(host, port, this.healthProbeTimeoutMs).then(
            resolve,
            reject,
          );
          return;
        }
        reject(error);
      });

      try {
        server.listen({
          host,
          port,
          signal: listenAbortController.signal,
        });
      } catch (error) {
        startupSettled = true;
        cleanupStartupListeners();
        clearOwnedServer();
        reject(error);
      }
    });
  }
}

async function classifyPortConflict(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<RouterStartResult> {
  const origin = routerOrigin(host, port);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetch(`${origin}/health`, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) return resultFor("foreign-port-in-use", host, port);
    const health = await readBoundedHealthResponse(response);
    if (health === null) {
      return resultFor("invalid-health-response", host, port);
    }
    if (
      isRecord(health) &&
      health.ok === true &&
      health.service === ROUTER_SERVICE_ID &&
      health.protocolVersion === ROUTER_PROTOCOL_VERSION
    ) {
      return resultFor("compatible-router-present", host, port);
    }
    return resultFor("invalid-health-response", host, port);
  } catch {
    return resultFor("health-unreachable", host, port);
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedHealthResponse(
  response: Response,
): Promise<unknown | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > HEALTH_RESPONSE_LIMIT_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      const { value } = result;
      size += value.byteLength;
      if (size > HEALTH_RESPONSE_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
      result = await reader.read();
    }
    try {
      return JSON.parse(
        Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
          "utf8",
        ),
      );
    } catch {
      return null;
    }
  } finally {
    reader.releaseLock();
  }
}

async function closeListeningServer(
  server: Server,
  log: EmbeddedRouterLog,
): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      server.close((error) => {
        if (error)
          log("warn", "embedded Router close reported an error", error);
        finish();
      });
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    } catch (error) {
      log("warn", "embedded Router close failed", error);
      finish();
    }
  });
}

function normalizedPort(value: unknown): number {
  const port = Number(value ?? 15722);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid embedded Router port: ${String(value)}`);
  }
  return port;
}

function positiveTimeout(value: unknown, fallback: number): number {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function routerOrigin(host: string, port: number): string {
  const authority = host.includes(":") ? `[${host}]` : host;
  return `http://${authority}:${port}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resultFor(
  status: RouterStartStatus,
  host: string,
  port: number,
): RouterStartResult {
  return { status, host, port, origin: routerOrigin(host, port) };
}
