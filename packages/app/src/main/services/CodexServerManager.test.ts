import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

import type { CodexAppServer } from "../codexAppServer";
import { createCodexRouterRuntime } from "../codexRouterRuntime";
import { CodexServerManager } from "./CodexServerManager";

function runtimeConfig() {
  return createCodexRouterRuntime({
    origin: "http://127.0.0.1:15722",
    authToken: "synthetic-router-token",
    routes: [{ modelId: "third-party", authMode: "api_key" }],
  })!;
}

function fakeServer(start: () => Promise<void> = async () => undefined) {
  return {
    start: vi.fn(start),
    stop: vi.fn(),
    capabilities: { experimentalApi: false },
  } as unknown as CodexAppServer;
}

describe("CodexServerManager Router fail-soft", () => {
  it("starts normal Codex directly when the Router is unavailable", async () => {
    const options: Array<ConstructorParameters<typeof CodexAppServer>[0]> = [];
    const server = fakeServer();
    const manager = new CodexServerManager({
      resolveRuntimeConfig: () => null,
      createServer: (value) => {
        options.push(value);
        return server;
      },
    });

    await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    expect(options).toHaveLength(1);
    expect(options[0].runtimeConfig).toBeNull();
    expect(server.start).toHaveBeenCalledOnce();
    manager.stopAll();
  });

  it("retries normal Codex when Router-backed app-server startup fails", async () => {
    const options: Array<ConstructorParameters<typeof CodexAppServer>[0]> = [];
    const routerServer = fakeServer(async () => {
      throw new Error("synthetic Router startup failure");
    });
    const normalServer = fakeServer();
    const servers = [routerServer, normalServer];
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      createServer: (value) => {
        options.push(value);
        return servers.shift()!;
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    expect(routerServer.stop).toHaveBeenCalledOnce();
    expect(options[0].runtimeConfig).not.toBeNull();
    expect(options[1].runtimeConfig).toBeNull();
    expect(normalServer.start).toHaveBeenCalledOnce();
    manager.stopAll();
  });

  it("stops the normal server too when the fail-soft retry also fails", async () => {
    const routerServer = fakeServer(async () => {
      throw new Error("synthetic Router startup failure");
    });
    const normalServer = fakeServer(async () => {
      throw new Error("synthetic normal startup failure");
    });
    const servers = [routerServer, normalServer];
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      createServer: () => servers.shift()!,
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(manager.start({ cwd: "/workspace", onMessage: () => undefined })).rejects.toThrow(
      "synthetic normal startup failure"
    );
    expect(routerServer.stop).toHaveBeenCalledOnce();
    expect(normalServer.stop).toHaveBeenCalledOnce();
  });

  it("uses the same Router singleton credentials for multiple workspaces", async () => {
    const runtime = runtimeConfig();
    const options: Array<ConstructorParameters<typeof CodexAppServer>[0]> = [];
    const manager = new CodexServerManager({
      resolveRuntimeConfig: () => runtime,
      createServer: (value) => {
        options.push(value);
        return fakeServer();
      },
    });

    await manager.start({ cwd: "/workspace-a", onMessage: () => undefined });
    await manager.start({ cwd: "/workspace-b", onMessage: () => undefined });
    expect(options).toHaveLength(2);
    expect(options[0].runtimeConfig?.childEnv).toEqual(options[1].runtimeConfig?.childEnv);
    expect(options[0].runtimeConfig?.childEnv.CODENEXUS_ROUTER_TOKEN).toBe("synthetic-router-token");
    manager.stopAll();
  });
});
