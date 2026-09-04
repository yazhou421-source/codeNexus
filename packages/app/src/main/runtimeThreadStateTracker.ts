import type { HistoryThread } from "./historyStore";
import {
  isCodexLocalEventMessage,
  isCodexServerNotificationMessage,
  type CodexLocalEvent,
  type CodexServerNotificationMessage,
} from "@codenexus/shared/codex-protocol";

type RunningThreadState = {
  serverId: string;
  turnId: string;
};

type RuntimeTrackedNotification = Extract<
  CodexServerNotificationMessage,
  { method: "turn/started" | "turn/completed" }
>;
type RuntimeTrackedLocalEvent = Extract<CodexLocalEvent, { method: "codex/exit" }>;
type RuntimeTrackedMessage = RuntimeTrackedNotification | RuntimeTrackedLocalEvent;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isRuntimeTrackedMessage(value: unknown): value is RuntimeTrackedMessage {
  if (isCodexLocalEventMessage(value)) return value.method === "codex/exit";
  if (isCodexServerNotificationMessage(value)) {
    return (value.method === "turn/started" || value.method === "turn/completed") && toRecord(value.params) != null;
  }
  return false;
}

type RuntimeTrackedThreadContext = {
  threadId: string;
  turnId: string;
};

function extractTrackedThreadContext(message: RuntimeTrackedNotification): RuntimeTrackedThreadContext | null {
  const params = toRecord(message.params);
  if (!params) return null;
  const threadId = normalizeText(params.threadId);
  if (!threadId) return null;
  const turn = toRecord(params.turn);
  return {
    threadId,
    turnId: normalizeText(turn?.id),
  };
}

export class RuntimeThreadStateTracker {
  private readonly runningByThread = new Map<string, RunningThreadState>();
  private readonly threadIdsByServer = new Map<string, Set<string>>();

  getThreadRunningState(threadIdValue: string): {
    threadId: string;
    running: boolean;
    activeTurnId: string | null;
    checkedAt: number;
  } {
    const threadId = normalizeText(threadIdValue);
    const state = threadId ? this.runningByThread.get(threadId) : undefined;
    return {
      threadId,
      running: Boolean(state),
      activeTurnId: state?.turnId || null,
      checkedAt: Date.now(),
    };
  }

  isServerBusy(serverIdValue: string): boolean {
    const serverId = normalizeText(serverIdValue);
    return Boolean(serverId && this.threadIdsByServer.get(serverId)?.size);
  }

  observeEvent(payload: { serverId: string; msg: unknown }) {
    const serverId = normalizeText(payload.serverId);
    if (!serverId || !isRuntimeTrackedMessage(payload.msg)) return;

    switch (payload.msg.method) {
      case "turn/started":
        this.handleTurnStarted(serverId, payload.msg);
        return;
      case "turn/completed":
        this.handleTurnCompleted(payload.msg);
        return;
      case "codex/exit":
        this.clearServer(serverId);
        return;
    }
  }

  clearThread(threadIdValue: string) {
    const threadId = normalizeText(threadIdValue);
    if (!threadId) return;
    this.markThreadStopped(threadId);
  }

  decorateHistoryItems(items: HistoryThread[]): HistoryThread[] {
    return items.map((item) => {
      const state = this.runningByThread.get(item.id);
      if (!state) return { ...item, running: false, activeTurnId: undefined };
      return {
        ...item,
        running: true,
        activeTurnId: state.turnId || undefined,
      };
    });
  }

  private handleTurnStarted(serverId: string, message: RuntimeTrackedNotification) {
    const context = extractTrackedThreadContext(message);
    if (!context) return;
    this.markThreadRunning(serverId, context.threadId, context.turnId);
  }

  private handleTurnCompleted(message: RuntimeTrackedNotification) {
    const context = extractTrackedThreadContext(message);
    if (!context) return;
    this.markThreadStopped(context.threadId);
  }

  private markThreadRunning(serverIdValue: string, threadIdValue: string, turnIdValue: string) {
    const serverId = normalizeText(serverIdValue);
    const threadId = normalizeText(threadIdValue);
    const turnId = normalizeText(turnIdValue);
    if (!serverId || !threadId) return;

    const prev = this.runningByThread.get(threadId);
    if (prev?.serverId && prev.serverId !== serverId) {
      this.detachThreadFromServer(prev.serverId, threadId);
    }

    this.runningByThread.set(threadId, { serverId, turnId });
    const set = this.threadIdsByServer.get(serverId) ?? new Set<string>();
    set.add(threadId);
    this.threadIdsByServer.set(serverId, set);
  }

  private markThreadStopped(threadIdValue: string) {
    const threadId = normalizeText(threadIdValue);
    if (!threadId) return;
    const prev = this.runningByThread.get(threadId);
    this.runningByThread.delete(threadId);
    if (!prev?.serverId) return;
    this.detachThreadFromServer(prev.serverId, threadId);
  }

  private detachThreadFromServer(serverIdValue: string, threadIdValue: string) {
    const serverId = normalizeText(serverIdValue);
    const threadId = normalizeText(threadIdValue);
    if (!serverId || !threadId) return;
    const set = this.threadIdsByServer.get(serverId);
    if (!set) return;
    set.delete(threadId);
    if (set.size === 0) this.threadIdsByServer.delete(serverId);
  }

  private clearServer(serverIdValue: string) {
    const serverId = normalizeText(serverIdValue);
    if (!serverId) return;
    const set = this.threadIdsByServer.get(serverId);
    if (!set) return;
    this.threadIdsByServer.delete(serverId);
    for (const threadId of set) {
      this.runningByThread.delete(threadId);
    }
  }
}
