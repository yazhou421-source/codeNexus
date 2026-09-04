import { defineStore } from "pinia";
import type { OnboardingService, OnboardingStep } from "@codenexus/shared/localSettings";
import type { RouterProviderStatus } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../api/codexDesktopClient";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";
import { getRuntimeOrchestrator } from "../domain/runtimeOrchestrator";
import { useProviderRegistryStore } from "./providerRegistry.store";

type AccountState = "idle" | "checking" | "logged_out" | "logging_in" | "logged_in" | "failed";

export const useOnboardingStore = defineStore("onboarding", {
  state: () => ({
    initialized: false,
    step: "welcome" as OnboardingStep,
    selectedService: null as OnboardingService | null,
    completedAt: null as string | null,
    projectSelected: false,
    projectPath: null as string | null,
    accountState: "idle" as AccountState,
    accountEmail: null as string | null,
    accountPlanType: null as string | null,
    busy: false,
    errorCode: "" as string,
  }),
  getters: {
    visible(state): boolean {
      return state.initialized && !state.completedAt;
    },
    selectedProvider(state): RouterProviderStatus | null {
      if (!state.selectedService || state.selectedService === "chatgpt") return null;
      return useProviderRegistryStore().providers.find((provider) => provider.id === state.selectedService) ?? null;
    },
    accountReady(): boolean {
      if (this.selectedService === "chatgpt") return this.accountState === "logged_in";
      return Boolean(this.selectedProvider?.configured && this.selectedProvider.enabled);
    },
  },
  actions: {
    initialize(): void {
      const settings = getCachedUserLocalSettings().settings.onboarding;
      this.step = settings.step;
      this.selectedService = settings.selectedService;
      this.completedAt = settings.completedAt;
      this.projectSelected = settings.projectSelected;
      this.projectPath = settings.projectPath;
      this.initialized = true;
    },
    async persist(patch: Parameters<typeof patchUserLocalSettings>[0]["onboarding"]): Promise<void> {
      const result = await patchUserLocalSettings({ onboarding: patch });
      const onboarding = result.settings.onboarding;
      this.step = onboarding.step;
      this.selectedService = onboarding.selectedService;
      this.completedAt = onboarding.completedAt;
      this.projectSelected = onboarding.projectSelected;
      this.projectPath = onboarding.projectPath;
    },
    async start(): Promise<void> {
      await this.persist({ step: "service" });
    },
    async selectService(service: OnboardingService): Promise<void> {
      this.errorCode = "";
      this.accountState = "idle";
      this.accountEmail = null;
      this.accountPlanType = null;
      await this.persist({ step: "account", selectedService: service });
      await this.prepareSelectedService();
    },
    async prepareSelectedService(): Promise<void> {
      const service = this.selectedService;
      if (!service) return;
      if (service === "chatgpt") {
        await this.checkAccount();
      } else {
        const registry = useProviderRegistryStore();
        await registry.refresh();
        const provider = registry.providers.find((candidate) => candidate.id === service);
        if (provider?.configured && (!provider.enabled || !provider.models.some((model) => model.selected))) {
          try {
            await registry.configureModels(provider.id, [provider.defaultModelId]);
          } catch (error) {
            this.errorCode = errorCode(error, "provider_save_failed");
          }
        }
      }
    },
    async checkAccount(): Promise<void> {
      this.accountState = "checking";
      this.errorCode = "";
      try {
        const account = await codexDesktop.app.readAccount();
        this.accountState = account.state;
        this.accountEmail = account.email;
        this.accountPlanType = account.planType;
      } catch (error) {
        this.accountState = "failed";
        this.errorCode = errorCode(error, "agent_unavailable");
      }
    },
    async startChatGptLogin(): Promise<void> {
      this.busy = true;
      this.errorCode = "";
      this.accountState = "logging_in";
      try {
        await codexDesktop.app.startChatGptLogin();
      } catch (error) {
        this.accountState = "failed";
        this.errorCode = errorCode(error, "login_start_failed");
      } finally {
        this.busy = false;
      }
    },
    async handleLoginCompleted(payload: { success: boolean }): Promise<void> {
      if (!payload?.success) {
        this.accountState = "failed";
        this.errorCode = "login_failed";
        return;
      }
      await this.checkAccount();
      if (this.accountState !== "logged_in") {
        this.accountState = "failed";
        this.errorCode = "login_not_confirmed";
      }
    },
    async cancelChatGptLogin(): Promise<void> {
      this.busy = true;
      this.errorCode = "";
      try {
        await codexDesktop.app.cancelChatGptLogin();
        await this.checkAccount();
      } catch (error) {
        this.accountState = "failed";
        this.errorCode = errorCode(error, "login_cancel_failed");
      } finally {
        this.busy = false;
      }
    },
    async saveProviderKey(apiKey: string): Promise<void> {
      const provider = this.selectedProvider;
      if (!provider) throw new Error("provider_not_selected");
      this.busy = true;
      this.errorCode = "";
      try {
        const registry = useProviderRegistryStore();
        await registry.saveApiKey(provider.id, apiKey);
        await registry.configureModels(provider.id, [provider.defaultModelId]);
      } catch (error) {
        this.errorCode = errorCode(error, "provider_save_failed");
        throw error;
      } finally {
        this.busy = false;
      }
    },
    async continueToProject(): Promise<void> {
      if (!this.accountReady) return;
      await this.persist({ step: "project" });
    },
    async chooseProject(): Promise<void> {
      this.busy = true;
      this.errorCode = "";
      try {
        const selected = await codexDesktop.workspace.select();
        if (!selected) return;
        const opened = await getRuntimeOrchestrator().switchWorkspace(selected);
        if (!opened) {
          this.errorCode = "project_open_failed";
          return;
        }
        await this.persist({ projectSelected: true, projectPath: selected, step: "complete" });
      } catch (error) {
        this.errorCode = errorCode(error, "project_open_failed");
      } finally {
        this.busy = false;
      }
    },
    async skipProject(): Promise<void> {
      await this.persist({ projectSelected: false, projectPath: null, step: "complete" });
    },
    async finish(): Promise<void> {
      this.busy = true;
      try {
        await this.persist({ step: "complete", completedAt: new Date().toISOString() });
      } finally {
        this.busy = false;
      }
    },
    async back(): Promise<void> {
      if (this.step === "account") await this.persist({ step: "service" });
      else if (this.step === "project") await this.persist({ step: "account" });
      else if (this.step === "complete") await this.persist({ step: "project" });
    },
  },
});

function errorCode(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return fallback;
}
