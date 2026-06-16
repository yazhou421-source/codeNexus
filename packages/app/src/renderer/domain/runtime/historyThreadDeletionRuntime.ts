import { codexDesktop } from "../../api/codexDesktopClient";
import type { useThreadStore } from "../../stores/thread.store";
import { invalidateThreadContentCache, type ThreadContentCacheEntry } from "./rendererCacheRuntime";

type ThreadStore = ReturnType<typeof useThreadStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type HistoryThreadDeletionRuntimeDeps = {
  appTimelineId: string;
  threadStore: ThreadStore;
  threadContentCacheByKey: Map<string, ThreadContentCacheEntry>;
  clearThreadRuntimeState: (threadId: string) => void;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type HistoryThreadDeletionRuntime = {
  deleteHistoryThread: (threadId: string) => Promise<void>;
};

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createHistoryThreadDeletionRuntime(
  deps: HistoryThreadDeletionRuntimeDeps
): HistoryThreadDeletionRuntime {
  const {
    appTimelineId,
    threadStore,
    threadContentCacheByKey,
    clearThreadRuntimeState,
    pushEvent,
    showToast,
  } = deps;

  const deleteHistoryThread = async (threadId: string) => {
    const id = String(threadId ?? "").trim();
    if (!id) return;
    const hasHistoryThread = threadStore.threadHistory.some((item) => item.id === id);
    if (!hasHistoryThread && threadStore.hasLocalThread(id)) {
      invalidateThreadContentCache(threadContentCacheByKey, id);
      clearThreadRuntimeState(id);
      pushEvent("history", "已移除本地会话", { threadId: appTimelineId });
      return;
    }
    try {
      await codexDesktop.history.deleteThread({ threadId: id });
      invalidateThreadContentCache(threadContentCacheByKey, id);
      clearThreadRuntimeState(id);
      pushEvent("history", "已删除会话", { threadId: appTimelineId });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      showToast({ kind: "error", title: "删除失败", message: msg });
      pushEvent("history:error", msg, { threadId: appTimelineId, level: "error" });
    }
  };

  return { deleteHistoryThread };
}
