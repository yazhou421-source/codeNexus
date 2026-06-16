import { codexDesktop } from "../../api/codexDesktopClient";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type ThreadRollbackRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  normalizeWorkspacePath: (value: string) => string;
  getWorkspaceForThread: (threadId: string) => string;
  getServerIdForThread: (threadId: string) => string;
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type ThreadRollbackRuntime = {
  requestThreadRollback: (threadId: string, turns: number) => Promise<boolean>;
  rollbackTurns: () => Promise<void>;
};

async function promptNumberModalLazy(options: Parameters<(typeof import("../../ui/modal"))["promptNumberModal"]>[0]) {
  const { promptNumberModal } = await import("../../ui/modal");
  return promptNumberModal(options);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

export function createThreadRollbackRuntime(deps: ThreadRollbackRuntimeDeps): ThreadRollbackRuntime {
  const {
    runtimeStore,
    threadStore,
    timelineStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    getServerIdForThread,
    ensureThreadResumed,
    pushEvent,
    showToast,
  } = deps;

  const requestThreadRollback = async (threadIdValue: string, turns: number): Promise<boolean> => {
    const tid = String(threadIdValue ?? "").trim();
    if (!tid) return false;
    const serverId = getServerIdForThread(tid);
    if (!serverId) return false;
    const n = Number.isFinite(turns) ? Math.max(1, Math.round(turns)) : 1;
    try {
      await codexDesktop.codexServer.rpc({
        serverId,
        method: "thread/rollback",
        params: { threadId: tid, numTurns: n },
      });
      return true;
    } catch (e: unknown) {
      const msg = readErrorMessage(e);
      pushEvent("rollback:error", msg || "thread/rollback failed", { threadId: tid, level: "error" });
      showToast({ kind: "error", title: "撤回失败", message: "thread/rollback failed" });
      return false;
    }
  };

  const rollbackTurns = async () => {
    if (!runtimeStore.currentThreadId) {
      showToast({
        kind: "info",
        title: "无法撤回",
        message: "未选择会话。",
      });
      return;
    }
    const tid = String(runtimeStore.currentThreadId ?? "").trim();
    if (!tid) {
      showToast({
        kind: "info",
        title: "无法撤回",
        message: "未选择会话。",
      });
      return;
    }
    const workspace = normalizeWorkspacePath(getWorkspaceForThread(tid) || runtimeStore.workspacePath);
    const serverId = getServerIdForThread(tid);
    if (!workspace) {
      showToast({
        kind: "error",
        title: "无法撤回",
        message: "未选择工作区或工作区不可用。",
      });
      return;
    }
    if (!serverId) {
      showToast({
        kind: "error",
        title: "无法撤回",
        message: "未连接服务或服务不可用。",
      });
      return;
    }
    if (threadStore.runningThreadIds.has(tid)) {
      showToast({
        kind: "warn",
        title: "线程运行中",
        message: "请等待当前回合完成后再撤回。",
      });
      return;
    }
    const stack = threadStore.completedTurnsByThread.get(tid) ?? [];
    if (stack.length === 0) {
      showToast({
        kind: "info",
        title: "暂无可撤回回合",
        message: "当前会话还没有已完成回合。",
      });
      return;
    }
    let n: number | null = null;
    try {
      n = await promptNumberModalLazy({
        title: "撤回最近 N 轮",
        message: "撤回会回退线程上下文，并尝试回退这些回合产生的文件内容改动（不回退命令副作用）。",
        detail: `可撤回：1..${stack.length}`,
        confirmText: "撤回",
        cancelText: "取消",
        danger: true,
        defaultValue: 1,
        min: 1,
        max: stack.length,
      });
    } catch (e: unknown) {
      const msg = readErrorMessage(e);
      const isBusy = msg.includes("another modal is already open");
      showToast({
        kind: isBusy ? "warn" : "error",
        title: "无法打开撤回弹窗",
        message: isBusy ? "当前已有弹窗打开，请先关闭后再重试。" : "打开弹窗失败",
      });
      return;
    }
    if (n == null) return;

    const selected = stack.slice(-n);
    const selectedTurnIds = selected.map((entry) => entry.turnId);
    const diffParts = [...selected]
      .reverse()
      .map((entry) => entry.diffText)
      .filter((text) => String(text ?? "").trim().length > 0);
    const combinedDiff = diffParts.join("\n\n");

    if (combinedDiff.trim()) {
      const dry = await codexDesktop.workspace.dryRunApplyReverseDiff({ cwd: workspace, diffText: combinedDiff });
      if (!dry.ok) {
        pushEvent("rollback:error", `无法回退文件内容：${dry.error}`, {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: "撤回失败",
          message: "文件回退预检失败（工作区可能已手动修改）",
        });
        return;
      }
    }

    const resumed = await ensureThreadResumed(tid);
    if (!resumed) return;
    const ok = await requestThreadRollback(tid, n);
    if (!ok) return;

    if (combinedDiff.trim()) {
      const applied = await codexDesktop.workspace.applyReverseDiff({ cwd: workspace, diffText: combinedDiff });
      if (!applied.ok) {
        timelineStore.removeTurnEvents(tid, selectedTurnIds);
        threadStore.removeTurnsFromState(tid, selectedTurnIds);
        pushEvent("rollback:error", `上下文已撤回，但文件回退失败：${applied.error}`, {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: "部分失败",
          message: "上下文已撤回，但文件回退失败；请手动检查工作区。",
        });
        return;
      }
      pushEvent("rollback", `files reverted: ${(applied.files ?? []).join(", ")}`, { threadId: tid });
    } else {
      pushEvent("rollback", "no file diff in selected turns; context only", { threadId: tid });
    }

    timelineStore.removeTurnEvents(tid, selectedTurnIds);
    threadStore.removeTurnsFromState(tid, selectedTurnIds);
    showToast({
      kind: "success",
      title: "撤回完成",
      message: `已撤回最近 ${n} 轮`,
    });
  };

  return { requestThreadRollback, rollbackTurns };
}
