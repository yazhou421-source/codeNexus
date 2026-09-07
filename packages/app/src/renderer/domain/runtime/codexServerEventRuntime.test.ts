import { describe, it, expect, vi, afterEach } from "vitest";
const bus = vi.hoisted(() => ({ listener: null as any }));
vi.mock("../../api/codexDesktopClient", () => ({
  codexDesktop: {
    codexServer: {
      onEvent: (fn: any) => {
        bus.listener = fn;
        return () => {
          bus.listener = null;
        };
      },
    },
  },
}));
import { createCodexServerEventRuntime } from "./codexServerEventRuntime";
afterEach(() => vi.useRealTimers());
describe("Agent filesystem refresh event wiring", () => {
  it.each(["command-success", "command-failed", "patch", "turn-completed", "turn-interrupted", "turn-failed", "diff"])(
    "refreshes the emitting workspace after %s",
    (kind) => {
      vi.useFakeTimers();
      const refresh = vi.fn();
      const deps: any = {
        getWorkspaceForServerId: () => "/background",
        workspaceFilesStore: { scheduleWorkspaceRefresh: refresh },
        hydrateThreadHandoffDiagnostics: vi.fn(),
        notifyCompletedTurnIfBackground: vi.fn(),
        threadStore: { runningThreadIds: new Set() },
        flushQueueForThread: vi.fn(),
      };
      const stop = createCodexServerEventRuntime(deps).subscribeCodexServerEvents();
      const msg =
        kind === "diff"
          ? { method: "turn/diff/updated", params: { threadId: "t", turnId: "v", diff: "" } }
          : kind.startsWith("turn-")
            ? { method: "turn/completed", params: { threadId: "t", turn: { id: "v", status: kind.slice(5) } } }
            : {
                method: "item/completed",
                params: {
                  threadId: "t",
                  turnId: "v",
                  item: {
                    type: kind === "patch" ? "fileChange" : "commandExecution",
                    status: kind === "command-failed" ? "failed" : "completed",
                  },
                },
              };
      bus.listener({ serverId: "server", msg: { ...msg, kind: "notification" } });
      expect(refresh).toHaveBeenCalledWith("/background");
      stop();
      expect(bus.listener).toBeNull();
    }
  );
  it("does not refresh on streaming deltas or unknown servers", () => {
    const refresh = vi.fn();
    createCodexServerEventRuntime({
      getWorkspaceForServerId: () => undefined,
      workspaceFilesStore: { scheduleWorkspaceRefresh: refresh },
    } as any).subscribeCodexServerEvents();
    bus.listener({ serverId: "unknown", msg: { method: "item/commandExecution/outputDelta", params: { delta: "x" } } });
    expect(refresh).not.toHaveBeenCalled();
  });
});
