import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => unknown>() }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
      ipcMock.handlers.set(channel, handler);
    }),
  },
}));

import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import type { ProviderRuntimeService } from "../../services/ProviderRuntimeService";
import { registerProviderHandlers } from "./provider.handlers";

const snapshot = {
  secureStorageAvailable: true,
  providers: [
    {
      id: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      api: "chat_completions" as const,
      requiresApiKey: true,
      defaultModelId: "deepseek-v4-pro",
      configured: true,
      enabled: true,
      models: [],
    },
  ],
};

beforeEach(() => ipcMock.handlers.clear());

describe("Provider IPC", () => {
  it("exposes status/write/delete/configure but no plaintext read channel", async () => {
    const service = {
      list: vi.fn(() => snapshot),
      saveApiKey: vi.fn(async () => snapshot),
      deleteApiKey: vi.fn(async () => snapshot),
      configure: vi.fn(async () => snapshot),
      testConnection: vi.fn(async () => snapshot),
    } as unknown as ProviderRuntimeService;
    registerProviderHandlers({ providerRuntimeService: service });

    expect([...ipcMock.handlers.keys()].sort()).toEqual(
      [
        IPC_APP_CHANNELS.appRouterProvidersList,
        IPC_APP_CHANNELS.appRouterProviderSaveApiKey,
        IPC_APP_CHANNELS.appRouterProviderDeleteApiKey,
        IPC_APP_CHANNELS.appRouterProviderConfigure,
        IPC_APP_CHANNELS.appRouterProviderTestConnection,
      ].sort()
    );
    expect([...ipcMock.handlers.keys()].some((channel) => /read.*key|get.*key/i.test(channel))).toBe(false);
    const result = await ipcMock.handlers.get(IPC_APP_CHANNELS.appRouterProvidersList)?.({});
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("validates IPC values and redacts a submitted secret from errors", async () => {
    const secret = "synthetic-ipc-secret";
    const service = {
      list: vi.fn(() => snapshot),
      saveApiKey: vi.fn(async () => {
        throw new Error(`failed ${secret}`);
      }),
      deleteApiKey: vi.fn(async () => snapshot),
      configure: vi.fn(async () => snapshot),
      testConnection: vi.fn(async () => snapshot),
    } as unknown as ProviderRuntimeService;
    registerProviderHandlers({ providerRuntimeService: service });
    const save = ipcMock.handlers.get(IPC_APP_CHANNELS.appRouterProviderSaveApiKey)!;
    const configure = ipcMock.handlers.get(IPC_APP_CHANNELS.appRouterProviderConfigure)!;

    await expect(save({}, { providerId: "deepseek", apiKey: secret })).rejects.toThrow("failed [REDACTED]");
    await expect(save({}, { providerId: "deepseek", apiKey: 123 })).rejects.toThrow("request is invalid");
    await expect(configure({}, { providerId: "deepseek", enabled: true, modelIds: ["valid", 123] })).rejects.toThrow(
      "request is invalid"
    );
  });

  it("exposes a provider connection test without accepting a key", async () => {
    const testConnection = vi.fn(async () => snapshot);
    const service = {
      list: vi.fn(() => snapshot),
      saveApiKey: vi.fn(async () => snapshot),
      deleteApiKey: vi.fn(async () => snapshot),
      configure: vi.fn(async () => snapshot),
      testConnection,
    } as unknown as ProviderRuntimeService;
    registerProviderHandlers({ providerRuntimeService: service });
    const invoke = ipcMock.handlers.get(IPC_APP_CHANNELS.appRouterProviderTestConnection)!;

    await expect(invoke({}, { providerId: "deepseek" })).resolves.toBe(snapshot);
    expect(testConnection).toHaveBeenCalledWith("deepseek");
    await expect(invoke({}, { providerId: "deepseek", apiKey: "must-not-be-used" })).resolves.toBe(snapshot);
    expect(testConnection).toHaveBeenLastCalledWith("deepseek");
  });
});
