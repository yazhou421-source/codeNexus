import zhCN from "../i18n/messages/zh-CN";
import { useModelCatalogStore } from "./modelCatalog.store";
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
import { providerPresentation } from "../domain/providerPresentation";

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

describe("Design V1 acceptance provider state matrix (no credentials)", () => {
  it.each([
    ["Configured + Available", true, "verified", null, true],
    ["Configured + Unavailable", true, "failed", "PROVIDER_UNAVAILABLE", false],
    ["Configured + Validation Failed", true, "failed", "INVALID_API_KEY", false],
    ["Not Configured", false, "untested", null, false],
    ["Checking", true, "testing", null, false],
  ] as const)(
    "%s keeps credential, connection, timestamp and model availability consistent",
    (_label, configured, state, errorCode, available) => {
      const store = useProviderRegistryStore();
      store.applySnapshot(
        snapshot({
          providers: [
            {
              ...snapshot().providers[0],
              configured,
              verification: { state, errorCode, verifiedAt: state === "verified" ? "2026-09-07T00:00:00Z" : null },
            },
          ],
        })
      );
      const provider = store.providers[0];
      expect(provider.configured).toBe(configured);
      expect(provider.verification).toEqual({
        state,
        errorCode,
        verifiedAt: state === "verified" ? "2026-09-07T00:00:00Z" : null,
      });
      expect(providerPresentation(provider)).toEqual({
        credential: configured ? "success" : "idle",
        connection:
          state === "verified"
            ? "success"
            : state === "failed"
              ? "unavailable"
              : state === "testing"
                ? "loading"
                : "idle",
        lastChecked: state === "verified" ? "2026-09-07T00:00:00Z" : null,
        selectable: available,
      });
      expect(store.isAvailableProviderModel("deepseek-v4-pro")).toBe(available);
      expect(store.pickerModelIds.includes("deepseek-v4-pro")).toBe(configured);
      expect(appApi.listRouterProviders).not.toHaveBeenCalled();
    }
  );
});

it("Provider revision changes preserve the last successful independent account catalog", () => {
  const models = useModelCatalogStore();
  models.remoteIds = ["gpt-6-astra"];
  models.remoteLoadState = "ready";
  models.remoteLoadedAt = 123;
  const providers = useProviderRegistryStore();
  providers.applySnapshot(snapshot());
  providers.applySnapshot(snapshot({ runtimeRevision: 2 }));
  expect(models.remoteIds).toEqual(["gpt-6-astra"]);
  expect(models.remoteLoadedAt).toBe(123);
  expect(models.remoteLoadState).toBe("ready");
});

it("K separates provider failure from account unavailability and login messaging", () => {
  const providers = useProviderRegistryStore();
  const state = snapshot();
  state.providers[0].verification = { state: "failed", verifiedAt: null, errorCode: "NETWORK_ERROR" };
  providers.applySnapshot(state);
  const catalog = useModelCatalogStore();
  catalog.lastAccountState = "logged_in";
  catalog.remoteLoadState = "ready";
  catalog.remoteLoadedAt = 123;
  catalog.remoteIds = ["gpt-5.6-sol"];
  expect(providers.isKnownProviderModel("deepseek-v4-pro")).toBe(true);
  expect(providers.isAvailableProviderModel("deepseek-v4-pro")).toBe(false);
  expect(providerPresentation(providers.providers[0]).connection).toBe("unavailable");
  expect(zhCN.modelAvailability.provider).toBe("服务连接不可用 · 请检查服务设置");
  expect(zhCN.modelAvailability[catalog.availabilityReason("gpt-6-astra") as "account"]).toBe("当前账户暂不可用");
  catalog.lastAccountState = "logged_out";
  expect(zhCN.modelAvailability[catalog.availabilityReason("gpt-6-astra") as "login"]).toBe("请先登录 ChatGPT/Codex");
});
