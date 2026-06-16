import { codexDesktop } from "../../api/codexDesktopClient";
import { toThreadHistoryItem as toThreadHistoryItemFromHistory } from "../../features/history/threadHistoryItem";
import { fallbackThreadTitle } from "../../features/history/threadTitle";
import { appendDebugLog } from "../../shared/debugLog";
import { useThreadStore } from "../../stores/thread.store";
import type { HistoryThread } from "@codenexus/shared/ipc";
import { invalidateThreadContentCache, type ThreadContentCacheEntry } from "./rendererCacheRuntime";

type ThreadStore = ReturnType<typeof useThreadStore>;

export type HistoryListRuntimeDeps = {
  threadStore: ThreadStore;
  threadContentCacheByKey: Map<string, ThreadContentCacheEntry>;
  getWorkspacePath: () => string;
  setThreadWorkspace: (threadId: string, workspacePath: string | undefined) => void;
  hydrateThreadMetadataForWorkspace: (workspacePath: string) => Promise<void>;
};

export type HistoryListRuntime = {
  applyHistoryItems: (items: HistoryThread[]) => void;
  refreshHistory: (force?: boolean) => Promise<void>;
  subscribeHistoryUpdates: () => () => void;
};

const LOCAL_THREAD_TTL_MS = 10 * 60_000;

function perfNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function elapsedMs(startedAt: number) {
  return Number((perfNow() - startedAt).toFixed(1));
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createHistoryListRuntime(deps: HistoryListRuntimeDeps): HistoryListRuntime {
  const {
    threadContentCacheByKey,
    getWorkspacePath,
    setThreadWorkspace,
    hydrateThreadMetadataForWorkspace,
  } = deps;

  const applyHistoryItems = (items: HistoryThread[]) => {
    const currentThreadStore = useThreadStore.getState();
    invalidateThreadContentCache(threadContentCacheByKey);
    const now = Date.now();
    const incomingThreadIds = new Set<string>();
    for (const item of items) {
      const threadId = String(item?.id ?? "").trim();
      if (threadId) incomingThreadIds.add(threadId);
    }
    const previousTitleById = new Map(
      [...currentThreadStore.threadHistory, ...currentThreadStore.localThreads].map((item) => [
        String(item.id ?? "").trim(),
        String(item.title ?? "").trim(),
      ])
    );
    const nextLocalThreads = currentThreadStore.localThreads.filter((item) => {
      const threadId = String(item.id ?? "").trim();
      if (!threadId || incomingThreadIds.has(threadId)) return false;
      const createdAt = Number(item.createdAt ?? item.updatedAt ?? now);
      return now - createdAt <= LOCAL_THREAD_TTL_MS;
    });
    const historyItems = items
      .map((item) => {
        const historyItem = toThreadHistoryItemFromHistory(item);
        const threadId = String(historyItem.id ?? "").trim();
        const placeholder = fallbackThreadTitle(threadId);
        const nextTitle = String(historyItem.title ?? "").trim();
        const previousTitle = String(previousTitleById.get(threadId) ?? "").trim();
        if ((!nextTitle || nextTitle === placeholder) && previousTitle && previousTitle !== placeholder) {
          historyItem.title = previousTitle;
        }
        return historyItem;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    useThreadStore.setState({
      localThreads: nextLocalThreads,
      threadHistory: historyItems,
    });
    const updatedThreadStore = useThreadStore.getState();
    for (const item of items) {
      const threadId = String(item.id ?? "").trim();
      if (!threadId) continue;
      const running = Boolean(item.running);
      const activeTurnId = running ? String(item.activeTurnId ?? "").trim() : "";
      updatedThreadStore.setThreadRunning(threadId, running);
      updatedThreadStore.setActiveTurn(threadId, activeTurnId);
    }
    for (const item of [...historyItems, ...nextLocalThreads]) {
      setThreadWorkspace(item.id, item.cwd);
    }
  };

  const refreshHistory = async (force = false) => {
    const startedAt = perfNow();
    appendDebugLog("history.refresh", "started", { force });
    try {
      const result = force ? await codexDesktop.history.refresh() : await codexDesktop.history.list();
      const items = Array.isArray(result?.items) ? result.items : [];
      applyHistoryItems(items);
      void hydrateThreadMetadataForWorkspace(getWorkspacePath());
      appendDebugLog("history.refresh", "completed", {
        force,
        count: items.length,
        elapsedMs: elapsedMs(startedAt),
      });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      appendDebugLog("history.refresh", "failed", {
        force,
        elapsedMs: elapsedMs(startedAt),
        message: msg,
      });
      console.warn("[runtimeOrchestrator] refreshHistory failed", msg);
    }
  };

  const subscribeHistoryUpdates = () => {
    return codexDesktop.history.onUpdated((payload) => {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      applyHistoryItems(items);
    });
  };

  return { applyHistoryItems, refreshHistory, subscribeHistoryUpdates };
}
