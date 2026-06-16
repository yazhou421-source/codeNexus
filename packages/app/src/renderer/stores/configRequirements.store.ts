import { defineStore } from "./zustandCompat";
import type { ConfigRequirements } from "@codenexus/generated/codex-app-server/v2/ConfigRequirements";
import { translate } from "../i18n/translate";

export const useConfigRequirementsStore = defineStore("configRequirements", {
  state: () => ({
    loadState: "idle" as "idle" | "loading" | "ready" | "error",
    statusText: translate("runtime.noService") as string,
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
    resetState(statusText = translate("runtime.noService")) {
      this.loadState = "idle";
      this.statusText = statusText;
      this.requirements = null;
    },
  },
});
