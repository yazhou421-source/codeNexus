import { defineStore } from "./zustandCompat";
import type { Model } from "@codenexus/generated/codex-app-server/v2/Model";
import type { ModelListParams } from "@codenexus/generated/codex-app-server/v2/ModelListParams";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";
import { codexDesktop } from "../api/codexDesktopClient";
import { useRuntimeStore } from "./runtime.store";
import {
  buildAvailableModelIds,
  normalizeCustomModelIds,
  normalizeModelId,
  normalizeModelIdList,
} from "@codenexus/shared/modelCatalog";

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
    if (!id || seen.has(id)) continue;
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
    remoteServerId: "" as string,
    remoteLoadedAt: 0 as number,
  }),
  getters: {
    availableModelIds(state): string[] {
      return buildAvailableModelIds(state.customIds);
    },
  },
  actions: {
    initLocalSettings() {
      const cached = getCachedUserLocalSettings();
      this.customIds = normalizeCustomModelIds(cached.settings.models?.customIds);
      this.errorText = "";
    },
    resetRemoteModels() {
      this.remoteLoadState = "idle";
      this.remoteErrorText = "";
      this.remoteIds = [];
      this.remoteServerId = "";
      this.remoteLoadedAt = 0;
    },
    async refreshRemoteModels(options?: { includeHidden?: boolean }) {
      const runtimeStore = useRuntimeStore();
      const serverId = String(runtimeStore.serverId ?? "").trim();
      if (!serverId) {
        this.resetRemoteModels();
        return false;
      }

      if (this.remoteLoadState === "loading") return false;
      this.remoteLoadState = "loading";
      this.remoteErrorText = "";
      try {
        const ids: string[] = [];
        let cursor: string | null = null;
        const includeHidden = options?.includeHidden ?? false;
        for (let page = 0; page < 12; page += 1) {
          const params: ModelListParams = {
            cursor,
            limit: 200,
            includeHidden: includeHidden ? true : null,
          };
          const { result } = await codexDesktop.codexServer.rpc({
            serverId,
            method: "model/list",
            params,
          });
          const batch = normalizeRemoteModelIds((result as any)?.data);
          for (const id of batch) ids.push(id);
          const nextCursor = String((result as any)?.nextCursor ?? "").trim();
          cursor = nextCursor ? nextCursor : null;
          if (!cursor) break;
        }
        this.remoteIds = normalizeModelIdList(ids);
        this.remoteLoadState = "ready";
        this.remoteServerId = serverId;
        this.remoteLoadedAt = Date.now();
        return true;
      } catch (error: any) {
        this.remoteLoadState = "error";
        this.remoteErrorText = String(error?.message ?? error ?? "unknown error");
        return false;
      }
    },
    async ensureRemoteModels(options?: { maxAgeMs?: number }) {
      const runtimeStore = useRuntimeStore();
      const serverId = String(runtimeStore.serverId ?? "").trim();
      if (!serverId) {
        this.resetRemoteModels();
        return false;
      }
      const maxAgeMs = Math.max(5_000, Number(options?.maxAgeMs ?? 60_000));
      const stale = !this.remoteLoadedAt || Date.now() - this.remoteLoadedAt > maxAgeMs;
      const serverChanged = this.remoteServerId !== serverId;
      const shouldReload = serverChanged || stale || this.remoteLoadState === "idle";
      if (!shouldReload) return false;
      return await this.refreshRemoteModels();
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
