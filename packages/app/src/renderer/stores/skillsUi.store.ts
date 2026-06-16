import { defineStore } from "./zustandCompat";

export const useSkillsUiStore = defineStore("skillsUi", {
  state: () => ({
    managerOpen: false,
    expandedByKey: {} as Record<string, boolean>,
  }),
  getters: {
    isExpanded(state): (key: string) => boolean {
      return (key: string) => Boolean(state.expandedByKey[String(key ?? "").trim()]);
    },
  },
  actions: {
    openManager() {
      this.managerOpen = true;
    },
    closeManager() {
      this.managerOpen = false;
    },
    toggleExpanded(key: string) {
      const id = String(key ?? "").trim();
      if (!id) return;
      this.expandedByKey = { ...this.expandedByKey, [id]: !this.isExpanded(id) };
    },
  },
});
