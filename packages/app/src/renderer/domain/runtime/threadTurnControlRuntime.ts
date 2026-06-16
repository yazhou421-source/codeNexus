import { codexDesktop } from "../../api/codexDesktopClient";

type RuntimeEventLevel = "info" | "warn" | "error";
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;

export type TurnInterruptOptions = {
  silentSuccess?: boolean;
};

export type ThreadTurnControlRuntimeDeps = {
  getCurrentThreadId: () => string;
  getActiveTurnId: (threadId: string) => string;
  getServerIdForThread: (threadId: string) => string;
  pushEvent: PushEvent;
};

export type ThreadTurnControlRuntime = {
  requestTurnInterrupt: (threadId: string, turnId: string, opts?: TurnInterruptOptions) => Promise<boolean>;
  interruptTurn: () => Promise<void>;
  compactThread: () => Promise<void>;
};

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createThreadTurnControlRuntime(deps: ThreadTurnControlRuntimeDeps): ThreadTurnControlRuntime {
  const { getCurrentThreadId, getActiveTurnId, getServerIdForThread, pushEvent } = deps;

  const requestTurnInterrupt = async (
    threadIdValue: string,
    turnIdValue: string,
    opts?: TurnInterruptOptions
  ): Promise<boolean> => {
    const threadId = String(threadIdValue ?? "").trim();
    const turnId = String(turnIdValue ?? "").trim();
    if (!threadId || !turnId) return false;
    const serverId = getServerIdForThread(threadId);
    if (!serverId) return false;
    try {
      await codexDesktop.codexServer.rpc({ serverId, method: "turn/interrupt", params: { threadId, turnId } });
      if (!opts?.silentSuccess) pushEvent("interrupt", "已请求停止当前回合", { threadId });
      return true;
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      pushEvent("interrupt:error", msg || "turn/interrupt failed", { threadId, level: "error" });
      return false;
    }
  };

  const interruptTurn = async () => {
    const threadId = getCurrentThreadId();
    if (!threadId) return;
    const turnId = getActiveTurnId(threadId);
    if (!turnId) {
      pushEvent("interrupt:error", "缺少 active turnId，无法执行 turn/interrupt", { threadId, level: "error" });
      return;
    }
    await requestTurnInterrupt(threadId, turnId);
  };

  const compactThread = async () => {
    const threadId = getCurrentThreadId();
    if (!threadId) return;
    const serverId = getServerIdForThread(threadId);
    if (!serverId) return;
    try {
      await codexDesktop.codexServer.rpc({
        serverId,
        method: "thread/compact/start",
        params: { threadId },
      });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      pushEvent("compact:error", msg, { threadId, level: "error" });
    }
  };

  return { requestTurnInterrupt, interruptTurn, compactThread };
}
