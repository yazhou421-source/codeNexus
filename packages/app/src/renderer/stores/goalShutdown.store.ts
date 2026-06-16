import { defineStore } from "./zustandCompat";
import type { ThreadGoalState } from "../domain/types";
import { codexDesktop } from "../api/codexDesktopClient";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";
import { showToast } from "../ui/toast";
import { DEFAULT_GOAL_SHUTDOWN_DELAY_SECONDS } from "@codenexus/shared/localSettings";

type GoalShutdownByThreadId = Record<
  string,
  {
    enabled: boolean;
    delaySeconds: number;
    objective: string;
    createdAt: number;
  }
>;

type GoalShutdownCountdown = {
  threadId: string;
  objective: string;
  delaySeconds: number;
  remainingSeconds: number;
  startedAt: number;
};

let countdownTimer: ReturnType<typeof setInterval> | null = null;
const recentlyTriggeredAtByKey = new Map<string, number>();

function normalizeThreadId(value: unknown): string {
  return String(value ?? "").trim();
}

function toGoalKey(goal: ThreadGoalState): string {
  return `${goal.threadId}:${goal.createdAt}:${goal.objective}`;
}

function clearCountdownTimer() {
  if (!countdownTimer) return;
  clearInterval(countdownTimer);
  countdownTimer = null;
}

function matchesGoal(setting: GoalShutdownByThreadId[string] | undefined, goal: ThreadGoalState): boolean {
  if (!setting?.enabled) return false;
  return setting.createdAt === goal.createdAt && setting.objective === goal.objective;
}

export const useGoalShutdownStore = defineStore("goalShutdown", {
  state: () => ({
    shutdownByThreadId: {} as GoalShutdownByThreadId,
    countdown: null as GoalShutdownCountdown | null,
    shuttingDown: false,
    lastErrorText: "" as string,
  }),
  getters: {
    visible(state): boolean {
      return Boolean(state.countdown);
    },
  },
  actions: {
    initLocalSettings() {
      this.shutdownByThreadId = {
        ...getCachedUserLocalSettings().settings.goalAutomation.shutdownByThreadId,
      };
    },
    isEnabledForGoal(goal: ThreadGoalState | null | undefined): boolean {
      if (!goal) return false;
      return matchesGoal(this.shutdownByThreadId[goal.threadId], goal);
    },
    async configureGoal(goal: ThreadGoalState, enabled: boolean) {
      const threadId = normalizeThreadId(goal.threadId);
      if (!threadId) return;
      const nextSetting = enabled
        ? {
            enabled: true,
            delaySeconds: DEFAULT_GOAL_SHUTDOWN_DELAY_SECONDS,
            objective: goal.objective,
            createdAt: goal.createdAt,
          }
        : null;
      if (nextSetting) this.shutdownByThreadId = { ...this.shutdownByThreadId, [threadId]: nextSetting };
      else {
        const next = { ...this.shutdownByThreadId };
        delete next[threadId];
        this.shutdownByThreadId = next;
      }
      await patchUserLocalSettings({
        goalAutomation: {
          shutdownByThreadId: {
            [threadId]: nextSetting,
          },
        },
      });
    },
    observeGoalTransition(previous: ThreadGoalState | null | undefined, next: ThreadGoalState | null | undefined) {
      if (!next || next.status !== "complete") return;
      if (previous?.status === "complete") return;
      const setting = this.shutdownByThreadId[next.threadId];
      if (!matchesGoal(setting, next)) return;
      const key = toGoalKey(next);
      if (this.countdown?.threadId === next.threadId && this.countdown.objective === next.objective) return;
      const now = Date.now();
      const recentAt = recentlyTriggeredAtByKey.get(key) ?? 0;
      if (now - recentAt < 5_000) return;
      recentlyTriggeredAtByKey.set(key, now);
      this.startCountdown(next, setting.delaySeconds);
    },
    startCountdown(goal: ThreadGoalState, delaySeconds: number) {
      clearCountdownTimer();
      this.lastErrorText = "";
      this.shuttingDown = false;
      const seconds = Math.max(1, Math.round(delaySeconds || DEFAULT_GOAL_SHUTDOWN_DELAY_SECONDS));
      this.countdown = {
        threadId: goal.threadId,
        objective: goal.objective,
        delaySeconds: seconds,
        remainingSeconds: seconds,
        startedAt: Date.now(),
      };
      showToast({
        kind: "warn",
        title: "已安排自动关机",
        message: `将在 ${seconds} 秒后关机。`,
      });
      countdownTimer = setInterval(() => {
        if (!this.countdown) {
          clearCountdownTimer();
          return;
        }
        const elapsedSeconds = Math.floor((Date.now() - this.countdown.startedAt) / 1000);
        const remaining = Math.max(0, this.countdown.delaySeconds - elapsedSeconds);
        this.countdown.remainingSeconds = remaining;
        if (remaining > 0) return;
        void this.executeShutdown();
      }, 250);
    },
    cancelCountdown() {
      clearCountdownTimer();
      this.countdown = null;
      this.shuttingDown = false;
      this.lastErrorText = "";
      showToast({
        kind: "success",
        title: "已取消自动关机",
        message: "本次 goal 完成不会继续关机。",
      });
    },
    async executeShutdown() {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      clearCountdownTimer();
      try {
        const result = await codexDesktop.app.shutdownSystemNow();
        if (result?.ok) return;
        this.lastErrorText =
          result?.reason === "unsupported"
            ? "当前系统不支持自动关机。"
            : String(result?.message ?? "系统关机命令执行失败。");
        showToast({
          kind: "error",
          title: "自动关机失败",
          message: this.lastErrorText,
        });
      } catch (error: any) {
        this.lastErrorText = String(error?.message ?? error ?? "系统关机命令执行失败。");
        showToast({
          kind: "error",
          title: "自动关机失败",
          message: this.lastErrorText,
        });
      } finally {
        this.countdown = null;
        this.shuttingDown = false;
      }
    },
  },
});
