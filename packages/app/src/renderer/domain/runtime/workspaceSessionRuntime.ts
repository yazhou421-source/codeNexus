import { codexDesktop } from "../../api/codexDesktopClient";
import { useAppShellStore } from "../../stores/appShell.store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { useThreadStore } from "../../stores/thread.store";
import { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";
import type { LocalThreadItem, ThreadHistoryItem } from "../types";

type AppShellStore = ReturnType<typeof useAppShellStore>;
type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type WorkspaceFilesStore = ReturnType<typeof useWorkspaceFilesStore>;

type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;
type RefreshRightPanels = (opts?: { forceSkills?: boolean; forceMcp?: boolean }) => Promise<void>;

export type WorkspaceSessionRuntimeDeps = {
  appTimelineId: string;
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  appShellStore: AppShellStore;
  workspaceFilesStore: WorkspaceFilesStore;
  normalizeWorkspacePath: (value: string) => string;
  findThreadListItem: (threadId: string) => ThreadHistoryItem | LocalThreadItem | undefined;
  resetSidePanelStores: (statusText?: string) => void;
  applyCachedRightPanels: (workspacePath: string) => void;
  refreshRightPanels: RefreshRightPanels;
  refreshHistory: (force?: boolean) => Promise<void>;
  hydrateThreadMetadataForWorkspace: (workspacePath: string) => Promise<void>;
  pushEvent: PushEvent;
  translate: TranslateFn;
  showToast: ShowToast;
};

export type WorkspaceSessionRuntime = {
  setThreadWorkspace: (threadId: string, workspacePath: string | undefined) => void;
  clearThreadWorkspace: (threadId: string) => void;
  getWorkspaceForThread: (threadId: string) => string;
  getWorkspaceForServerId: (serverId: string) => string;
  getThreadWorkspaceEntries: () => Array<[string, string]>;
  getServerIdForWorkspace: (workspacePath: string) => string;
  getServerIdForThread: (threadId: string) => string;
  requireActiveWorkspaceServerId: () => string;
  syncActiveServerByWorkspace: (workspacePath: string) => string;
  clearServerById: (serverId: string) => string;
  ensureServerForWorkspace: (workspacePath: string) => Promise<string>;
  startServer: () => Promise<boolean>;
  applyWorkspaceSelection: (workspacePath: string) => Promise<boolean>;
  ensureWorkspaceForSend: () => Promise<boolean>;
  selectWorkspace: () => Promise<void>;
  switchWorkspace: (workspacePath: string) => Promise<boolean>;
};

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createWorkspaceSessionRuntime(deps: WorkspaceSessionRuntimeDeps): WorkspaceSessionRuntime {
  const {
    appTimelineId,
    normalizeWorkspacePath,
    findThreadListItem,
    resetSidePanelStores,
    applyCachedRightPanels,
    refreshRightPanels,
    refreshHistory,
    hydrateThreadMetadataForWorkspace,
    pushEvent,
    translate,
    showToast,
  } = deps;

  const serverIdByWorkspace = new Map<string, string>();
  const workspaceByServerId = new Map<string, string>();
  const workspaceByThreadId = new Map<string, string>();
  let warnedExperimentalApiUnavailable = false;

  const runtimeState = () => useRuntimeStore.getState();
  const threadState = () => useThreadStore.getState();
  const appShellState = () => useAppShellStore.getState();
  const workspaceFilesState = () => useWorkspaceFilesStore.getState();
  const getActiveWorkspace = () => normalizeWorkspacePath(runtimeState().workspacePath);

  const setThreadWorkspace = (threadIdValue: string, workspacePathValue: string | undefined) => {
    const threadId = String(threadIdValue ?? "").trim();
    const workspace = normalizeWorkspacePath(String(workspacePathValue ?? ""));
    if (!threadId) return;
    if (!workspace) {
      workspaceByThreadId.delete(threadId);
      return;
    }
    workspaceByThreadId.set(threadId, workspace);
  };

  const clearThreadWorkspace = (threadIdValue: string) => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return;
    workspaceByThreadId.delete(threadId);
  };

  const getWorkspaceForThread = (threadIdValue: string): string => {
    const threadId = String(threadIdValue ?? "").trim();
    if (!threadId) return "";
    const mapped = normalizeWorkspacePath(workspaceByThreadId.get(threadId) ?? "");
    if (mapped) return mapped;
    const fromHistory = normalizeWorkspacePath(String(findThreadListItem(threadId)?.cwd ?? ""));
    if (fromHistory) {
      workspaceByThreadId.set(threadId, fromHistory);
      return fromHistory;
    }
    return getActiveWorkspace();
  };

  const getWorkspaceForServerId = (serverIdValue: string): string => {
    const serverId = normalizeWorkspacePath(serverIdValue);
    if (!serverId) return "";
    return normalizeWorkspacePath(workspaceByServerId.get(serverId) ?? "");
  };

  const getThreadWorkspaceEntries = (): Array<[string, string]> => {
    return [...workspaceByThreadId.entries()];
  };

  const getServerIdForWorkspace = (workspacePathValue: string): string => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return "";
    return normalizeWorkspacePath(serverIdByWorkspace.get(workspace) ?? "");
  };

  const getServerIdForThread = (threadIdValue: string): string => {
    const workspace = getWorkspaceForThread(threadIdValue);
    if (!workspace) return "";
    return getServerIdForWorkspace(workspace);
  };

  const requireActiveWorkspaceServerId = (): string => {
    const serverId = getServerIdForWorkspace(getActiveWorkspace());
    if (!serverId) throw new Error("server not running");
    return serverId;
  };

  const syncActiveServerByWorkspace = (workspacePathValue: string) => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    const serverId = getServerIdForWorkspace(workspace);
    if (!serverId) {
      runtimeState().clearServer();
      appShellState().setServerConnState("disconnected");
      resetSidePanelStores(translate("runtime.noService"));
      return "";
    }
    runtimeState().setServer(serverId);
    appShellState().setServerConnState("connected");
    return serverId;
  };

  const warnExperimentalApiUnavailableOnce = (detail: string) => {
    if (warnedExperimentalApiUnavailable) return;
    warnedExperimentalApiUnavailable = true;
    pushEvent("experimentalApi", detail || translate("runtime.experimentalApiUnavailableDetail"), {
      threadId: appTimelineId,
      level: "warn",
    });
    showToast({
      kind: "warn",
      title: translate("runtime.experimentalApiDisabledTitle"),
      message: detail || translate("runtime.experimentalApiUnavailableMessage"),
    });
  };

  const registerServerForWorkspace = (workspacePathValue: string, serverIdValue: string) => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    const serverId = normalizeWorkspacePath(serverIdValue);
    if (!workspace || !serverId) return;
    serverIdByWorkspace.set(workspace, serverId);
    workspaceByServerId.set(serverId, workspace);
  };

  const clearServerById = (serverIdValue: string) => {
    const serverId = normalizeWorkspacePath(serverIdValue);
    if (!serverId) return "";
    const workspace = normalizeWorkspacePath(workspaceByServerId.get(serverId) ?? "");
    workspaceByServerId.delete(serverId);
    if (workspace) {
      const mapped = normalizeWorkspacePath(serverIdByWorkspace.get(workspace) ?? "");
      if (mapped === serverId) serverIdByWorkspace.delete(workspace);
    }
    return workspace;
  };

  const ensureServerForWorkspace = async (workspacePathValue: string): Promise<string> => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return "";
    const existingServerId = getServerIdForWorkspace(workspace);
    if (existingServerId) {
      if (getActiveWorkspace() === workspace) {
        syncActiveServerByWorkspace(workspace);
      }
      void hydrateThreadMetadataForWorkspace(workspace);
      return existingServerId;
    }
    try {
      if (getActiveWorkspace() === workspace) {
        appShellState().setServerConnState("connecting");
      }
      const requestedExperimentalApi = true;
      const res = await codexDesktop.codexServer.start({ cwd: workspace, experimentalApi: requestedExperimentalApi });
      const serverId = normalizeWorkspacePath(String(res.serverId ?? ""));
      if (!serverId) throw new Error("serverStart did not return serverId");
      const experimentalApi = Boolean(res.capabilities?.experimentalApi);
      registerServerForWorkspace(workspace, serverId);
      if (getActiveWorkspace() === workspace) {
        runtimeState().setServer(serverId);
        appShellState().setServerConnState("connected");
      }
      if (requestedExperimentalApi && !experimentalApi) {
        warnExperimentalApiUnavailableOnce(translate("runtime.experimentalApiUnavailableDetail"));
      }
      pushEvent(
        "server",
        `started id=${serverId}\nworkspace=${workspace}\nexperimentalApi.requested=${requestedExperimentalApi}\nexperimentalApi.enabled=${experimentalApi}`,
        { threadId: appTimelineId }
      );

      void Promise.allSettled([
        refreshHistory(false),
        hydrateThreadMetadataForWorkspace(workspace),
        getActiveWorkspace() === workspace
          ? refreshRightPanels({ forceSkills: true, forceMcp: true })
          : Promise.resolve(),
      ]);
      return serverId;
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      if (getActiveWorkspace() === workspace) {
        appShellState().setServerConnState("failed", msg);
      }
      pushEvent("server:error", msg, { threadId: appTimelineId, level: "error" });
      showToast({ kind: "error", title: translate("runtime.serverStartFailedTitle"), message: msg });
      return "";
    }
  };

  const startServer = async () => {
    const workspace = getActiveWorkspace();
    if (!workspace) {
      showToast({
        kind: "warn",
        title: translate("runtime.noWorkspaceSelected"),
        message: translate("runtime.selectWorkspaceBeforeStartingServer"),
      });
      return false;
    }
    const serverId = await ensureServerForWorkspace(workspace);
    return Boolean(serverId);
  };

  const applyWorkspaceSelection = async (selectedValue: string) => {
    const selected = normalizeWorkspacePath(selectedValue);
    if (!selected) return false;
    if (selected !== getActiveWorkspace()) {
      const confirmed = await workspaceFilesState().confirmResetDirtyTabsForWorkspaceChange(selected);
      if (!confirmed) return false;
    }
    runtimeState().setWorkspace(selected);
    threadState().setWorkspace(selected);
    pushEvent("workspace", selected, { threadId: appTimelineId });
    void workspaceFilesState().ensureReady(true);
    const activeServerId = syncActiveServerByWorkspace(selected);
    if (activeServerId) {
      applyCachedRightPanels(selected);
      void refreshRightPanels();
    }
    return true;
  };

  const ensureWorkspaceForSend = async (): Promise<boolean> => {
    const cwd = getActiveWorkspace();
    if (cwd) return true;
    const selected = await codexDesktop.workspace.select();
    if (!selected) {
      showToast({
        kind: "info",
        title: translate("runtime.sendCanceledTitle"),
        message: translate("runtime.workspaceSelectionCanceledMessage"),
      });
      return false;
    }
    return await applyWorkspaceSelection(selected);
  };

  const selectWorkspace = async () => {
    const selected = await codexDesktop.workspace.select();
    if (!selected) return;
    const applied = await applyWorkspaceSelection(selected);
    if (!applied) return;
    await startServer();
  };

  const switchWorkspace = async (workspacePathValue: string): Promise<boolean> => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return false;
    const applied = await applyWorkspaceSelection(workspace);
    if (!applied) return false;
    await startServer();
    return true;
  };

  return {
    setThreadWorkspace,
    clearThreadWorkspace,
    getWorkspaceForThread,
    getWorkspaceForServerId,
    getThreadWorkspaceEntries,
    getServerIdForWorkspace,
    getServerIdForThread,
    requireActiveWorkspaceServerId,
    syncActiveServerByWorkspace,
    clearServerById,
    ensureServerForWorkspace,
    startServer,
    applyWorkspaceSelection,
    ensureWorkspaceForSend,
    selectWorkspace,
    switchWorkspace,
  };
}
