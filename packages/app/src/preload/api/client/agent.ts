import { type IpcRenderer } from "electron";
import { IPC_AGENT_CHANNELS, IPC_EVENT_CHANNELS } from "../channels";
import { type CodexDesktopApi } from "../types";

// 自定义运行时能力：把对话历史交给主进程的 agent-core 内核执行一次回合，并订阅流式增量。
export function createAgentApi(ipcRenderer: IpcRenderer): CodexDesktopApi["agent"] {
  // 订阅自定义运行时的流式文本增量，返回可取消的解绑函数。
  const onEvent: CodexDesktopApi["agent"]["onEvent"] = (cb) => {
    const listener = (_evt: unknown, payload: any) => cb(payload);
    ipcRenderer.on(IPC_EVENT_CHANNELS.agentEvent, listener);
    return () => ipcRenderer.off(IPC_EVENT_CHANNELS.agentEvent, listener);
  };

  return {
    run: (args) => ipcRenderer.invoke(IPC_AGENT_CHANNELS.agentRun, args),
    approve: (args) => ipcRenderer.invoke(IPC_AGENT_CHANNELS.agentApprove, args),
    listSessions: () => ipcRenderer.invoke(IPC_AGENT_CHANNELS.agentSessionList),
    getSession: (args) => ipcRenderer.invoke(IPC_AGENT_CHANNELS.agentSessionGet, args),
    createSession: (args) => ipcRenderer.invoke(IPC_AGENT_CHANNELS.agentSessionCreate, args),
    upsertSession: (args) => ipcRenderer.invoke(IPC_AGENT_CHANNELS.agentSessionUpsert, args),
    deleteSession: (args) => ipcRenderer.invoke(IPC_AGENT_CHANNELS.agentSessionDelete, args),
    onEvent,
  } satisfies CodexDesktopApi["agent"];
}
