import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";
import {
  BUILTIN_PROVIDER_REGISTRY,
  buildModelCatalog,
  createDefaultRouterConfig,
  createProviderRouterConfig,
  providerDefinition,
  safeProductError,
  testProviderConnection,
  type EmbeddedRouterManager,
  type RouterConfig,
  type RouterModelRoute,
} from "@codenexus/router";
import type { RouterProviderRegistrySnapshot } from "@codenexus/shared/ipc/contracts";
import { ProviderPreferencesStore, type ProviderPreference } from "./ProviderPreferencesStore";
import { ProviderSecretStore } from "./ProviderSecretStore";

export type ProviderRuntimeLog = (message: string, error?: unknown) => void;
export type ProviderRuntimeOptions = { baseConfig?: RouterConfig };

export class ProviderRuntimeService {
  private readonly baseConfig: RouterConfig;
  private readonly codexRouteTemplate: RouterModelRoute | undefined;
  private currentConfig: RouterConfig | null = null;
  private routerUpdatesEnabled = false;
  private revisionValue = 0;
  private readonly revisionListeners = new Set<(revision: number) => void>();
  private readonly testingProviders = new Set<string>();
  private updateQueue: Promise<RouterProviderRegistrySnapshot> = Promise.resolve({
    secureStorageAvailable: false,
    runtimeRevision: 0,
    providers: [],
  });

  constructor(
    private readonly secretStore: ProviderSecretStore,
    private readonly preferencesStore: ProviderPreferencesStore,
    private readonly routerManager: EmbeddedRouterManager,
    readonly modelCatalogPath: string,
    private readonly warn: ProviderRuntimeLog = () => undefined,
    options: ProviderRuntimeOptions = {}
  ) {
    this.baseConfig = options.baseConfig ?? createDefaultRouterConfig();
    this.codexRouteTemplate = this.baseConfig.models.find((route) => route.authMode === "codex_openai");
  }

  async initialize(): Promise<RouterConfig> {
    try {
      await this.secretStore.load();
      this.secretStore.validateAll();
    } catch (error) {
      this.warn("provider credential store could not be fully loaded; affected providers remain disabled", error);
    }
    try {
      await this.preferencesStore.load();
    } catch (error) {
      this.warn("provider preferences could not be loaded; defaults will be used", error);
    }
    await this.refreshRuntime(false);
    return this.routerConfig;
  }

  get routerConfig(): RouterConfig {
    if (!this.currentConfig) throw new Error("Provider runtime is not initialized.");
    return this.currentConfig;
  }

  get revision(): number {
    return this.revisionValue;
  }

  onRevisionChange(listener: (revision: number) => void): () => void {
    this.revisionListeners.add(listener);
    return () => this.revisionListeners.delete(listener);
  }

  setRouterUpdatesEnabled(enabled: boolean): void {
    this.routerUpdatesEnabled = enabled;
  }

  async syncCodexModels(models: readonly Model[]): Promise<void> {
    // An empty account catalog hides choices in the picker. Keep the router's
    // transport configuration valid while signed out; it still requires auth.
    if (!models.length) return;
    const template = this.codexRouteTemplate;
    if (!template) throw new Error("Codex authentication route is not configured.");
    const providerIds = new Set(
      BUILTIN_PROVIDER_REGISTRY.flatMap((provider) => provider.models.map((model) => model.id))
    );
    const routes = models
      .filter((model) => !model.hidden)
      .map((model, priority) => {
        if (providerIds.has(model.model)) throw new Error("Codex catalog conflicts with an API-key model ID.");
        const existing = this.baseConfig.models.find(
          (route) => route.id === model.model && route.authMode === "codex_openai"
        );
        return {
          ...(existing ?? { api: template.api, baseUrl: template.baseUrl, authMode: "codex_openai" as const }),
          id: model.model,
          model: model.model,
          displayName: model.displayName,
          description: model.description,
          priority,
          defaultReasoningLevel: model.defaultReasoningEffort,
          supportedReasoningLevels: model.supportedReasoningEfforts.map((option) => ({
            effort: option.reasoningEffort,
            description: option.description,
          })),
          inputModalities: model.inputModalities,
        };
      });
    const previous = this.baseConfig.models.filter((route) => route.authMode === "codex_openai");
    if (JSON.stringify(previous) === JSON.stringify(routes)) return;
    await this.enqueueUpdate(async () => {
      // Keep provider selections and secrets intact; only synchronize Codex registrations.
      this.baseConfig.models = routes;
    }, true);
  }

  resolveSecret = (secretRef: string): string | undefined => {
    providerDefinition(secretRef);
    return this.secretStore.resolve(secretRef);
  };

  list(): RouterProviderRegistrySnapshot {
    return {
      secureStorageAvailable: this.secretStore.encryptionAvailable,
      runtimeRevision: this.revisionValue,
      providers: BUILTIN_PROVIDER_REGISTRY.map((provider) => {
        const configured = this.providerConfigured(provider.id);
        const preference = this.effectivePreference(provider.id, configured);
        const selected = new Set(preference.modelIds);
        return {
          id: provider.id,
          displayName: provider.displayName,
          baseUrl: provider.baseUrl,
          api: provider.api,
          requiresApiKey: provider.requiresApiKey,
          defaultModelId: provider.defaultModelId,
          configured,
          enabled: preference.enabled,
          verification: this.testingProviders.has(provider.id)
            ? { state: "testing" as const, verifiedAt: null, errorCode: null }
            : (preference.verification ?? { state: "untested" as const, verifiedAt: null, errorCode: null }),
          models: provider.models.map((model) => ({
            id: model.id,
            displayName: model.displayName,
            upstreamModel: model.upstreamModel,
            contextWindow: model.contextWindow,
            inputModalities: [...(model.inputModalities ?? ["text"])],
            selected: selected.has(model.id),
          })),
        };
      }),
    };
  }

  async saveApiKey(providerId: string, apiKey: string): Promise<RouterProviderRegistrySnapshot> {
    const provider = providerDefinition(normalizeProviderId(providerId));
    const secret = String(apiKey ?? "").trim();
    if (!secret) throw providerRuntimeError("invalid_api_key", "Provider API key is required.");
    return await this.enqueueUpdate(async () => {
      await this.secretStore.save(provider.id, secret);
      await this.preferencesStore.set(provider.id, {
        ...this.effectivePreference(provider.id, true),
        verification: { state: "untested", verifiedAt: null, errorCode: null },
      });
    }, true);
  }

  async deleteApiKey(providerId: string): Promise<RouterProviderRegistrySnapshot> {
    const provider = providerDefinition(normalizeProviderId(providerId));
    return await this.enqueueUpdate(async () => {
      await this.secretStore.delete(provider.id);
      await this.preferencesStore.set(provider.id, {
        ...this.effectivePreference(provider.id, false),
        enabled: false,
        verification: { state: "untested", verifiedAt: null, errorCode: null },
      });
    });
  }

  async configure(args: {
    providerId: string;
    enabled: boolean;
    modelIds: readonly string[];
  }): Promise<RouterProviderRegistrySnapshot> {
    const provider = providerDefinition(normalizeProviderId(args.providerId));
    if (typeof args.enabled !== "boolean" || !Array.isArray(args.modelIds)) {
      throw providerRuntimeError("invalid_provider_settings", "Provider settings are invalid.");
    }
    const knownModels = new Set(provider.models.map((model) => model.id));
    const modelIds = [...new Set(args.modelIds.map((value) => String(value ?? "").trim()).filter(Boolean))];
    if (modelIds.some((modelId) => !knownModels.has(modelId))) {
      throw providerRuntimeError("unknown_provider_model", "Unknown provider model.");
    }
    return await this.enqueueUpdate(async () => {
      await this.preferencesStore.set(provider.id, {
        enabled: args.enabled,
        modelIds,
        verification: this.effectivePreference(provider.id, this.providerConfigured(provider.id)).verification,
      });
    });
  }

  async testConnection(providerId: string): Promise<RouterProviderRegistrySnapshot> {
    const provider = providerDefinition(normalizeProviderId(providerId));
    if (!this.secretStore.encryptionAvailable) {
      throw providerRuntimeError("SECURE_STORAGE_UNAVAILABLE", "Secure credential storage is unavailable.");
    }
    if (!this.providerConfigured(provider.id)) {
      throw providerRuntimeError("PROVIDER_NOT_CONFIGURED", "Save an API key before testing this provider.");
    }
    if (this.testingProviders.has(provider.id)) return this.list();
    this.testingProviders.add(provider.id);
    const route = createProviderRouterConfig(this.baseConfig, [
      { providerId: provider.id, modelIds: [provider.defaultModelId] },
    ]).models.find((entry) => entry.id === provider.defaultModelId)!;
    try {
      await testProviderConnection(route, { resolveSecret: this.resolveSecret, timeoutMs: 15_000 });
      this.testingProviders.delete(provider.id);
      return await this.enqueueUpdate(async () => {
        await this.preferencesStore.set(provider.id, {
          ...this.effectivePreference(provider.id, true),
          verification: { state: "verified", verifiedAt: new Date().toISOString(), errorCode: null },
        });
      });
    } catch (error) {
      const product = safeProductError(error, route);
      this.testingProviders.delete(provider.id);
      await this.enqueueUpdate(async () => {
        await this.preferencesStore.set(provider.id, {
          ...this.effectivePreference(provider.id, true),
          verification: { state: "failed", verifiedAt: null, errorCode: product.code },
        });
      });
      throw providerRuntimeError(product.code, product.message);
    } finally {
      this.testingProviders.delete(provider.id);
    }
  }

  private async enqueueUpdate(
    mutate: () => Promise<void>,
    forceRevision = false
  ): Promise<RouterProviderRegistrySnapshot> {
    const task = this.updateQueue.then(async () => {
      const previousSignature = this.runtimeSignature();
      await mutate();
      await this.refreshRuntime(this.routerUpdatesEnabled);
      if (forceRevision || previousSignature !== this.runtimeSignature()) {
        this.revisionValue += 1;
        for (const listener of this.revisionListeners) {
          try {
            listener(this.revisionValue);
          } catch (error) {
            this.warn("provider runtime revision listener failed", error);
          }
        }
      }
      return this.list();
    });
    this.updateQueue = task.catch(() => this.list());
    return await task;
  }

  private async refreshRuntime(updateOwnedRouter: boolean): Promise<void> {
    const selections = BUILTIN_PROVIDER_REGISTRY.flatMap((provider) => {
      const configured = this.providerConfigured(provider.id);
      const preference = this.effectivePreference(provider.id, configured);
      return configured && preference.enabled ? [{ providerId: provider.id, modelIds: preference.modelIds }] : [];
    });
    const nextConfig = createProviderRouterConfig(this.baseConfig, selections);
    await writeModelCatalog(this.modelCatalogPath, buildModelCatalog(nextConfig));
    if (updateOwnedRouter) this.routerManager.updateConfig(nextConfig);
    this.currentConfig = nextConfig;
  }

  private effectivePreference(providerId: string, configured: boolean): ProviderPreference {
    const provider = providerDefinition(providerId);
    const saved = this.preferencesStore.get(providerId);
    if (!saved) {
      return {
        enabled: configured,
        modelIds: [provider.defaultModelId],
      };
    }
    const knownModels = new Set(provider.models.map((model) => model.id));
    return {
      enabled: saved.enabled,
      modelIds: saved.modelIds.filter((modelId) => knownModels.has(modelId)),
      verification: saved.verification,
    };
  }

  private providerConfigured(providerId: string): boolean {
    return this.secretStore.encryptionAvailable && this.secretStore.isConfigured(providerId);
  }

  private runtimeSignature(): string {
    return JSON.stringify(
      this.list().providers.map((provider) => ({
        id: provider.id,
        configured: provider.configured,
        enabled: provider.enabled,
        modelIds: provider.models.filter((model) => model.selected).map((model) => model.id),
      }))
    );
  }
}

async function writeModelCatalog(filePath: string, catalog: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function normalizeProviderId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function providerRuntimeError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
