import { defineStore } from "./zustandCompat";
import {
  createDefaultCodexSkillRootsState,
  getCodexSkillRootsForWorkspace,
  normalizeCodexSkillRoots,
  normalizeCodexSkillRootsState,
  type CodexSkillRootsState,
} from "@codenexus/shared/codexSkillRoots";
import { codexDesktop } from "../api/codexDesktopClient";

type LoadState = "idle" | "loading" | "ready" | "error";

export const useCodexSkillRootsStore = defineStore("codexSkillRoots", {
  state: () => ({
    loadState: "idle" as LoadState,
    saving: false,
    errorText: "" as string,
    path: "" as string,
    exists: false,
    rootsByWorkspace: {} as Record<string, string[]>,
  }),
  getters: {
    rootsForWorkspace(state) {
      return (workspacePath: string): string[] =>
        getCodexSkillRootsForWorkspace({ version: 1, rootsByWorkspace: state.rootsByWorkspace }, workspacePath);
    },
  },
  actions: {
    applyStateSnapshot(snapshot: { path?: string; exists?: boolean; state?: CodexSkillRootsState }) {
      const normalized = normalizeCodexSkillRootsState(snapshot?.state ?? createDefaultCodexSkillRootsState());
      this.path = String(snapshot?.path ?? "").trim();
      this.exists = Boolean(snapshot?.exists);
      this.rootsByWorkspace = { ...normalized.rootsByWorkspace };
    },
    async refresh() {
      if (this.loadState === "loading") return;
      this.loadState = "loading";
      this.errorText = "";
      try {
        const snapshot = await codexDesktop.app.readCodexSkillRoots();
        this.applyStateSnapshot(snapshot);
        this.loadState = "ready";
      } catch (error: any) {
        this.loadState = "error";
        this.errorText = String(error?.message ?? error ?? "unknown error");
      }
    },
    async setRootsForWorkspace(workspacePath: string, roots: string[]) {
      this.saving = true;
      this.errorText = "";
      try {
        const snapshot = await codexDesktop.app.setCodexSkillRootsForWorkspace({
          workspacePath,
          roots: normalizeCodexSkillRoots(roots),
        });
        this.applyStateSnapshot(snapshot);
        this.loadState = "ready";
      } catch (error: any) {
        this.errorText = String(error?.message ?? error ?? "unknown error");
        throw error;
      } finally {
        this.saving = false;
      }
    },
    async addRootForWorkspace(workspacePath: string, root: string) {
      const roots = normalizeCodexSkillRoots([...this.rootsForWorkspace(workspacePath), root]);
      await this.setRootsForWorkspace(workspacePath, roots);
    },
    async removeRootForWorkspace(workspacePath: string, root: string) {
      const target = String(root ?? "")
        .trim()
        .toLowerCase();
      const roots = this.rootsForWorkspace(workspacePath).filter((item) => item.toLowerCase() !== target);
      await this.setRootsForWorkspace(workspacePath, roots);
    },
  },
});
