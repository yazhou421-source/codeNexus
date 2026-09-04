import { ipcMain, shell } from "electron";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import type { SafeAccountLoginCompleted } from "@codenexus/shared/ipc/contracts";
import type { CodexAccountService } from "../../services/CodexAccountService";

export function registerAccountHandlers(deps: {
  accountService: CodexAccountService;
  sendLoginCompleted: (payload: SafeAccountLoginCompleted) => void;
}): void {
  const { accountService } = deps;
  accountService.onLoginCompleted((payload) => deps.sendLoginCompleted(payload));

  ipcMain.handle(IPC_APP_CHANNELS.appAccountRead, async () => accountService.read());
  ipcMain.handle(IPC_APP_CHANNELS.appAccountLoginStart, async () => {
    const result = await accountService.startChatGptLogin();
    try {
      await shell.openExternal(result.authUrl);
    } catch {
      await accountService.cancelLogin().catch(() => undefined);
      throw Object.assign(new Error("The sign-in page could not be opened. Please try again."), {
        code: "browser_open_failed",
      });
    }
    return { ok: true as const };
  });
  ipcMain.handle(IPC_APP_CHANNELS.appAccountLoginCancel, async () => accountService.cancelLogin());
}
