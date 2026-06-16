import { codexDesktop } from "../../api/codexDesktopClient";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useThreadStore } from "../../stores/thread.store";
import type { useTimelineStore } from "../../stores/timeline.store";
import { resolveHistoryRewriteRollback } from "../historyRewriteRollback";
import type { TimelineEventItem } from "../types";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ThreadStore = ReturnType<typeof useThreadStore>;
type TimelineStore = ReturnType<typeof useTimelineStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

type TurnInterruptRequest = (threadId: string, turnId: string, opts?: { silentSuccess?: boolean }) => Promise<boolean>;

export type HistoryRewriteRuntimeDeps = {
  runtimeStore: RuntimeStore;
  threadStore: ThreadStore;
  timelineStore: TimelineStore;
  normalizeWorkspacePath: (value: string) => string;
  getWorkspaceForThread: (threadId: string) => string;
  getServerIdForThread: (threadId: string) => string;
  ensureThreadResumed: (threadId: string) => Promise<boolean>;
  requestThreadRollback: (threadId: string, turns: number) => Promise<boolean>;
  requestTurnInterrupt: TurnInterruptRequest;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type HistoryRewriteRuntime = {
  rollbackHistoryRewriteBeforeSend: (
    threadId: string,
    opts?: { anchorTurnId?: string; force?: boolean }
  ) => Promise<boolean>;
};

async function confirmModalLazy(options: Parameters<(typeof import("../../ui/modal"))["confirmModal"]>[0]) {
  const { confirmModal } = await import("../../ui/modal");
  return confirmModal(options);
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHistoryRewriteRuntime(deps: HistoryRewriteRuntimeDeps): HistoryRewriteRuntime {
  const {
    runtimeStore,
    threadStore,
    timelineStore,
    normalizeWorkspacePath,
    getWorkspaceForThread,
    getServerIdForThread,
    ensureThreadResumed,
    requestThreadRollback,
    requestTurnInterrupt,
    pushEvent,
    showToast,
  } = deps;

  const resolveHistoryRewriteAnchorTurnId = (threadIdValue: string): string => {
    const directTurnId = String(runtimeStore.historyRewriteAnchorTurnId ?? "").trim();
    if (directTurnId) return directTurnId;

    const anchorEventId = String(runtimeStore.historyRewriteAnchorEventId ?? "").trim();
    if (!anchorEventId) return "";
    const anchorEvent = timelineStore
      .eventsForThread(threadIdValue)
      .find((event) => String(event?.id ?? "").trim() === anchorEventId);
    return String(anchorEvent?.turnId ?? "").trim();
  };

  const isHistoryRewriteAnchorUserEvent = (event: TimelineEventItem, anchorTurnId: string): boolean => {
    if (String(event?.turnId ?? "").trim() !== anchorTurnId) return false;
    return event.localKind === "user" || event.method === "user";
  };

  const isOutputAfterHistoryRewriteAnchor = (event: TimelineEventItem): boolean => {
    if (event.hidden) return false;
    if (event.localKind === "thinking" || event.method === "local/thinking") return false;
    if (
      event.method === "turn/started" ||
      event.method === "turn/completed" ||
      event.method === "turn/diff/updated" ||
      event.method === "thread/tokenUsage/updated" ||
      event.method === "local/contextCompaction"
    ) {
      return false;
    }
    return true;
  };

  const hasOutputBelowHistoryRewriteAnchor = (threadIdValue: string, anchorTurnIdValue: string): boolean | null => {
    const anchorTurnId = String(anchorTurnIdValue ?? "").trim();
    if (!anchorTurnId) return null;
    const events = timelineStore.eventsForThread(threadIdValue);
    const anchorIndex = events.findIndex((event) => isHistoryRewriteAnchorUserEvent(event, anchorTurnId));
    if (anchorIndex < 0) return null;
    return events.slice(anchorIndex + 1).some(isOutputAfterHistoryRewriteAnchor);
  };

  const waitForHistoryRewriteRunningTurnToStop = async (
    threadIdValue: string,
    anchorTurnIdValue: string
  ): Promise<"stopped" | "output" | "timeout"> => {
    const threadId = String(threadIdValue ?? "").trim();
    const anchorTurnId = String(anchorTurnIdValue ?? "").trim();
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (hasOutputBelowHistoryRewriteAnchor(threadId, anchorTurnId) === true) return "output";
      if (!threadStore.runningThreadIds.has(threadId)) return "stopped";
      const activeTurnId = String(threadStore.activeTurnIdByThread.get(threadId) ?? "").trim();
      if (activeTurnId && activeTurnId !== anchorTurnId) return "stopped";
      await sleep(100);
    }
    return threadStore.runningThreadIds.has(threadId) ? "timeout" : "stopped";
  };

  const rollbackHistoryRewriteBeforeSend = async (
    threadIdValue: string,
    opts?: { anchorTurnId?: string; force?: boolean }
  ): Promise<boolean> => {
    const forcedAnchorTurnId = String(opts?.anchorTurnId ?? "").trim();
    const forceRewrite = Boolean(opts?.force || forcedAnchorTurnId);
    if (!forceRewrite && (!runtimeStore.historyRewriteActive || runtimeStore.historyRewriteSource !== "history")) {
      return true;
    }

    const tid = String(threadIdValue ?? "").trim();
    if (!tid) {
      showToast({
        kind: "info",
        title: "无法重写历史",
        message: "未选择会话。",
      });
      return false;
    }

    const workspace = normalizeWorkspacePath(getWorkspaceForThread(tid) || runtimeStore.workspacePath);
    const serverId = getServerIdForThread(tid);
    if (!workspace) {
      showToast({
        kind: "error",
        title: "无法重写历史",
        message: "未选择工作区或工作区不可用。",
      });
      return false;
    }
    if (!serverId) {
      showToast({
        kind: "error",
        title: "无法重写历史",
        message: "未连接服务或服务不可用。",
      });
      return false;
    }

    const anchorTurnId = forcedAnchorTurnId || resolveHistoryRewriteAnchorTurnId(tid);
    let noVisibleOutputBelowAnchor = hasOutputBelowHistoryRewriteAnchor(tid, anchorTurnId) === false;
    if (threadStore.runningThreadIds.has(tid)) {
      const activeTurnId = String(threadStore.activeTurnIdByThread.get(tid) ?? "").trim();
      if (!noVisibleOutputBelowAnchor || !activeTurnId || activeTurnId !== anchorTurnId) {
        showToast({
          kind: "warn",
          title: "线程运行中",
          message: "请等待当前回合完成后再发送编辑后的消息。",
        });
        return false;
      }
      const interrupted = await requestTurnInterrupt(tid, anchorTurnId, { silentSuccess: true });
      if (!interrupted) {
        showToast({
          kind: "error",
          title: "重写失败",
          message: "停止当前回合失败，请稍后重试。",
        });
        return false;
      }
      const stopped = await waitForHistoryRewriteRunningTurnToStop(tid, anchorTurnId);
      if (stopped === "timeout") {
        showToast({
          kind: "warn",
          title: "重写等待超时",
          message: "当前回合仍在运行，请稍后重试。",
        });
        return false;
      }
      if (threadStore.runningThreadIds.has(tid)) {
        showToast({
          kind: "warn",
          title: "线程运行中",
          message: "当前回合仍在运行，请稍后重试。",
        });
        return false;
      }
      noVisibleOutputBelowAnchor = hasOutputBelowHistoryRewriteAnchor(tid, anchorTurnId) === false;
    }

    const rollback = resolveHistoryRewriteRollback(threadStore.completedTurnsByThread.get(tid) ?? [], anchorTurnId);
    if (!rollback) {
      if (noVisibleOutputBelowAnchor) {
        timelineStore.removeTurnEvents(tid, [anchorTurnId]);
        return true;
      }
      showToast({
        kind: "error",
        title: "无法重写历史",
        message: "找不到该消息对应的可撤回回合，请改用最新消息继续对话。",
      });
      return false;
    }

    if (!noVisibleOutputBelowAnchor) {
      let confirmed = false;
      try {
        confirmed = await confirmModalLazy({
          title: "发送编辑后的历史消息？",
          message: `会先撤回从该消息开始的 ${rollback.count} 个已完成回合，再发送编辑后的内容。`,
          detail: "撤回会回退线程上下文，并尝试回退这些回合产生的文件内容改动（不回退命令副作用）。",
          confirmText: "撤回并发送",
          cancelText: "取消",
          danger: true,
        });
      } catch (e: unknown) {
        const msg = readErrorMessage(e);
        const isBusy = msg.includes("another modal is already open");
        showToast({
          kind: isBusy ? "warn" : "error",
          title: "无法打开确认弹窗",
          message: isBusy ? "当前已有弹窗打开，请先关闭后再重试。" : "打开弹窗失败",
        });
        return false;
      }
      if (!confirmed) return false;
    }

    if (rollback.combinedDiff.trim()) {
      const dry = await codexDesktop.workspace.dryRunApplyReverseDiff({
        cwd: workspace,
        diffText: rollback.combinedDiff,
      });
      if (!dry.ok) {
        pushEvent("rollback:error", `无法回退文件内容：${dry.error}`, {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: "重写失败",
          message: "文件回退预检失败（工作区可能已手动修改）",
        });
        return false;
      }
    }

    const resumed = await ensureThreadResumed(tid);
    if (!resumed) return false;
    const ok = await requestThreadRollback(tid, rollback.count);
    if (!ok) return false;

    if (rollback.combinedDiff.trim()) {
      const applied = await codexDesktop.workspace.applyReverseDiff({
        cwd: workspace,
        diffText: rollback.combinedDiff,
      });
      if (!applied.ok) {
        timelineStore.removeTurnEvents(tid, rollback.turnIds);
        threadStore.removeTurnsFromState(tid, rollback.turnIds);
        runtimeStore.endHistoryRewrite();
        pushEvent("rollback:error", `上下文已撤回，但文件回退失败：${applied.error}`, {
          threadId: tid,
          level: "error",
        });
        showToast({
          kind: "error",
          title: "部分失败",
          message: "上下文已撤回，但文件回退失败；请手动检查工作区。",
        });
        return false;
      }
      if (!noVisibleOutputBelowAnchor) {
        pushEvent("rollback", `history rewrite files reverted: ${(applied.files ?? []).join(", ")}`, { threadId: tid });
      }
    } else {
      if (!noVisibleOutputBelowAnchor) {
        pushEvent("rollback", "history rewrite has no file diff; context only", { threadId: tid });
      }
    }

    timelineStore.removeTurnEvents(tid, rollback.turnIds);
    threadStore.removeTurnsFromState(tid, rollback.turnIds);
    if (!noVisibleOutputBelowAnchor) {
      showToast({
        kind: "success",
        title: "历史已回退",
        message: `已撤回 ${rollback.count} 个回合，正在发送编辑内容。`,
      });
    }
    return true;
  };

  return { rollbackHistoryRewriteBeforeSend };
}
