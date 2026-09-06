import { type IpcRenderer } from "electron";
import { IPC_CODEX_CHANNELS, IPC_EVENT_CHANNELS } from "../channels";
import { type CodexDesktopApi } from "../types";

export function createCodexServerApi(ipcRenderer: IpcRenderer): CodexDesktopApi["codexServer"] {
  // 发送 JSON-RPC 请求到主进程托管的 Codex 服务。
  const rpc: CodexDesktopApi["codexServer"]["rpc"] = (args) => ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexRpc, args);
  // 发送通知类消息，不等待返回值。
  const notify: CodexDesktopApi["codexServer"]["notify"] = (args) =>
    ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexNotify, args);

  // 订阅 Codex 服务事件，返回一个可取消的解绑函数。
  const onEvent: CodexDesktopApi["codexServer"]["onEvent"] = (cb) => {
    const listener = (_evt: unknown, payload: any) => cb(payload);
    ipcRenderer.on(IPC_EVENT_CHANNELS.codexEvent, listener);
    return () => ipcRenderer.off(IPC_EVENT_CHANNELS.codexEvent, listener);
  };

  return {
    // 检查本机 Codex 安装状态。
    ensureInstalled: () => ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexEnsureInstalled),
    // 读取当前环境诊断结果。
    getDiagnostics: () => ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexDiagnostics),
    // 启动一个新的 Codex server 实例。
    start: (args) => ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexServerStart, args),
    // 停止指定 Codex server 实例。
    stop: (args) => ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexServerStop, args),
    listAccountModels: () => ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexListAccountModels),
    rpc,
    notify,
    // 把 RPC 响应回传给主进程。
    respond: (args) => ipcRenderer.invoke(IPC_CODEX_CHANNELS.codexRespond, args),
    onEvent,
  } satisfies CodexDesktopApi["codexServer"];
}
