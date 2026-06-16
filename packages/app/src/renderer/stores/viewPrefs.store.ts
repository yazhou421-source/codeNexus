import { defineStore } from "./zustandCompat";

export const useViewPrefsStore = defineStore("viewPrefs", {
  state: () => ({
    showTimestamps: true,
  }),
  actions: {
    toggleShowTimestamps() {
      this.showTimestamps = !this.showTimestamps;
    },
  },
});
