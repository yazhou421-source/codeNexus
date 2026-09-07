import { defineStore } from "pinia";
import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";
import { codexDesktop } from "../api/codexDesktopClient";
import { buildAvailableModelIds, normalizeCustomModelIds, normalizeModelId } from "@codenexus/shared/modelCatalog";

function areSameStringLists(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

type RemoteLoadState = "idle" | "loading" | "ready" | "error";

function normalizeRemoteModelIds(models: unknown): string[] {
  const list = Array.isArray(models) ? (models as Model[]) : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of list) {
    const id = normalizeModelId((item as any)?.model ?? (item as any)?.id);
    if (!id || item.hidden || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export const useModelCatalogStore = defineStore("modelCatalog", {
  state: () => ({
    customIds: [] as string[],
    saving: false,
    errorText: "" as string,
    remoteLoadState: "idle" as RemoteLoadState,
    remoteErrorText: "" as string,
    remoteIds: [] as string[],
    generation: 0,
    lastAccountState: "unknown" as string,
    retryAttempt: 0,
    retryTimer: null as ReturnType<typeof setTimeout> | null,
    remoteLoadedAt: 0 as number,
  }),
  getters: {
    availableModelIds(state): string[] {
      return buildAvailableModelIds(state.customIds, [], state.remoteIds);
    },
  },
  actions: {
    initLocalSettings() {
      const cached = getCachedUserLocalSettings();
      this.customIds = normalizeCustomModelIds(cached.settings.models?.customIds);
      this.errorText = "";
    },
    cancelRetry() {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
    },
    resetRemoteModels() {
      this.cancelRetry();
      this.generation += 1;
      this.remoteLoadState = "idle";
      this.remoteErrorText = "";
      this.remoteIds = [];
      this.remoteLoadedAt = 0;
      this.retryAttempt = 0;
    },
    isRemoteModelUnavailable(id: string): boolean {
      return (
        this.lastAccountState === "logged_out" ||
        this.lastAccountState === "expired" ||
        (this.remoteLoadedAt > 0 && !this.remoteIds.includes(id))
      );
    },
    async accountStatusChanged(status: string): Promise<boolean> {
      if (status === "checking" || status === "logging_in") return false;
      const previous = this.lastAccountState;
      this.lastAccountState = status;
      if (status === "logged_out" || status === "expired") {
        this.resetRemoteModels();
        return false;
      }
      if (status !== "logged_in") return false;
      if (previous !== "logged_in") {
        // Invalidate a pre-login request so its late response cannot hide the recovered catalog.
        this.generation += 1;
        this.remoteLoadState = "idle";
        this.retryAttempt = 0;
        return this.refreshRemoteModels();
      }
      return this.ensureRemoteModels();
    },
    async refreshRemoteModels(options?: { retry?: boolean }): Promise<boolean> {
      if (this.remoteLoadState === "loading") return false;
      this.cancelRetry();
      if (!options?.retry) this.retryAttempt = 0;
      const generation = this.generation;
      this.remoteLoadState = "loading";
      this.remoteErrorText = "";
      try {
        // Account discovery has no dependency on a workspace or chat server.
        const result = await codexDesktop.codexServer.listAccountModels();
        if (!Array.isArray(result.data) || result.nextCursor) throw new Error("Incomplete model catalog");
        if (generation !== this.generation) return false;
        this.remoteIds = normalizeRemoteModelIds(result.data);
        this.remoteLoadState = "ready";
        this.remoteLoadedAt = Date.now();
        this.retryAttempt = 0;
        return true;
      } catch {
        if (generation !== this.generation) return false;
        // A transport failure is not evidence that previously returned models were revoked.
        this.remoteLoadState = "error";
        this.remoteErrorText = "Codex model catalog could not be loaded. Please retry.";
        if (this.retryAttempt < 3) {
          const delay = 2_000 * 2 ** this.retryAttempt;
          this.retryAttempt += 1;
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.refreshRemoteModels({ retry: true });
          }, delay);
        }
        return false;
      }
    },
    async ensureRemoteModels(options?: { maxAgeMs?: number }): Promise<boolean> {
      if (this.lastAccountState === "logged_out" || this.lastAccountState === "expired") return false;
      const maxAgeMs = Math.max(5_000, Number(options?.maxAgeMs ?? 60_000));
      const stale = !this.remoteLoadedAt || Date.now() - this.remoteLoadedAt > maxAgeMs;
      if (!stale && this.remoteLoadState !== "idle" && this.remoteLoadState !== "error") return false;
      return this.refreshRemoteModels();
    },
    async persistCustomIds(nextIds: string[]) {
      this.saving = true;
      this.errorText = "";
      try {
        const normalized = normalizeCustomModelIds(nextIds);
        await patchUserLocalSettings({
          models: {
            customIds: normalized,
          },
        });
        this.customIds = normalized;
      } catch (error: any) {
        this.errorText = String(error?.message ?? error ?? "unknown error");
        throw error;
      } finally {
        this.saving = false;
      }
    },
    async addCustomModel(id: string): Promise<boolean> {
      const nextId = normalizeModelId(id);
      if (!nextId) return false;
      const nextIds = normalizeCustomModelIds([...this.customIds, nextId]);
      if (areSameStringLists(nextIds, this.customIds)) {
        this.errorText = "";
        return false;
      }
      await this.persistCustomIds(nextIds);
      return true;
    },
    async removeCustomModel(id: string): Promise<boolean> {
      const nextId = normalizeModelId(id);
      if (!nextId) return false;
      const nextIds = this.customIds.filter((item) => item !== nextId);
      if (areSameStringLists(nextIds, this.customIds)) {
        this.errorText = "";
        return false;
      }
      await this.persistCustomIds(nextIds);
      return true;
    },
  },
});
