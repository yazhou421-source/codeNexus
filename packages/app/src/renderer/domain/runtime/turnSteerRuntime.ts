import { codexDesktop } from "../../api/codexDesktopClient";
import type { UserTurnInput } from "../types";
import type { TurnSteerParams } from "@codenexus/generated/codex-app-server/v2/TurnSteerParams";

type RuntimeEventLevel = "info" | "warn" | "error";
type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;

export type TurnSteerRuntimeDeps = {
  getServerIdForThread: (threadId: string) => string;
  toCodexUserInputs: (input: UserTurnInput[]) => TurnSteerParams["input"];
  pushEvent: PushEvent;
};

export type TurnSteerRuntime = {
  requestTurnSteer: (threadId: string, input: UserTurnInput[], turnId: string) => Promise<boolean>;
};

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

export function createTurnSteerRuntime(deps: TurnSteerRuntimeDeps): TurnSteerRuntime {
  const { getServerIdForThread, toCodexUserInputs, pushEvent } = deps;

  const requestTurnSteer = async (threadId: string, input: UserTurnInput[], turnIdValue: string) => {
    const serverId = getServerIdForThread(threadId);
    if (!serverId) return false;
    if (!turnIdValue) {
      pushEvent("steer:error", "缺少 active turnId，无法执行 turn/steer", { threadId, level: "error" });
      return false;
    }
    const params = {
      threadId,
      expectedTurnId: turnIdValue,
      input: toCodexUserInputs(input),
    };
    try {
      await codexDesktop.codexServer.rpc({ serverId, method: "turn/steer", params });
      return true;
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      pushEvent("steer:error", msg || "turn/steer failed", { threadId, level: "error" });
      return false;
    }
  };

  return { requestTurnSteer };
}
