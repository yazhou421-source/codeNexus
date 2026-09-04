import { ipcMain } from "electron";
import { IPC_CODEX_CHANNELS } from "@codenexus/shared/ipc/channels";
import type {
  CodexIncomingMessage,
  CodexNotifyArgs,
  CodexRpcArgs,
  CodexServerRespondArgs,
} from "@codenexus/shared/codex-protocol";
import { detectCodexNative, getCodexDiagnostics } from "../../systemChecks";
import { CodexServerManager } from "../../services/CodexServerManager";

export function registerCodexHandlers(deps: {
  serverManager: CodexServerManager;
  sendEvent: (payload: { serverId: string; msg: CodexIncomingMessage }) => void;
}) {
  const { serverManager, sendEvent } = deps;

  ipcMain.handle(IPC_CODEX_CHANNELS.codexEnsureInstalled, async () => {
    const native = await detectCodexNative();
    return { native };
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexDiagnostics, async () => {
    return await getCodexDiagnostics();
  });

  ipcMain.handle(
    IPC_CODEX_CHANNELS.codexServerStart,
    async (_evt, args: { cwd?: string; experimentalApi?: boolean }) => {
      return await serverManager.start({
        cwd: args?.cwd,
        experimentalApi: Boolean(args?.experimentalApi),
        onMessage: (payload) => {
          sendEvent(payload);
        },
      });
    }
  );

  ipcMain.handle(IPC_CODEX_CHANNELS.codexServerStop, async (_evt, args: { serverId: string }) => {
    return serverManager.stop(args.serverId);
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexRpc, async (_evt, args: CodexRpcArgs) => {
    const result = await serverManager.request(args);
    return { result };
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexNotify, async (_evt, args: CodexNotifyArgs) => {
    return serverManager.notify(args);
  });

  ipcMain.handle(IPC_CODEX_CHANNELS.codexRespond, async (_evt, args: CodexServerRespondArgs) => {
    return serverManager.respond(args);
  });
}
