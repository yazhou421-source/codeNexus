// 配置 Store：读写 Codex 全局配置，并维护草稿与“未保存改动”状态。
import { defineStore } from "./zustandCompat";
import type { GlobalConfigDraft } from "../domain/types";
import { createDefaultGlobalConfigDraft } from "../domain/serverInterop";
import { translate } from "../i18n/translate";

function createDefaultDraft(): GlobalConfigDraft {
  return createDefaultGlobalConfigDraft();
}

export const useConfigStore = defineStore("config", {
  state: () => ({
    loadState: "idle" as "idle" | "loading" | "ready" | "error",
    statusText: translate("runtime.noService") as string,
    saving: false,
    draft: createDefaultDraft(),
    snapshot: createDefaultDraft(),
  }),
  getters: {
    // 以快照对比判断是否存在未保存改动。
    isDirty(state): boolean {
      return JSON.stringify(state.draft) !== JSON.stringify(state.snapshot);
    },
  },
  actions: {
    // 统一维护加载状态，避免 UI 侧分散判断。
    setLoadState(next: "idle" | "loading" | "ready" | "error", statusText?: string) {
      this.loadState = next;
      if (typeof statusText === "string") this.statusText = statusText;
    },
    setSaving(next: boolean) {
      this.saving = next;
    },
    setDraft(next: Partial<GlobalConfigDraft>) {
      this.draft = { ...this.draft, ...next };
    },
    applySnapshot(next: GlobalConfigDraft) {
      this.snapshot = { ...next };
      this.draft = { ...next };
    },
    // 重置为初始态，通常在断开连接或切换工作区后调用。
    resetState(statusText = translate("runtime.noService")) {
      this.loadState = "idle";
      this.statusText = statusText;
      this.saving = false;
      this.snapshot = createDefaultDraft();
      this.draft = createDefaultDraft();
    },
    // 放弃当前草稿，回滚到最近一次成功读取的快照。
    resetToSnapshot() {
      this.draft = { ...this.snapshot };
    },
  },
});
