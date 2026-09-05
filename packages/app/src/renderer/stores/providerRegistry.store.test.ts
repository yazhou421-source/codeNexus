import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appApi = vi.hoisted(() => ({
  listRouterProviders: vi.fn(),
  saveRouterProviderApiKey: vi.fn(),
  deleteRouterProviderApiKey: vi.fn(),
  configureRouterProvider: vi.fn(),
  testRouterProviderConnection: vi.fn(),
}));

vi.mock("../api/codexDesktopClient", () => ({
  codexDesktop: {
    app: appApi,
    localState: { initialSettingsSnapshot: { path: "", exists: false, settings: undefined } },
  },
}));

import type { RouterProviderRegistrySnapshot } from "@codenexus/shared/ipc/contracts";
import { DEFAULT_MODEL_NAME } from "@codenexus/shared/modelCatalog";
import { useRuntimeStore } from "./runtime.store";
import { useProviderRegistryStore } from "./providerRegistry.store";

function snapshot(overrides: Partial<RouterProviderRegistrySnapshot> = {}): RouterProviderRegistrySnapshot {
  return {
    secureStorageAvailable: true,
    runtimeRevision: 1,
    providers: [
      {
        id: "deepseek",
        displayName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        api: "chat_completions",
        requiresApiKey: true,
        defaultModelId: "deepseek-v4-pro",
        configured: true,
        enabled: true,
        verification: { state: "untested", verifiedAt: null, errorCode: null },
        models: [
          {
            id: "deepseek-v4-pro",
            displayName: "DeepSeek V4 Pro",
            upstreamModel: "deepseek-v4-pro",
            contextWindow: 1_000_000,
            inputModalities: ["text"],
            selected: true,
          },
          {
            id: "deepseek-v4-flash",
            displayName: "DeepSeek V4 Flash",
            upstreamModel: "deepseek-v4-flash",
            contextWindow: 1_000_000,
            inputModalities: ["text"],
            selected: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("providerRegistry store", () => {
  it("stores only the allowlisted Provider DTO fields", () => {
    const store = useProviderRegistryStore();
    store.applySnapshot({
      ...(snapshot() as any),
      encryptedSecret: "ciphertext-must-not-enter-renderer-state",
      providers: [
        {
          ...(snapshot().providers[0] as any),
          apiKey: "plaintext-must-not-enter-renderer-state",
          verification: {
            state: "failed",
            errorCode: "INVALID_API_KEY",
            verifiedAt: null,
            rawBody: "raw-provider-body-must-not-enter-state",
          },
        },
      ],
    });

    expect(JSON.stringify(store.$state)).not.toContain("plaintext-must-not-enter-renderer-state");
    expect(JSON.stringify(store.$state)).not.toContain("ciphertext-must-not-enter-renderer-state");
    expect(JSON.stringify(store.$state)).not.toContain("raw-provider-body-must-not-enter-state");
  });

  it("saves a key, becomes configured, and never stores the key in renderer state", async () => {
    const store = useProviderRegistryStore();
    store.applySnapshot(snapshot({ providers: [{ ...snapshot().providers[0], configured: false, enabled: false }] }));
    const key = "synthetic-renderer-form-key";
    appApi.saveRouterProviderApiKey.mockResolvedValue(snapshot());

    await store.saveApiKey("deepseek", key);

    expect(store.providers[0].configured).toBe(true);
    expect(JSON.stringify(store.$state)).not.toContain(key);
    expect(JSON.stringify({ ids: store.availableModelIds, labels: store.modelLabels })).not.toContain(key);
  });

  it("does not persist a submitted key in renderer storage", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem, getItem: vi.fn(), removeItem: vi.fn() });
    const store = useProviderRegistryStore();
    store.applySnapshot(snapshot({ providers: [{ ...snapshot().providers[0], configured: false, enabled: false }] }));
    appApi.saveRouterProviderApiKey.mockResolvedValue(snapshot());

    await store.saveApiKey("deepseek", "synthetic-nonpersistent-key");

    expect(setItem).not.toHaveBeenCalled();
  });

  it("deletes a key and falls back when the current model becomes unavailable", async () => {
    const store = useProviderRegistryStore();
    const runtime = useRuntimeStore();
    runtime.model = "deepseek-v4-pro";
    store.applySnapshot(snapshot());
    appApi.deleteRouterProviderApiKey.mockResolvedValue(
      snapshot({ providers: [{ ...snapshot().providers[0], configured: false, enabled: false }] })
    );

    await store.deleteApiKey("deepseek");

    expect(runtime.model).toBe(DEFAULT_MODEL_NAME);
    expect(store.lastFallbackFrom).toBe("deepseek-v4-pro");
  });

  it("disables credential persistence when secure storage is unavailable", async () => {
    const store = useProviderRegistryStore();
    store.applySnapshot(snapshot({ secureStorageAvailable: false }));

    await expect(store.saveApiKey("deepseek", "synthetic-unavailable-key")).rejects.toThrow(
      "Secure credential storage is unavailable"
    );
    expect(appApi.saveRouterProviderApiKey).not.toHaveBeenCalled();
  });

  it("exposes only configured and selected models to chat", async () => {
    const store = useProviderRegistryStore();
    store.applySnapshot(snapshot());
    expect(store.availableModelIds).toEqual(["deepseek-v4-pro"]);

    appApi.configureRouterProvider.mockResolvedValue(
      snapshot({
        runtimeRevision: 2,
        providers: [
          {
            ...snapshot().providers[0],
            models: snapshot().providers[0].models.map((model) => ({ ...model, selected: false })),
          },
        ],
      })
    );
    await store.configureModels("deepseek", []);
    expect(store.availableModelIds).toEqual([]);

    store.applySnapshot(snapshot({ providers: [{ ...snapshot().providers[0], configured: false, enabled: true }] }));
    expect(store.availableModelIds).toEqual([]);
  });

  it("redacts a submitted key from renderer-visible errors", async () => {
    const store = useProviderRegistryStore();
    const key = "synthetic-error-key";
    store.applySnapshot(snapshot());
    appApi.saveRouterProviderApiKey.mockRejectedValue(new Error(`failed ${key}`));

    await expect(store.saveApiKey("deepseek", key)).rejects.toThrow("failed [REDACTED]");
    expect(store.errorText).not.toContain(key);
  });

  it("shows testing and applies a verified connection snapshot", async () => {
    const store = useProviderRegistryStore();
    store.applySnapshot(snapshot());
    let observedTesting = false;
    appApi.testRouterProviderConnection.mockImplementation(async () => {
      observedTesting = store.providers[0].verification?.state === "testing";
      return snapshot({
        providers: [
          {
            ...snapshot().providers[0],
            verification: { state: "verified", verifiedAt: "2026-09-05T00:00:00.000Z", errorCode: null },
          },
        ],
      });
    });

    await store.testConnection("deepseek");

    expect(observedTesting).toBe(true);
    expect(store.providers[0].verification).toMatchObject({ state: "verified", errorCode: null });
  });

  it("refreshes a safe failed verification status after a connection error", async () => {
    const store = useProviderRegistryStore();
    store.applySnapshot(snapshot());
    appApi.testRouterProviderConnection.mockRejectedValue(new Error("safe failure"));
    appApi.listRouterProviders.mockResolvedValue(
      snapshot({
        providers: [
          {
            ...snapshot().providers[0],
            verification: { state: "failed", verifiedAt: null, errorCode: "INVALID_API_KEY" },
          },
        ],
      })
    );

    await expect(store.testConnection("deepseek")).rejects.toThrow("safe failure");
    expect(store.providers[0].verification).toMatchObject({ state: "failed", errorCode: "INVALID_API_KEY" });
  });
});
