import { defineStore } from "./zustandCompat";
import type {
  CodexProviderProfile,
  CodexProviderProfileInput,
  CodexProviderProfilesState,
} from "@codenexus/shared/codexProfiles";
import {
  createDefaultCodexProviderProfilesState,
  normalizeCodexProviderProfilesState,
} from "@codenexus/shared/codexProfiles";
import { codexDesktop } from "../api/codexDesktopClient";

type LoadState = "idle" | "loading" | "ready" | "error";

export const useCodexProfilesStore = defineStore("codexProfiles", {
  state: () => ({
    loadState: "idle" as LoadState,
    saving: false,
    applyingProfileId: "" as string,
    errorText: "" as string,
    path: "" as string,
    exists: false,
    activeProfileId: null as string | null,
    profiles: [] as CodexProviderProfile[],
  }),
  getters: {
    activeProfile(state): CodexProviderProfile | null {
      const id = String(state.activeProfileId ?? "").trim();
      if (!id) return null;
      return state.profiles.find((profile) => profile.id === id) ?? null;
    },
  },
  actions: {
    applyStateSnapshot(snapshot: { path?: string; exists?: boolean; state?: CodexProviderProfilesState }) {
      const normalized = normalizeCodexProviderProfilesState(
        snapshot?.state ?? createDefaultCodexProviderProfilesState()
      );
      this.path = String(snapshot?.path ?? "").trim();
      this.exists = Boolean(snapshot?.exists);
      this.activeProfileId = normalized.activeProfileId;
      this.profiles = normalized.profiles;
    },
    async refresh() {
      if (this.loadState === "loading") return;
      this.loadState = "loading";
      this.errorText = "";
      try {
        const snapshot = await codexDesktop.app.readCodexProfiles();
        this.applyStateSnapshot(snapshot);
        this.loadState = "ready";
      } catch (error: any) {
        this.loadState = "error";
        this.errorText = String(error?.message ?? error ?? "unknown error");
      }
    },
    async upsert(profile: CodexProviderProfileInput) {
      this.saving = true;
      this.errorText = "";
      try {
        const snapshot = await codexDesktop.app.upsertCodexProfile({ profile });
        this.applyStateSnapshot(snapshot);
        this.loadState = "ready";
      } catch (error: any) {
        this.errorText = String(error?.message ?? error ?? "unknown error");
        throw error;
      } finally {
        this.saving = false;
      }
    },
    async deleteProfile(id: string) {
      this.saving = true;
      this.errorText = "";
      try {
        const snapshot = await codexDesktop.app.deleteCodexProfile({ id });
        this.applyStateSnapshot(snapshot);
        this.loadState = "ready";
      } catch (error: any) {
        this.errorText = String(error?.message ?? error ?? "unknown error");
        throw error;
      } finally {
        this.saving = false;
      }
    },
    async setActiveProfile(id: string | null) {
      const snapshot = await codexDesktop.app.setActiveCodexProfile({ id });
      this.applyStateSnapshot(snapshot);
      this.loadState = "ready";
    },
  },
});
