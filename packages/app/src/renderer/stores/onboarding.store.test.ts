import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {} as any,
  providerSnapshot: {} as any,
  readAccount: vi.fn(),
  startChatGptLogin: vi.fn(),
  cancelChatGptLogin: vi.fn(),
  listRouterProviders: vi.fn(),
  saveRouterProviderApiKey: vi.fn(),
  configureRouterProvider: vi.fn(),
  selectWorkspace: vi.fn(),
  switchWorkspace: vi.fn(),
  patchSettings: vi.fn(async ({ patch }: { patch: any }) => {
    mocks.settings = {
      ...mocks.settings,
      ...patch,
      onboarding: { ...mocks.settings.onboarding, ...patch.onboarding },
      ui: { ...mocks.settings.ui, ...patch.ui },
    };
    return { path: "/tmp/codenexus-onboarding/user-settings.json", exists: true, settings: mocks.settings };
  }),
}));

vi.mock("../api/codexDesktopClient", () => ({
  codexDesktop: {
    app: {
      readAccount: mocks.readAccount,
      startChatGptLogin: mocks.startChatGptLogin,
      cancelChatGptLogin: mocks.cancelChatGptLogin,
      listRouterProviders: mocks.listRouterProviders,
      saveRouterProviderApiKey: mocks.saveRouterProviderApiKey,
      configureRouterProvider: mocks.configureRouterProvider,
    },
    localState: {
      initialSettingsSnapshot: {
        path: "/tmp/codenexus-onboarding/user-settings.json",
        exists: false,
        get settings() {
          return mocks.settings;
        },
      },
      patchSettings: mocks.patchSettings,
    },
    workspace: { select: mocks.selectWorkspace },
  },
}));

vi.mock("../domain/runtimeOrchestrator", () => ({
  getRuntimeOrchestrator: () => ({ switchWorkspace: mocks.switchWorkspace }),
}));

import { DEFAULT_USER_LOCAL_SETTINGS } from "@codenexus/shared/localSettings";
import type { RouterProviderRegistrySnapshot } from "@codenexus/shared/ipc/contracts";
import { clearLocalSettingsMemoryCache } from "../domain/localSettings";
import { useProviderRegistryStore } from "./providerRegistry.store";
import { useOnboardingStore } from "./onboarding.store";

function freshSettings() {
  return structuredClone(DEFAULT_USER_LOCAL_SETTINGS);
}

function deepSeekSnapshot(configured: boolean, enabled: boolean): RouterProviderRegistrySnapshot {
  return {
    secureStorageAvailable: true,
    runtimeRevision: configured ? 2 : 1,
    providers: [
      {
        id: "deepseek",
        displayName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        api: "chat_completions",
        requiresApiKey: true,
        defaultModelId: "deepseek-chat",
        configured,
        enabled,
        models: [
          {
            id: "deepseek-chat",
            displayName: "DeepSeek Chat",
            upstreamModel: "deepseek-chat",
            contextWindow: 65_536,
            inputModalities: ["text"],
            selected: enabled,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = freshSettings();
  mocks.providerSnapshot = deepSeekSnapshot(false, false);
  mocks.listRouterProviders.mockImplementation(async () => mocks.providerSnapshot);
  mocks.saveRouterProviderApiKey.mockImplementation(async () => {
    mocks.providerSnapshot = deepSeekSnapshot(true, false);
    return mocks.providerSnapshot;
  });
  mocks.configureRouterProvider.mockImplementation(async () => {
    mocks.providerSnapshot = deepSeekSnapshot(true, true);
    return mocks.providerSnapshot;
  });
  mocks.startChatGptLogin.mockResolvedValue({ ok: true });
  mocks.cancelChatGptLogin.mockResolvedValue({ ok: true });
  mocks.selectWorkspace.mockResolvedValue("/tmp/codenexus-onboarding/project");
  mocks.switchWorkspace.mockResolvedValue(true);
  clearLocalSettingsMemoryCache();
  setActivePinia(createPinia());
});

describe("controlled onboarding E2E", () => {
  it("completes the fresh DeepSeek path without persisting the submitted API key", async () => {
    const store = useOnboardingStore();
    const providers = useProviderRegistryStore();
    const key = "synthetic-onboarding-deepseek-key";

    store.initialize();
    expect(store.visible).toBe(true);
    expect(mocks.settings.ui.runtimeMode).toBe("codex");

    await store.start();
    await store.selectService("deepseek");
    await store.saveProviderKey(key);
    expect(providers.providers[0]).toMatchObject({ configured: true, enabled: true });
    expect(providers.availableModelIds).toContain("deepseek-chat");
    expect(JSON.stringify(store.$state)).not.toContain(key);
    expect(JSON.stringify(mocks.settings)).not.toContain(key);

    await store.continueToProject();
    await store.chooseProject();
    expect(mocks.switchWorkspace).toHaveBeenCalledWith("/tmp/codenexus-onboarding/project");
    await store.finish();

    expect(store.visible).toBe(false);
    expect(store.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(store.projectSelected).toBe(true);
  });

  it("completes the mocked ChatGPT login path and re-reads the safe account status", async () => {
    mocks.readAccount
      .mockResolvedValueOnce({ state: "logged_out", email: null, planType: null, requiresOpenaiAuth: true })
      .mockResolvedValueOnce({
        state: "logged_in",
        email: "user@example.test",
        planType: "plus",
        requiresOpenaiAuth: false,
      });
    const store = useOnboardingStore();

    store.initialize();
    await store.start();
    await store.selectService("chatgpt");
    expect(store.accountState).toBe("logged_out");

    await store.startChatGptLogin();
    expect(store.accountState).toBe("logging_in");
    await store.handleLoginCompleted({ success: true });
    expect(store.accountState).toBe("logged_in");
    expect(mocks.readAccount).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(store.$state)).not.toMatch(/token|auth\.json|loginId/i);

    await store.continueToProject();
    await store.skipProject();
    await store.finish();
    expect(store.visible).toBe(false);
    expect(store.projectSelected).toBe(false);
  });

  it("reuses an existing Provider key and enables its default model without asking for the key again", async () => {
    mocks.providerSnapshot = deepSeekSnapshot(true, false);
    const store = useOnboardingStore();

    store.initialize();
    await store.start();
    await store.selectService("deepseek");

    expect(mocks.saveRouterProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.configureRouterProvider).toHaveBeenCalledWith({
      providerId: "deepseek",
      enabled: true,
      modelIds: ["deepseek-chat"],
    });
    expect(store.accountReady).toBe(true);
  });

  it("handles failed and cancelled ChatGPT login without retaining a login identifier", async () => {
    mocks.readAccount.mockResolvedValue({
      state: "logged_out",
      email: null,
      planType: null,
      requiresOpenaiAuth: true,
    });
    const store = useOnboardingStore();

    store.initialize();
    await store.start();
    await store.selectService("chatgpt");
    await store.startChatGptLogin();
    await store.handleLoginCompleted({ success: false });
    expect(store.accountState).toBe("failed");

    await store.startChatGptLogin();
    await store.cancelChatGptLogin();
    expect(mocks.cancelChatGptLogin).toHaveBeenCalledOnce();
    expect(store.accountState).toBe("logged_out");
    expect(JSON.stringify(store.$state)).not.toMatch(/loginId|authUrl|token/i);
  });
});
