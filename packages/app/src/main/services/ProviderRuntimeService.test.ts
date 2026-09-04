import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  },
}));

import { createDefaultRouterConfig, EmbeddedRouterManager, type RouterConfig } from "@codenexus/router";
import type { CodexAppServer } from "../codexAppServer";
import { createCodexRouterRuntime } from "../codexRouterRuntime";
import { RuntimeThreadStateTracker } from "../runtimeThreadStateTracker";
import { CodexServerManager } from "./CodexServerManager";
import { ProviderPreferencesStore } from "./ProviderPreferencesStore";
import { ProviderRuntimeService } from "./ProviderRuntimeService";
import { ProviderSecretStore, type ProviderSecretEncryption } from "./ProviderSecretStore";

const directories: string[] = [];
const servers: Server[] = [];
const managers: EmbeddedRouterManager[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(managers.splice(0).map((manager) => manager.stop()));
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function encryption(): ProviderSecretEncryption {
  return {
    isAvailable: () => true,
    encrypt: (plaintext) => Buffer.from(`encrypted:${Buffer.from(plaintext).toString("base64")}`),
    decrypt: (ciphertext) => Buffer.from(ciphertext.toString().replace(/^encrypted:/, ""), "base64").toString(),
  };
}

async function fixture(manager?: EmbeddedRouterManager, baseConfig?: RouterConfig) {
  const directory = await mkdtemp(join(tmpdir(), "codenexus-provider-runtime-"));
  directories.push(directory);
  const secretPath = join(directory, "provider-secrets.json");
  const preferencePath = join(directory, "provider-preferences.json");
  const catalogPath = join(directory, "model-catalog.json");
  const fakeManager = manager ?? ({ updateConfig: vi.fn(), running: true } as unknown as EmbeddedRouterManager);
  const service = new ProviderRuntimeService(
    new ProviderSecretStore(secretPath, encryption()),
    new ProviderPreferencesStore(preferencePath),
    fakeManager,
    catalogPath,
    () => undefined,
    { baseConfig }
  );
  await service.initialize();
  return { catalogPath, directory, fakeManager, preferencePath, secretPath, service };
}

describe("ProviderRuntimeService", () => {
  it("starts with Registry metadata but no callable third-party routes", async () => {
    const { catalogPath, service } = await fixture();
    const snapshot = service.list();

    expect(snapshot.providers.map((provider) => provider.id)).toEqual(["deepseek", "kimi", "qwen", "zhipu"]);
    expect(snapshot.providers.every((provider) => !provider.configured && !provider.enabled)).toBe(true);
    expect(service.routerConfig.models.every((route) => route.authMode === "codex_openai")).toBe(true);
    expect(await readFile(catalogPath, "utf8")).not.toContain("apiKey");
  });

  it("generates routes for all four configured providers without secrets in config or catalog", async () => {
    const { catalogPath, secretPath, service } = await fixture();
    const secrets = {
      deepseek: "synthetic-deepseek-key",
      kimi: "synthetic-kimi-key",
      qwen: "synthetic-qwen-key",
      zhipu: "synthetic-zhipu-key",
    };
    for (const [providerId, apiKey] of Object.entries(secrets)) await service.saveApiKey(providerId, apiKey);

    const routes = service.routerConfig.models.filter((route) => route.authMode === "api_key");
    expect(new Set(routes.map((route) => route.provider))).toEqual(new Set(Object.keys(secrets)));
    const serializedConfig = JSON.stringify(service.routerConfig);
    const catalog = await readFile(catalogPath, "utf8");
    const secretDisk = await readFile(secretPath, "utf8");
    for (const secret of Object.values(secrets)) {
      expect(serializedConfig).not.toContain(secret);
      expect(catalog).not.toContain(secret);
      expect(secretDisk).not.toContain(secret);
    }
    expect(routes.every((route) => route.apiKeyRef === route.provider)).toBe(true);
    expect(routes.map((route) => route.id)).toEqual([
      "deepseek-v4-pro",
      "kimi-k2-7-code",
      "qwen3-coder-plus",
      "glm-4-6",
    ]);
  });

  it("increments the runtime revision only for effective provider changes", async () => {
    const { service } = await fixture();
    const revisions: number[] = [];
    service.onRevisionChange((revision) => revisions.push(revision));

    expect(service.revision).toBe(0);
    await service.saveApiKey("deepseek", "synthetic-revision-key");
    expect(service.revision).toBe(1);
    await service.configure({ providerId: "deepseek", enabled: true, modelIds: ["deepseek-v4-pro"] });
    expect(service.revision).toBe(1);
    await service.configure({ providerId: "deepseek", enabled: true, modelIds: ["deepseek-v4-flash"] });
    expect(service.revision).toBe(2);
    await service.deleteApiKey("deepseek");
    expect(service.revision).toBe(3);
    expect(revisions).toEqual([1, 2, 3]);
  });

  it("persists model selection and hot-reloads the owned Router config", async () => {
    const { fakeManager, service } = await fixture();
    service.setRouterUpdatesEnabled(true);
    await service.saveApiKey("qwen", "synthetic-qwen-key");
    await service.configure({ providerId: "qwen", enabled: true, modelIds: ["qwen3-coder-plus"] });

    expect(service.routerConfig.models.filter((route) => route.provider === "qwen").map((route) => route.id)).toEqual([
      "qwen3-coder-plus",
    ]);
    expect(fakeManager.updateConfig).toHaveBeenCalled();
  });

  it("rotates and deletes secrets while keeping status responses plaintext-free", async () => {
    const { service } = await fixture();
    const first = "synthetic-first-secret";
    const second = "synthetic-second-secret";
    await service.saveApiKey("deepseek", first);
    await service.saveApiKey("deepseek", second);
    expect(service.resolveSecret("deepseek")).toBe(second);
    expect(JSON.stringify(service.list())).not.toContain(first);
    expect(JSON.stringify(service.list())).not.toContain(second);

    const snapshot = await service.deleteApiKey("deepseek");
    expect(snapshot.providers.find((provider) => provider.id === "deepseek")?.configured).toBe(false);
    expect(service.resolveSecret("deepseek")).toBeUndefined();
  });

  it("keeps existing encrypted credentials disabled when secure storage is unavailable", async () => {
    const built = await fixture();
    await built.service.saveApiKey("deepseek", "synthetic-existing-secret");
    const unavailableEncryption: ProviderSecretEncryption = {
      isAvailable: () => false,
      encrypt: () => {
        throw new Error("unavailable");
      },
      decrypt: () => {
        throw new Error("unavailable");
      },
    };
    const restarted = new ProviderRuntimeService(
      new ProviderSecretStore(built.secretPath, unavailableEncryption),
      new ProviderPreferencesStore(built.preferencePath),
      built.fakeManager,
      built.catalogPath
    );

    await restarted.initialize();

    expect(restarted.list().secureStorageAvailable).toBe(false);
    expect(restarted.list().providers.find((provider) => provider.id === "deepseek")?.configured).toBe(false);
    expect(restarted.routerConfig.models.every((route) => route.authMode === "codex_openai")).toBe(true);
    expect(() => restarted.resolveSecret("deepseek")).toThrowError(
      expect.objectContaining({ code: "secure_storage_unavailable" })
    );
  });

  it("rejects unknown providers and models", async () => {
    const { service } = await fixture();
    await expect(service.saveApiKey("unknown", "synthetic-key")).rejects.toMatchObject({ code: "unknown_provider" });
    await expect(
      service.configure({ providerId: "deepseek", enabled: true, modelIds: ["unknown-model"] })
    ).rejects.toMatchObject({ code: "unknown_provider_model" });
  });

  it("passes a synthetic secret from secure storage to a localhost upstream without other exposure", async () => {
    const upstreamAuthorizations: string[] = [];
    const upstream = trackServer(
      createServer(async (request, response) => {
        upstreamAuthorizations.push(String(request.headers.authorization ?? ""));
        for await (const _chunk of request) {
          // Drain the controlled request.
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "chatcmpl_test",
            object: "chat.completion",
            choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        );
      })
    );
    const upstreamOrigin = await listen(upstream);
    let service!: ProviderRuntimeService;
    const manager = trackManager(
      new EmbeddedRouterManager(undefined, { resolveSecret: (secretRef) => service.resolveSecret(secretRef) })
    );
    const baseConfig = { ...createDefaultRouterConfig(), port: 0 };
    const built = await fixture(manager, baseConfig);
    service = built.service;
    const providerSecret = "synthetic-e2e-provider-key";
    await service.saveApiKey("deepseek", providerSecret);
    const localConfig: RouterConfig = {
      ...service.routerConfig,
      models: service.routerConfig.models.map((route) =>
        route.id === "deepseek-v4-pro" ? { ...route, baseUrl: `${upstreamOrigin}/v1` } : route
      ),
    };
    const started = await manager.start(localConfig);
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => logged.push(args.map(String).join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args) => logged.push(args.map(String).join(" ")));

    const modelsResponse = await fetch(`${started.origin}/v1/models`).then((result) => result.json());
    expect(modelsResponse.data.map((model: { id: string }) => model.id)).toContain("deepseek-v4-pro");

    const response = await fetch(`${started.origin}/v1/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${localConfig.authToken}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4-pro", input: "hello" }),
    });
    expect(response.status).toBe(200);
    expect(upstreamAuthorizations).toEqual([`Bearer ${providerSecret}`]);
    expect(logged.join("\n")).not.toContain(providerSecret);
    expect(await readFile(built.secretPath, "utf8")).not.toContain(providerSecret);
    expect(await readFile(built.catalogPath, "utf8")).not.toContain(providerSecret);
    expect(JSON.stringify(localConfig)).not.toContain(providerSecret);

    const codexRuntime = createCodexRouterRuntime(manager.ownedConnection, {
      modelCatalogPath: built.catalogPath,
    })!;
    expect(codexRuntime.globalConfigOverrides.join(" ")).not.toContain(providerSecret);
    expect(Object.values(codexRuntime.childEnv)).not.toContain(providerSecret);
    expect(Object.values({ ...process.env, ...codexRuntime.childEnv })).not.toContain(providerSecret);
    expect(process.env.DEEPSEEK_API_KEY).not.toBe(providerSecret);
  });

  it("refreshes a cached app-server catalog and routes a selected model through the embedded Router", async () => {
    const logs: string[] = [];
    const upstreamAuthorizations: string[] = [];
    const upstreamModels: string[] = [];
    const routerOutputs: unknown[] = [];
    const upstream = trackServer(
      createServer(async (request, response) => {
        upstreamAuthorizations.push(String(request.headers.authorization ?? ""));
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        upstreamModels.push(String(JSON.parse(Buffer.concat(chunks).toString("utf8")).model ?? ""));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "chatcmpl_full_flow",
            object: "chat.completion",
            choices: [
              { index: 0, message: { role: "assistant", content: "controlled e2e ok" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        );
      })
    );
    const upstreamOrigin = await listen(upstream);
    let service!: ProviderRuntimeService;
    const router = trackManager(
      new EmbeddedRouterManager(
        (level, message, error) => logs.push([level, message, error instanceof Error ? error.message : ""].join(" ")),
        { resolveSecret: (secretRef) => service.resolveSecret(secretRef) }
      )
    );
    const built = await fixture(router, { ...createDefaultRouterConfig(), port: 0 });
    service = built.service;
    await router.start(service.routerConfig);
    service.setRouterUpdatesEnabled(true);

    const createdOptions: Array<ConstructorParameters<typeof CodexAppServer>[0]> = [];
    const createdServers: Array<{ stop: ReturnType<typeof vi.fn>; cachedModels: string[] }> = [];
    const activity = new RuntimeThreadStateTracker();
    const appServers = new CodexServerManager({
      resolveRuntimeRevision: () => service.revision,
      resolveRuntimeConfig: () =>
        createCodexRouterRuntime(router.ownedConnection, { modelCatalogPath: built.catalogPath }),
      isServerBusy: (serverId) => activity.isServerBusy(serverId),
      createServer: (options) => {
        createdOptions.push(options);
        const state = { stop: vi.fn(), cachedModels: [] as string[] };
        createdServers.push(state);
        return {
          capabilities: { experimentalApi: false },
          start: async () => {
            const catalog = JSON.parse(await readFile(built.catalogPath, "utf8"));
            state.cachedModels = catalog.models.map((model: { slug: string }) => model.slug);
          },
          stop: state.stop,
          request: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
            if (method === "model/list") {
              return { data: state.cachedModels.map((id) => ({ id })) };
            }
            if (method !== "turn/start") throw new Error(`unsupported controlled method: ${method}`);
            const connection = router.ownedConnection;
            if (!connection) throw new Error("controlled Router is not running");
            options.onMessage?.({
              kind: "notification",
              method: "turn/started",
              params: { threadId: "controlled-thread", turn: { id: "controlled-turn", status: "inProgress" } },
            } as any);
            const result = await fetch(`${connection.origin}/v1/responses`, {
              method: "POST",
              headers: {
                authorization: `Bearer ${connection.authToken}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ model: params.model, input: params.input }),
            });
            if (!result.ok) throw new Error(`controlled Router returned ${result.status}`);
            routerOutputs.push(await result.json());
            options.onMessage?.({
              kind: "notification",
              method: "turn/completed",
              params: { threadId: "controlled-thread", turn: { id: "controlled-turn", status: "completed" } },
            } as any);
            return {
              turn: {
                id: "controlled-turn",
                status: "completed",
                items: [],
                itemsView: { type: "full" },
                error: null,
                startedAt: 1,
                completedAt: 2,
                durationMs: 1,
              },
            };
          }),
          notify: vi.fn(),
          respond: vi.fn(),
        } as unknown as CodexAppServer;
      },
    });
    const startedAppServer = await appServers.start({
      cwd: built.directory,
      onMessage: (payload) => activity.observeEvent(payload),
    });
    expect(
      (
        await appServers.request({
          serverId: startedAppServer.serverId,
          method: "model/list",
          params: { cursor: null, limit: 200, includeHidden: null },
        })
      ).data
    ).not.toContainEqual(expect.objectContaining({ id: "deepseek-v4-pro" }));

    let refresh: Promise<void> = Promise.resolve();
    service.onRevisionChange(() => {
      refresh = appServers.refreshForRuntimeRevision();
    });
    const providerSecret = "synthetic-full-flow-provider-key";
    const rendererDto = await service.saveApiKey("deepseek", providerSecret);
    await refresh;
    const localConfig: RouterConfig = {
      ...service.routerConfig,
      models: service.routerConfig.models.map((route) =>
        route.id === "deepseek-v4-pro" ? { ...route, baseUrl: `${upstreamOrigin}/v1` } : route
      ),
    };
    router.updateConfig(localConfig);

    expect(rendererDto.providers.find((provider) => provider.id === "deepseek")).toMatchObject({
      configured: true,
      enabled: true,
    });
    expect(createdServers).toHaveLength(2);
    expect(createdServers[0].stop).toHaveBeenCalledOnce();
    expect(appServers.runtimeState(startedAppServer.serverId)).toMatchObject({
      startedWithRevision: 1,
      stale: false,
    });
    expect(
      (
        await appServers.request({
          serverId: startedAppServer.serverId,
          method: "model/list",
          params: { cursor: null, limit: 200, includeHidden: null },
        })
      ).data
    ).toContainEqual(expect.objectContaining({ id: "deepseek-v4-pro" }));

    const turnResult = await appServers.request({
      serverId: startedAppServer.serverId,
      method: "turn/start",
      params: { model: "deepseek-v4-pro", input: "hello from controlled e2e" } as any,
    });
    expect(turnResult).toMatchObject({ turn: { id: "controlled-turn", status: "completed" } });
    expect(routerOutputs).toEqual([expect.objectContaining({ output: expect.any(Array) })]);
    expect(upstreamAuthorizations).toEqual([`Bearer ${providerSecret}`]);
    expect(upstreamModels).toEqual(["deepseek-v4-pro"]);

    const catalogText = await readFile(built.catalogPath, "utf8");
    const secretFileText = await readFile(built.secretPath, "utf8");
    const preferencesText = await readFile(built.preferencePath, "utf8").catch(() => "");
    expect(catalogText).toContain("deepseek-v4-pro");
    expect(JSON.stringify(rendererDto)).not.toContain(providerSecret);
    expect(JSON.stringify(createdOptions)).not.toContain(providerSecret);
    expect([catalogText, secretFileText, preferencesText, logs.join("\n")].join("\n")).not.toContain(providerSecret);
    expect(Object.values(process.env)).not.toContain(providerSecret);
    appServers.stopAll();
  });
});

function trackServer(server: Server): Server {
  servers.push(server);
  return server;
}

function trackManager(manager: EmbeddedRouterManager): EmbeddedRouterManager {
  managers.push(manager);
  return manager;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
