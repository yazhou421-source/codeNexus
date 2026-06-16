// 跨页共享的 UI 偏好 Store：承载两种运行模式都会用到的轻量界面标志，
// 与 codex 专属的 runtime.store 解耦，避免自定义页面再耦合 codex 中心化 store。
import { defineStore } from "./zustandCompat";

export const useUiPrefsStore = defineStore("uiPrefs", {
  state: () => ({
    // 调试时间线侧栏开关（Ctrl/Cmd+Alt+J），codex 与 custom 两页共用。
    timelineDebugEnabled: false as boolean,
  }),
  actions: {
    setTimelineDebugEnabled(enabled: boolean) {
      this.timelineDebugEnabled = Boolean(enabled);
    },
    toggleTimelineDebugEnabled() {
      this.timelineDebugEnabled = !this.timelineDebugEnabled;
    },
  },
});
