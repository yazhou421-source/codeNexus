import { defineStore } from "./zustandCompat";
import {
  createDefaultCodexConfigSwitcherState,
  createDefaultCodexConfigSwitcherCcswitchStatus,
  getActiveCodexConfigSwitcherProfile,
  normalizeCodexConfigSwitcherState,
  type CodexConfigSwitcherBackup,
  type CodexConfigSwitcherCcswitchStatus,
  type CodexConfigSwitcherProfile,
  type CodexConfigSwitcherState,
} from "@codenexus/shared/codexConfigSwitcher";
import { codexDesktop } from "../api/codexDesktopClient";

type LoadState = "idle" | "loading" | "ready" | "error";

export const useCodexConfigSwitcherStore = defineStore("codexConfigSwitcher", {
  state: () => ({
    loadState: "idle" as LoadState,
    saving: false,
    errorText: "" as string,
    path: "" as string,
    exists: false,
    codexConfigPath: "" as string,
    backupDir: "" as string,
    ccswitch: createDefaultCodexConfigSwitcherCcswitchStatus(),
    state: createDefaultCodexConfigSwitcherState(),
  }),
  getters: {
    profiles(state): CodexConfigSwitcherProfile[] {
      return state.state.profiles;
    },
    activeProfile(state): CodexConfigSwitcherProfile | null {
      return getActiveCodexConfigSwitcherProfile(state.state);
    },
    backups(state): CodexConfigSwitcherBackup[] {
      return state.state.backups;
    },
  },
  actions: {
    applySnapshot(snapshot: {
      path?: string;
      exists?: boolean;
      codexConfigPath?: string;
      backupDir?: string;
      ccswitch?: CodexConfigSwitcherCcswitchStatus;
      state?: CodexConfigSwitcherState;
    }) {
      this.path = String(snapshot?.path ?? "").trim();
      this.exists = Boolean(snapshot?.exists);
      this.codexConfigPath = String(snapshot?.codexConfigPath ?? "").trim();
      this.backupDir = String(snapshot?.backupDir ?? "").trim();
      this.ccswitch = snapshot?.ccswitch ?? createDefaultCodexConfigSwitcherCcswitchStatus();
      this.state = normalizeCodexConfigSwitcherState(snapshot?.state ?? createDefaultCodexConfigSwitcherState());
    },
    async refresh() {
      if (this.loadState === "loading") return;
      this.loadState = "loading";
      this.errorText = "";
      try {
        const snapshot = await codexDesktop.app.readCodexConfigSwitcher();
        this.applySnapshot(snapshot);
        this.loadState = "ready";
      } catch (error: any) {
        this.loadState = "error";
        this.errorText = String(error?.message ?? error ?? "unknown error");
      }
    },
    async saveState(state: CodexConfigSwitcherState) {
      this.saving = true;
      this.errorText = "";
      try {
        const snapshot = await codexDesktop.app.saveCodexConfigSwitcher({ state });
        this.applySnapshot(snapshot);
        this.loadState = "ready";
      } catch (error: any) {
        this.errorText = String(error?.message ?? error ?? "unknown error");
        throw error;
      } finally {
        this.saving = false;
      }
    },
  },
});
