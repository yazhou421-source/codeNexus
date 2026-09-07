import { type IpcRenderer } from "electron";
import { IPC_APP_CHANNELS, IPC_WORKSPACE_CHANNELS } from "../channels";
import { type CodexDesktopApi } from "../types";

export function createWorkspaceApi(ipcRenderer: IpcRenderer): CodexDesktopApi["workspace"] {
  return {
    activate: (args) => ipcRenderer.invoke(IPC_WORKSPACE_CHANNELS.workspaceActivate, args),
    readGitDiff: (args) => ipcRenderer.invoke(IPC_WORKSPACE_CHANNELS.workspaceGitDiffRead, args),
    // 选择工作区：由主进程弹出目录选择器并更新当前工作区。
    select: () => ipcRenderer.invoke(IPC_APP_CHANNELS.appSelectWorkspace),
    // 反向 diff 预演：先计算将要改哪些文件，再交给 UI 展示确认。
    dryRunApplyReverseDiff: (args) => ipcRenderer.invoke(IPC_WORKSPACE_CHANNELS.workspaceReverseDiffDryRun, args),
    // 反向 diff 应用：确认后真正把补丁写回工作区。
    applyReverseDiff: (args) => ipcRenderer.invoke(IPC_WORKSPACE_CHANNELS.workspaceReverseDiffApply, args),
    // 读取 Git 工作区状态：用于文件树状态字母展示。
    readGitStatus: (args) => ipcRenderer.invoke(IPC_WORKSPACE_CHANNELS.workspaceGitStatusRead, args),
  } satisfies CodexDesktopApi["workspace"];
}
