import { appendDebugLog } from "../../shared/debugLog";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";
import type { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";
import type { LocalThreadItem, ThreadHistoryItem } from "../types";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;
type WorkspaceFilesStore = ReturnType<typeof useWorkspaceFilesStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;

export type ThreadSwitchRuntimeDeps = {
  appTimelineId: string;
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  workspaceFilesStore: WorkspaceFilesStore;
  normalizeWorkspacePath: (value: string) => string;
  findThreadListItem: (threadId: string) => ThreadHistoryItem | LocalThreadItem | undefined;
  getWorkspaceForThread: (threadId: string) => string;
  setThreadWorkspace: (threadId: string, workspacePath: string | undefined) => void;
  syncActiveServerByWorkspace: (workspacePath: string) => string;
  ensureServerForWorkspace: (workspacePath: string) => Promise<string>;
  applyCachedRightPanels: (workspacePath: string) => void;
  hasReplayCache: (threadId: string) => boolean;
  hydrateReplayFromCacheIfNeeded: (threadId: string) => boolean;
  loadHistoryMessages: (threadId: string) => Promise<boolean>;
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  refreshThreadGoal: (threadId: string) => Promise<unknown>;
  hydrateThreadHandoffDiagnostics: (threadId: string, opts?: { force?: boolean }) => Promise<unknown>;
  refreshRightPanels: () => Promise<void>;
  pushEvent: PushEvent;
};

export type ThreadSwitchRuntime = {
  switchThread: (threadId: string) => Promise<void>;
};

function perfNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Number((perfNow() - startedAt).toFixed(1));
}

export function createThreadSwitchRuntime(deps: ThreadSwitchRuntimeDeps): ThreadSwitchRuntime {
  const {
    appTimelineId,
    runtimeStore,
    threadStore,
    timelineStore,
    workspaceFilesStore,
    normalizeWorkspacePath,
    findThreadListItem,
    getWorkspaceForThread,
    setThreadWorkspace,
    syncActiveServerByWorkspace,
    ensureServerForWorkspace,
    applyCachedRightPanels,
    hasReplayCache,
    hydrateReplayFromCacheIfNeeded,
    loadHistoryMessages,
    ensureThreadResumed,
    refreshThreadGoal,
    hydrateThreadHandoffDiagnostics,
    refreshRightPanels,
    pushEvent,
  } = deps;

  let latestSwitchThreadSeq = 0;

  const switchThread = async (threadId: string) => {
    const id = String(threadId ?? "").trim();
    if (!id) return;
    const switchStartedAt = perfNow();
    const target = findThreadListItem(id);
    const targetRunning = threadStore.runningThreadIds.has(id);
    const existingTimelineEvents = timelineStore.eventsForThread(id);
    const canFastActivateRunningThread = targetRunning && existingTimelineEvents.length > 0;
    const prevWorkspace = normalizeWorkspacePath(runtimeStore.workspacePath);
    const nextCwd = normalizeWorkspacePath(String(target?.cwd ?? getWorkspaceForThread(id)));
    const didWorkspaceChange = Boolean(nextCwd && nextCwd !== prevWorkspace);
    if (didWorkspaceChange) {
      const confirmed = await workspaceFilesStore.confirmResetDirtyTabsForWorkspaceChange(nextCwd);
      if (!confirmed) return;
    }
    const switchSeq = ++latestSwitchThreadSeq;
    const isActiveSwitch = () => switchSeq === latestSwitchThreadSeq;
    appendDebugLog("thread.switch", "begin", {
      threadId: id,
      running: targetRunning,
      existingTimelineEventCount: existingTimelineEvents.length,
      hasReplayCache: hasReplayCache(id),
      fastActivate: canFastActivateRunningThread,
    });
    threadStore.setLoadingThread(id);
    runtimeStore.setCurrentThread(id);
    threadStore.setCurrentThread(id);
    const reusedReplayCache = hydrateReplayFromCacheIfNeeded(id);
    const shouldLoadHistory = !canFastActivateRunningThread && !reusedReplayCache;
    if (canFastActivateRunningThread) {
      appendDebugLog("thread.switch", "fast activate live timeline", {
        threadId: id,
        existingTimelineEventCount: existingTimelineEvents.length,
      });
    }
    const historyLoadPromise = shouldLoadHistory ? loadHistoryMessages(id) : Promise.resolve(true);
    if (shouldLoadHistory) {
      void historyLoadPromise.finally(() => {
        if (isActiveSwitch()) threadStore.clearLoadingThread(id);
      });
    } else {
      threadStore.clearLoadingThread(id);
    }
    try {
      if (didWorkspaceChange) {
        runtimeStore.setWorkspace(nextCwd);
        threadStore.setWorkspace(nextCwd);
        pushEvent("workspace:history", nextCwd, { threadId: appTimelineId });
        syncActiveServerByWorkspace(nextCwd);
      }
      const workspace = nextCwd || prevWorkspace;
      if (!workspace) {
        await historyLoadPromise;
        return;
      }
      const serverId = await ensureServerForWorkspace(workspace);
      if (!isActiveSwitch()) return;
      if (!serverId) return;

      setThreadWorkspace(id, workspace);
      applyCachedRightPanels(workspace);
      await historyLoadPromise;
      if (!isActiveSwitch()) return;
      appendDebugLog("thread.switch", "history loaded", { threadId: id, elapsedMs: elapsedMs(switchStartedAt) });

      void ensureThreadResumed(id);
      void refreshThreadGoal(id);
      void hydrateThreadHandoffDiagnostics(id, { force: true });

      const mode = didWorkspaceChange ? "full" : "light";
      void Promise.resolve().then(() => {
        if (!isActiveSwitch()) return;
        void workspaceFilesStore.reloadTreeForThreadSwitch({ mode });
      });

      void refreshRightPanels();
    } finally {
      threadStore.clearLoadingThread(id);
    }
  };

  return { switchThread };
}
