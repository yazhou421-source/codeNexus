import { defineStore } from "pinia";
import type { SafeAccountStatus } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../api/codexDesktopClient";

export const useAccountStatusStore = defineStore("account-status", {
  state: () => ({
    status: "unknown" as SafeAccountStatus["state"] | "checking" | "unknown" | "logging_in",
    account: null as SafeAccountStatus | null,
    busy: false,
    error: false,
    checkedAt: 0,
  }),
  actions: {
    async refresh() {
      if (this.busy || this.status === "logging_in") return;
      this.busy = true;
      this.status = "checking";
      this.error = false;
      try {
        this.account = await codexDesktop.app.readAccount();
        this.status = this.account.state;
      } catch {
        this.status = "unknown";
        this.account = null;
        this.error = true;
      } finally {
        this.checkedAt = Date.now();
        this.busy = false;
      }
    },
    async login() {
      if (this.busy || this.status === "logging_in") return;
      this.busy = true;
      this.status = "logging_in";
      this.error = false;
      try {
        await codexDesktop.app.startChatGptLogin();
      } catch {
        this.status = "unknown";
        this.error = true;
      } finally {
        this.busy = false;
      }
    },
    async cancelLogin() {
      if (this.busy) return;
      this.busy = true;
      try {
        await codexDesktop.app.cancelChatGptLogin();
        this.status = "unknown";
      } catch {
        this.error = true;
      } finally {
        this.busy = false;
      }
      if (this.status !== "logging_in") await this.refresh();
    },
    async loginCompleted(success: boolean) {
      this.status = "unknown";
      this.busy = false;
      if (success) await this.refresh();
      else this.error = true;
    },
  },
});
