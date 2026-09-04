import { defineStore } from "pinia";
import type { RouterProviderRegistrySnapshot, RouterProviderStatus } from "@codenexus/shared/ipc/contracts";
import { DEFAULT_MODEL_NAME } from "@codenexus/shared/modelCatalog";
import { codexDesktop } from "../api/codexDesktopClient";
import { useModelCatalogStore } from "./modelCatalog.store";
import { useRuntimeStore } from "./runtime.store";

type LoadState = "idle" | "loading" | "ready" | "error";

function safeSnapshot(value: RouterProviderRegistrySnapshot): RouterProviderRegistrySnapshot {
  return {
    secureStorageAvailable: Boolean(value?.secureStorageAvailable),
    runtimeRevision: Math.max(0, Math.floor(Number(value?.runtimeRevision ?? 0))),
    providers: Array.isArray(value?.providers)
      ? value.providers.map((provider) => ({
          id: String(provider.id ?? ""),
          displayName: String(provider.displayName ?? ""),
          baseUrl: String(provider.baseUrl ?? ""),
          api: provider.api === "responses" ? "responses" : "chat_completions",
          requiresApiKey: Boolean(provider.requiresApiKey),
          defaultModelId: String(provider.defaultModelId ?? ""),
          configured: Boolean(provider.configured),
          enabled: Boolean(provider.enabled),
          models: Array.isArray(provider.models)
            ? provider.models.map((model) => ({
                id: String(model.id ?? ""),
                displayName: String(model.displayName ?? ""),
                upstreamModel: String(model.upstreamModel ?? ""),
                contextWindow: Math.max(0, Number(model.contextWindow ?? 0)),
                inputModalities: Array.isArray(model.inputModalities)
                  ? model.inputModalities.filter(
                      (modality): modality is "text" | "image" => modality === "text" || modality === "image"
                    )
                  : [],
                selected: Boolean(model.selected),
              }))
            : [],
        }))
      : [],
  };
}

function redactedErrorMessage(error: unknown, secret = ""): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Provider operation failed.");
  const redacted = secret ? raw.split(secret).join("[REDACTED]") : raw;
  return redacted.slice(0, 300) || "Provider operation failed.";
}

export const useProviderRegistryStore = defineStore("providerRegistry", {
  state: () => ({
    loadState: "idle" as LoadState,
    operationProviderId: "" as string,
    errorText: "" as string,
    secureStorageAvailable: false,
    runtimeRevision: 0,
    providers: [] as RouterProviderStatus[],
    lastFallbackFrom: "" as string,
  }),
  getters: {
    availableModelIds(state): string[] {
      return state.providers.flatMap((provider) =>
        provider.configured && provider.enabled
          ? provider.models.filter((model) => model.selected).map((model) => model.id)
          : []
      );
    },
    modelLabels(state): Record<string, string> {
      return Object.fromEntries(
        state.providers.flatMap((provider) =>
          provider.models.map((model) => [model.id, `${provider.displayName} · ${model.displayName}`])
        )
      );
    },
  },
  actions: {
    applySnapshot(snapshot: RouterProviderRegistrySnapshot): void {
      const safe = safeSnapshot(snapshot);
      const revisionChanged = this.loadState !== "idle" && safe.runtimeRevision !== this.runtimeRevision;
      this.secureStorageAvailable = safe.secureStorageAvailable;
      this.runtimeRevision = safe.runtimeRevision;
      this.providers = safe.providers;
      this.loadState = "ready";
      if (revisionChanged) useModelCatalogStore().resetRemoteModels();
      this.reconcileCurrentModel();
    },
    async refresh(): Promise<void> {
      if (this.loadState === "loading") return;
      this.loadState = "loading";
      this.errorText = "";
      try {
        this.applySnapshot(await codexDesktop.app.listRouterProviders());
      } catch (error) {
        this.loadState = "error";
        this.errorText = redactedErrorMessage(error);
      }
    },
    async saveApiKey(providerId: string, apiKey: string): Promise<void> {
      const secret = String(apiKey ?? "").trim();
      if (!secret) throw new Error("Provider API key is required.");
      if (!this.secureStorageAvailable) throw new Error("Secure credential storage is unavailable.");
      await this.runProviderOperation(providerId, secret, () =>
        codexDesktop.app.saveRouterProviderApiKey({ providerId, apiKey: secret })
      );
    },
    async deleteApiKey(providerId: string): Promise<void> {
      await this.runProviderOperation(providerId, "", () =>
        codexDesktop.app.deleteRouterProviderApiKey({ providerId })
      );
    },
    async configureModels(providerId: string, modelIds: string[]): Promise<void> {
      const normalized = [...new Set(modelIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
      await this.runProviderOperation(providerId, "", () =>
        codexDesktop.app.configureRouterProvider({
          providerId,
          enabled: normalized.length > 0,
          modelIds: normalized,
        })
      );
    },
    isKnownProviderModel(modelId: string): boolean {
      return this.providers.some((provider) => provider.models.some((model) => model.id === modelId));
    },
    isAvailableProviderModel(modelId: string): boolean {
      return this.availableModelIds.includes(modelId);
    },
    reconcileCurrentModel(): void {
      const runtimeStore = useRuntimeStore();
      const current = String(runtimeStore.model ?? "").trim();
      this.lastFallbackFrom = "";
      if (!current || !this.isKnownProviderModel(current) || this.isAvailableProviderModel(current)) return;
      this.lastFallbackFrom = current;
      runtimeStore.model = DEFAULT_MODEL_NAME;
    },
    async runProviderOperation(
      providerIdValue: string,
      secret: string,
      operation: () => Promise<RouterProviderRegistrySnapshot>
    ): Promise<void> {
      const providerId = String(providerIdValue ?? "").trim();
      this.operationProviderId = providerId;
      this.errorText = "";
      try {
        this.applySnapshot(await operation());
      } catch (error) {
        this.errorText = redactedErrorMessage(error, secret);
        throw new Error(this.errorText);
      } finally {
        this.operationProviderId = "";
      }
    },
  },
});
