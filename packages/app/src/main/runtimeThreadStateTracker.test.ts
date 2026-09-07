import { describe, expect, it } from "vitest";
import { RuntimeThreadStateTracker } from "./runtimeThreadStateTracker";

function turnMessage(method: "turn/started" | "turn/completed", threadId: string, turnId: string) {
  return {
    kind: "notification",
    method,
    params: { threadId, turn: { id: turnId, status: method === "turn/started" ? "inProgress" : "completed" } },
  } as any;
}

describe("RuntimeThreadStateTracker server activity", () => {
  it("marks a server busy only while one of its turns is active", () => {
    const tracker = new RuntimeThreadStateTracker();

    tracker.observeEvent({ serverId: "server-a", msg: turnMessage("turn/started", "thread-a", "turn-a") });
    expect(tracker.isServerBusy("server-a")).toBe(true);

    tracker.observeEvent({ serverId: "server-a", msg: turnMessage("turn/completed", "thread-a", "turn-a") });
    expect(tracker.isServerBusy("server-a")).toBe(false);
  });

  it("isolates server activity and clears it when that app-server exits", () => {
    const tracker = new RuntimeThreadStateTracker();
    tracker.observeEvent({ serverId: "server-a", msg: turnMessage("turn/started", "thread-a", "turn-a") });
    tracker.observeEvent({ serverId: "server-b", msg: turnMessage("turn/started", "thread-b", "turn-b") });

    tracker.observeEvent({
      serverId: "server-a",
      msg: { kind: "local", method: "codex/exit", params: { code: 0, signal: null, expected: true } },
    });

    expect(tracker.isServerBusy("server-a")).toBe(false);
    expect(tracker.isServerBusy("server-b")).toBe(true);
  });
});
