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

describe("CodexServerManager runtime revision refresh", () => {
  function revisionFixture() {
    let revision = 0;
    const busy = new Set<string>();
    const servers: ReturnType<typeof fakeServer>[] = [];
    const options: Array<ConstructorParameters<typeof CodexAppServer>[0]> = [];
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      isServerBusy: (serverId) => busy.has(serverId),
      refreshRetryBaseMs: 10,
      createServer: (value) => {
        options.push(value);
        const server = fakeServer();
        servers.push(server);
        return server;
      },
    });
    return {
      manager,
      options,
      servers,
      busy,
      setRevision: (value: number) => {
        revision = value;
      },
    };
  }

  it("refreshes an idle app-server in place when the catalog revision increases", async () => {
    const fixture = revisionFixture();
    const started = await fixture.manager.start({ cwd: "/workspace", onMessage: () => undefined });
    fixture.setRevision(1);

    await fixture.manager.refreshForRuntimeRevision();

    expect(fixture.servers).toHaveLength(2);
    expect(fixture.servers[0].stop).toHaveBeenCalledOnce();
    expect(fixture.manager.runtimeState(started.serverId)).toMatchObject({
      startedWithRevision: 1,
      currentRevision: 1,
      stale: false,
      pendingRefresh: false,
    });
    fixture.manager.stopAll();
  });

  it("does not interrupt an active turn and refreshes after completion", async () => {
    const fixture = revisionFixture();
    const started = await fixture.manager.start({ cwd: "/workspace", onMessage: () => undefined });
    fixture.busy.add(started.serverId);
    fixture.setRevision(1);

    await fixture.manager.refreshForRuntimeRevision();
    expect(fixture.servers).toHaveLength(1);
    expect(fixture.servers[0].stop).not.toHaveBeenCalled();
    expect(fixture.manager.runtimeState(started.serverId)?.pendingRefresh).toBe(true);

    fixture.busy.delete(started.serverId);
    fixture.options[0].onMessage?.({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } },
    } as any);
    await vi.waitFor(() => expect(fixture.servers[0].stop).toHaveBeenCalledOnce());
    fixture.manager.stopAll();
  });

  it.each(["cancelled", "failed"])("refreshes after a %s turn completes", async (status) => {
    const fixture = revisionFixture();
    const started = await fixture.manager.start({ cwd: "/workspace", onMessage: () => undefined });
    fixture.busy.add(started.serverId);
    fixture.setRevision(1);
    await fixture.manager.refreshForRuntimeRevision();

    fixture.busy.delete(started.serverId);
    fixture.options[0].onMessage?.({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status, items: [] } },
    } as any);

    await vi.waitFor(() => expect(fixture.manager.runtimeState(started.serverId)?.stale).toBe(false));
    fixture.manager.stopAll();
  });

  it("refreshes multiple workspaces independently", async () => {
    const fixture = revisionFixture();
    const first = await fixture.manager.start({ cwd: "/workspace-a", onMessage: () => undefined });
    const second = await fixture.manager.start({ cwd: "/workspace-b", onMessage: () => undefined });
    fixture.busy.add(first.serverId);
    fixture.setRevision(1);

    await fixture.manager.refreshForRuntimeRevision();

    expect(fixture.manager.runtimeState(first.serverId)).toMatchObject({ stale: true, pendingRefresh: true });
    expect(fixture.manager.runtimeState(second.serverId)).toMatchObject({ stale: false, pendingRefresh: false });
    fixture.busy.delete(first.serverId);
    fixture.options[0].onMessage?.({
      method: "turn/completed",
      params: { threadId: "thread-a", turn: { id: "turn-a", status: "completed", items: [] } },
    } as any);
    await vi.waitFor(() => expect(fixture.manager.runtimeState(first.serverId)?.stale).toBe(false));
    fixture.manager.stopAll();
  });

  it("keeps the previous server after refresh failure and recovers on retry", async () => {
    let revision = 0;
    const servers = [
      fakeServer(),
      fakeServer(async () => {
        throw new Error("synthetic refresh failure");
      }),
      fakeServer(),
    ];
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      refreshRetryBaseMs: 60_000,
      createServer: () => servers.shift()!,
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const started = await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    const original = manager.runtimeState(started.serverId);
    revision = 1;

    await manager.refreshForRuntimeRevision();
    expect(manager.runtimeState(started.serverId)).toMatchObject({
      startedWithRevision: original?.startedWithRevision,
      stale: true,
      pendingRefresh: true,
    });
    await manager.refreshForRuntimeRevision();
    expect(manager.runtimeState(started.serverId)).toMatchObject({ stale: false, pendingRefresh: false });
    manager.stopAll();
  });

  it("coalesces rapid revisions and never leaves an idle server stale", async () => {
    let revision = 0;
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const servers = [fakeServer(), fakeServer(() => refreshGate), fakeServer()];
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      createServer: () => servers.shift()!,
    });
    const started = await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    revision = 1;
    const firstRefresh = manager.refreshForRuntimeRevision();
    revision = 3;
    const coalescedRefresh = manager.refreshForRuntimeRevision();
    releaseRefresh();
    await Promise.all([firstRefresh, coalescedRefresh]);

    await vi.waitFor(() =>
      expect(manager.runtimeState(started.serverId)).toMatchObject({
        startedWithRevision: 3,
        stale: false,
        pendingRefresh: false,
      })
    );
    manager.stopAll();
  });

  it("protects the turn/start request window before turn/started arrives", async () => {
    let releaseTurnStart!: () => void;
    const turnStartGate = new Promise<void>((resolve) => {
      releaseTurnStart = resolve;
    });
    const firstServer = fakeServer() as any;
    firstServer.request = vi.fn(() => turnStartGate);
    const replacement = fakeServer();
    const servers = [firstServer, replacement];
    const options: Array<ConstructorParameters<typeof CodexAppServer>[0]> = [];
    let revision = 0;
    const guardedManager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      createServer: (value) => {
        options.push(value);
        return servers.shift()!;
      },
    });
    const started = await guardedManager.start({ cwd: "/workspace", onMessage: () => undefined });
    const request = guardedManager.request({
      serverId: started.serverId,
      method: "turn/start",
      params: {} as any,
    });
    revision = 1;
    await guardedManager.refreshForRuntimeRevision();
    expect(firstServer.stop).not.toHaveBeenCalled();
    releaseTurnStart();
    await request;
    expect(guardedManager.runtimeState(started.serverId)).toMatchObject({ stale: true, busy: true });
    options[0].onMessage?.({
      kind: "notification",
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress", items: [] } },
    } as any);
    expect(firstServer.stop).not.toHaveBeenCalled();
    options[0].onMessage?.({
      kind: "notification",
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } },
    } as any);
    await vi.waitFor(() => expect(guardedManager.runtimeState(started.serverId)?.stale).toBe(false));
    expect(firstServer.stop).toHaveBeenCalledOnce();
    guardedManager.stopAll();
  });

  it("waits for the turn/start RPC response even if turn/completed arrives first", async () => {
    let releaseTurnStart!: (value: unknown) => void;
    const turnStartGate = new Promise<unknown>((resolve) => {
      releaseTurnStart = resolve;
    });
    const active = fakeServer() as any;
    active.request = vi.fn(() => turnStartGate);
    const replacement = fakeServer();
    const servers = [active, replacement];
    const options: Array<ConstructorParameters<typeof CodexAppServer>[0]> = [];
    let revision = 0;
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      createServer: (value) => {
        options.push(value);
        return servers.shift()!;
      },
    });
    const started = await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    const request = manager.request({
      serverId: started.serverId,
      method: "turn/start",
      params: {} as any,
    });
    revision = 1;
    await manager.refreshForRuntimeRevision();

    options[0].onMessage?.({
      kind: "notification",
      method: "turn/started",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress", items: [] } },
    } as any);
    options[0].onMessage?.({
      kind: "notification",
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } },
    } as any);
    await Promise.resolve();
    expect(active.stop).not.toHaveBeenCalled();
    expect(manager.runtimeState(started.serverId)).toMatchObject({ stale: true, busy: true });

    releaseTurnStart({ turn: { id: "turn-1", status: "completed" } });
    await request;
    await vi.waitFor(() => expect(manager.runtimeState(started.serverId)?.stale).toBe(false));
    expect(active.stop).toHaveBeenCalledOnce();
    manager.stopAll();
  });

  it("abandons a replacement if a turn starts while the replacement is booting", async () => {
    let releaseReplacement!: () => void;
    const replacementGate = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    let busy = false;
    const firstServer = fakeServer();
    const abandonedReplacement = fakeServer(() => replacementGate);
    const finalReplacement = fakeServer();
    const servers = [firstServer, abandonedReplacement, finalReplacement];
    let revision = 0;
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      isServerBusy: () => busy,
      createServer: () => servers.shift()!,
    });
    const started = await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    revision = 1;
    const refresh = manager.refreshForRuntimeRevision();
    await vi.waitFor(() => expect(abandonedReplacement.start).toHaveBeenCalledOnce());

    busy = true;
    releaseReplacement();
    await refresh;

    expect(abandonedReplacement.stop).toHaveBeenCalledOnce();
    expect(firstServer.stop).not.toHaveBeenCalled();
    expect(manager.runtimeState(started.serverId)).toMatchObject({ stale: true, pendingRefresh: true });

    busy = false;
    await manager.refreshForRuntimeRevision();
    expect(manager.runtimeState(started.serverId)?.stale).toBe(false);
    expect(firstServer.stop).toHaveBeenCalledOnce();
    manager.stopAll();
  });

  it("stops both the active server and an in-progress replacement during shutdown", async () => {
    let releaseReplacement!: () => void;
    const replacementGate = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    const active = fakeServer();
    const starting = fakeServer(() => replacementGate);
    const servers = [active, starting];
    let revision = 0;
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      createServer: () => servers.shift()!,
    });
    const started = await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    revision = 1;
    const refresh = manager.refreshForRuntimeRevision();
    await vi.waitFor(() => expect(starting.start).toHaveBeenCalledOnce());

    manager.stopAll();
    expect(active.stop).toHaveBeenCalledOnce();
    expect(starting.stop).toHaveBeenCalledOnce();
    expect(manager.runtimeState(started.serverId)).toBeNull();

    releaseReplacement();
    await refresh;
    expect(starting.stop).toHaveBeenCalledTimes(2);
  });

  it("refreshes a stale idle server before dispatching a new turn", async () => {
    let revision = 0;
    const oldServer = fakeServer() as any;
    oldServer.request = vi.fn();
    const newServer = fakeServer() as any;
    newServer.request = vi.fn(async () => ({ turn: { id: "turn-new" } }));
    const servers = [oldServer, newServer];
    const manager = new CodexServerManager({
      resolveRuntimeConfig: runtimeConfig,
      resolveRuntimeRevision: () => revision,
      createServer: () => servers.shift()!,
    });
    const started = await manager.start({ cwd: "/workspace", onMessage: () => undefined });
    revision = 1;

    await manager.request({ serverId: started.serverId, method: "turn/start", params: {} as any });

    expect(oldServer.request).not.toHaveBeenCalled();
    expect(newServer.request).toHaveBeenCalledOnce();
    expect(oldServer.stop).toHaveBeenCalledOnce();
    manager.stopAll();
  });

  it("rejects a new turn while a stale busy server is pending refresh", async () => {
    const fixture = revisionFixture();
    const started = await fixture.manager.start({ cwd: "/workspace", onMessage: () => undefined });
    fixture.busy.add(started.serverId);
    fixture.setRevision(1);

    await expect(
      fixture.manager.request({ serverId: started.serverId, method: "turn/start", params: {} as any })
    ).rejects.toMatchObject({ code: "codex_runtime_refresh_pending" });
    expect(fixture.servers[0].stop).not.toHaveBeenCalled();

    fixture.busy.delete(started.serverId);
    fixture.options[0].onMessage?.({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", items: [] } },
    } as any);
    await vi.waitFor(() => expect(fixture.manager.runtimeState(started.serverId)?.stale).toBe(false));
    fixture.manager.stopAll();
  });
});
