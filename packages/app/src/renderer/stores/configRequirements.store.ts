import { defineStore } from "./zustandCompat";
import type { ConfigRequirements } from "@codenexus/generated/codex-app-server/v2/ConfigRequirements";

export const useConfigRequirementsStore = defineStore("configRequirements", {
  state: () => ({
    loadState: "idle" as "idle" | "loading" | "ready" | "error",
    statusText: "未连接服务" as string,
    requirements: null as ConfigRequirements | null,
  }),
  actions: {
    setLoadState(next: "idle" | "loading" | "ready" | "error", statusText?: string) {
      this.loadState = next;
      if (typeof statusText === "string") this.statusText = statusText;
    },
    setRequirements(next: ConfigRequirements | null) {
      this.requirements = next;
    },
    resetState(statusText = "未连接服务") {
      this.loadState = "idle";
      this.statusText = statusText;
      this.requirements = null;
    },
  },
});
