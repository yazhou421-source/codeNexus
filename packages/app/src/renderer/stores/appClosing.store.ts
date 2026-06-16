import { defineStore } from "./zustandCompat";
import { codexDesktop } from "../api/codexDesktopClient";
import { translate } from "../i18n/translate";
import type { AppClosingStep, AppWindowClosingState } from "@codenexus/shared/ipc";

const DEFAULT_STEPS = (): AppClosingStep[] => [
  { id: "prepareUi", label: translate("appClosing.prepareUi"), status: "pending" },
  { id: "stopTasks", label: translate("appClosing.stopTasks"), status: "pending" },
  { id: "exitApp", label: translate("appClosing.exitApp"), status: "pending" },
];

let stopClosingStateListener: (() => void) | null = null;

function cloneSteps(steps: AppClosingStep[] | undefined): AppClosingStep[] {
  if (!Array.isArray(steps) || steps.length === 0) return DEFAULT_STEPS();
  return steps.map((step) => ({ ...step }));
}

export const useAppClosingStore = defineStore("appClosing", {
  state: () => ({
    visible: false,
    phase: "idle" as AppWindowClosingState["phase"],
    startedAt: 0,
    steps: DEFAULT_STEPS() as AppClosingStep[],
  }),
  actions: {
    initBridge() {
      if (stopClosingStateListener) return;
      stopClosingStateListener = codexDesktop.window.onClosingState((payload) => {
        this.applyClosingState(payload);
      });
    },
    applyClosingState(payload: AppWindowClosingState) {
      if (!payload || payload.phase === "idle" || !payload.visible) {
        this.reset();
        return;
      }
      this.visible = true;
      this.phase = payload.phase;
      this.startedAt = Number.isFinite(payload.startedAt) ? payload.startedAt : Date.now();
      this.steps = cloneSteps(payload.steps);
    },
    reset() {
      this.visible = false;
      this.phase = "idle";
      this.startedAt = 0;
      this.steps = DEFAULT_STEPS();
    },
  },
});
