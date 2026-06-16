import { codexDesktop } from "../../api/codexDesktopClient";
import type { ThreadMemoryMode } from "@codenexus/generated/codex-app-server/ThreadMemoryMode";
import type { useRuntimeStore } from "../../stores/runtime.store";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type ThreadMemoryRuntimeDeps = {
  appTimelineId: string;
  runtimeStore: RuntimeStore;
  getServerIdForWorkspace: (workspacePath: string) => string;
  getServerIdForThread: (threadId: string) => string;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type ThreadMemoryRuntime = {
  resetCodexMemory: () => Promise<void>;
  setCurrentThreadMemoryMode: (mode: ThreadMemoryMode) => Promise<void>;
};

export function createThreadMemoryRuntime(deps: ThreadMemoryRuntimeDeps): ThreadMemoryRuntime {
  const {
    appTimelineId,
    runtimeStore,
    getServerIdForWorkspace,
    getServerIdForThread,
    pushEvent,
    showToast,
  } = deps;

  const resetCodexMemory = async () => {
    const serverId = getServerIdForWorkspace(runtimeStore.workspacePath);
    if (!serverId) {
      showToast({
        kind: "warn",
        title: "无法重置记忆",
        message: "当前未连接 Codex 服务。",
      });
      return;
    }
    try {
      await codexDesktop.codexServer.rpc({ serverId, method: "memory/reset" });
      showToast({
        kind: "success",
        title: "记忆已重置",
        message: "Codex 记忆已清空。",
      });
      pushEvent("memory/reset", "Codex memory reset", { threadId: runtimeStore.currentThreadId || appTimelineId });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message || e.name : String(e ?? "");
      showToast({
        kind: "error",
        title: "重置记忆失败",
        message: msg || "memory/reset failed",
      });
      pushEvent("memory/reset:error", msg || "memory/reset failed", {
        threadId: runtimeStore.currentThreadId || appTimelineId,
        level: "error",
      });
    }
  };

  const setCurrentThreadMemoryMode = async (mode: ThreadMemoryMode) => {
    const threadId = String(runtimeStore.currentThreadId ?? "").trim();
    if (!threadId) {
      showToast({
        kind: "warn",
        title: "无法设置记忆",
        message: "请先选择一个线程。",
      });
      return;
    }
    const serverId = getServerIdForThread(threadId);
    if (!serverId) {
      showToast({
        kind: "warn",
        title: "无法设置记忆",
        message: "当前线程未连接 Codex 服务。",
      });
      return;
    }
    try {
      await codexDesktop.codexServer.rpc({ serverId, method: "thread/memoryMode/set", params: { threadId, mode } });
      const enabled = mode === "enabled";
      showToast({
        kind: "success",
        title: enabled ? "线程记忆已启用" : "线程记忆已关闭",
        message: enabled
          ? "当前线程会使用 Codex 记忆。"
          : "当前线程不会使用 Codex 记忆。",
      });
      pushEvent("memory/mode", `thread memory mode: ${mode}`, { threadId });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message || e.name : String(e ?? "");
      showToast({
        kind: "error",
        title: "设置记忆失败",
        message: msg || "thread/memoryMode/set failed",
      });
      pushEvent("memory/mode:error", msg || "thread/memoryMode/set failed", { threadId, level: "error" });
    }
  };

  return { resetCodexMemory, setCurrentThreadMemoryMode };
}
