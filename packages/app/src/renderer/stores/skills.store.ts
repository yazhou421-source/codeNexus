// Skills Store：读取技能列表、启停写回，并维护右侧面板展示状态。
import { defineStore } from "./zustandCompat";
import type { SkillState } from "../domain/types";

export const useSkillsStore = defineStore("skills", {
  state: () => ({
    loadState: "idle" as "idle" | "loading" | "ready" | "error",
    errorText: "" as string,
    summaryText: "" as string,
    items: [] as SkillState[],
    parseErrors: [] as string[],
  }),
  actions: {
    // 维护技能列表加载态，便于右侧面板显示统一反馈。
    setLoadState(next: "idle" | "loading" | "ready" | "error", errorText = "") {
      this.loadState = next;
      this.errorText = errorText;
    },
    setSummary(summary: string) {
      this.summaryText = summary;
    },
    setParseErrors(errors: string[]) {
      this.parseErrors = [...errors];
    },
    setItems(items: SkillState[]) {
      this.items = [...items];
    },
    // 清空状态，通常在断连或重新拉取前调用。
    resetState(errorText = "") {
      this.loadState = "idle";
      this.errorText = errorText;
      this.summaryText = "";
      this.items = [];
      this.parseErrors = [];
    },
  },
});
