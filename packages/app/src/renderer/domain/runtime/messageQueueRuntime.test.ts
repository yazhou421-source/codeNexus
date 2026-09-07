import { describe, it, expect, vi } from "vitest";
import { createMessageQueueRuntime } from "./messageQueueRuntime";
function setup() {
  const message = { id: "msg", text: "run", inputs: [{ type: "text", text: "run" }], localEventId: "local" };
  const deps: any = {
    runtimeStore: {
      currentThreadId: "thread",
      model: "deepseek-v4-flash",
      workspacePath: "/one",
      composeStateByThreadId: { other: { model: "gpt-5.5" } },
      requestScrollTimelineToBottom: vi.fn(),
    },
    threadStore: { runningThreadIds: new Set(), hasLocalThread: () => false },
    timelineStore: { appendEvent: vi.fn(), patchEvent: vi.fn() },
    messageQueueStore: {
      peekNextQueued: () => message,
      setLocalEventId: vi.fn(),
      markStatus: vi.fn(),
      remove: vi.fn(),
    },
    normalizeWorkspacePath: (s: string) => s,
    getWorkspaceForThread: (id: string) => (id === "other" ? "/two" : "/one"),
    ensureServerForWorkspace: vi.fn(async () => "server"),
    ensureThreadResumed: vi.fn(async () => true),
    ensureThreadModelToolCompatibility: vi.fn(async ({ threadId }: any) => ({ ok: true, threadId })),
    startTurnWithInput: vi.fn(async () => ({ ok: true })),
    clearThreadPreparingEvent: vi.fn(),
    upsertThreadPreparingEvent: vi.fn(),
    buildTimelineUserMessagePayload: () => ({ displayText: "run", payload: {} }),
    translate: (s: string) => s,
  };
  return { deps, runtime: createMessageQueueRuntime(deps) };
}
describe("first-send queue serialization", () => {
  it("locks the queued message across the asynchronous old/new thread mapping boundary", async () => {
    const { deps, runtime } = setup();
    let release!: () => void;
    const boundary = new Promise<void>((done) => {
      release = done;
    });
    deps.ensureThreadModelToolCompatibility.mockImplementationOnce(async () => {
      // Reactive consumers can observe the moved queue before this await returns.
      void runtime.flushQueueForThread("replacement");
      await boundary;
      return { ok: true, threadId: "replacement" };
    });
    const task = runtime.flushQueueForThread("thread");
    await new Promise((done) => setTimeout(done, 0));
    release();
    await task;
    expect(deps.startTurnWithInput).toHaveBeenCalledTimes(1);
  });
  it("coalesces concurrent flushes instead of creating/executing duplicate threads", async () => {
    const { deps, runtime } = setup();
    await Promise.all([runtime.flushQueueForThread("thread"), runtime.flushQueueForThread("thread")]);
    expect(deps.startTurnWithInput).toHaveBeenCalledTimes(1);
    expect(deps.ensureThreadModelToolCompatibility).toHaveBeenCalledTimes(1);
  });
  it("uses the background thread model and workspace, not the active composer's model", async () => {
    const { deps, runtime } = setup();
    await runtime.flushQueueForThread("other");
    expect(deps.ensureThreadModelToolCompatibility).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.5", threadWorkspace: "/two" })
    );
    expect(deps.startTurnWithInput).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.5" }));
  });
});
