import { describe, it, expect, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../api/codexDesktopClient", () => ({ codexDesktop: { codexServer: { rpc } } }));
vi.mock("../../shared/debugLog", () => ({ appendDebugLog: vi.fn() }));
import { createThreadModelCompatibilityRuntime } from "./threadModelCompatibilityRuntime";
function setup(events: any[] = []) {
  rpc.mockReset().mockResolvedValue({ result: { thread: { id: "new" }, model: "deepseek-v4-flash" } });
  const deps: any = {
    runtimeStore: {
      currentThreadId: "old",
      sandboxMode: "workspace-write",
      moveThreadComposeState: vi.fn(),
      movePendingThreadInitSendCount: vi.fn(),
      setCurrentThread: vi.fn(),
    },
    threadStore: {
      localThreads: [{ id: "old", cwd: "/project", title: "draft" }],
      hasLocalThread: () => true,
      runningThreadIds: new Set(),
      replaceThreadId: vi.fn(),
      replaceLocalThreadId: vi.fn(),
      setCurrentThread: vi.fn(),
    },
    timelineStore: { eventsForThread: () => events, moveThread: vi.fn() },
    messageQueueStore: { moveThreadQueue: vi.fn() },
    resumedThreadIds: new Set(["old"]),
    resumePromisesByThread: new Map(),
    threadScopedCaches: [],
    normalizeWorkspacePath: (s: string) => s,
    buildThreadStartParamsForModel: ({ model, workspace }: any) => ({
      params: { model, cwd: workspace },
      configOverrides: { "features.image_generation": false },
    }),
    findThreadListItem: () => undefined,
    setThreadWorkspace: vi.fn(),
    clearThreadWorkspace: vi.fn(),
    pushEvent: vi.fn(),
    translate: (s: string) => s,
  };
  const runtime = createThreadModelCompatibilityRuntime(deps);
  runtime.rememberThreadStartConfigOverrides("old", { "features.image_generation": false }, "gpt-5.5");
  const args = { threadId: "old", threadWorkspace: "/project", threadServerId: "server", model: "deepseek-v4-flash" };
  return { runtime, deps, args };
}
describe("empty thread model selection", () => {
  it("replaces eager empty thread even with a queued local user event, without resume", async () => {
    const { runtime, deps, args } = setup([{ method: "user", localKind: "user", localState: "pending" }]);
    expect(await runtime.ensureThreadModelToolCompatibility(args)).toEqual({ ok: true, threadId: "new" });
    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({ method: "thread/start", params: { model: "deepseek-v4-flash", cwd: "/project" } })
    );
    expect(deps.timelineStore.moveThread).toHaveBeenCalledWith("old", "new");
    expect(deps.messageQueueStore.moveThreadQueue).toHaveBeenCalledWith("old", "new");
    expect(deps.runtimeStore.moveThreadComposeState).toHaveBeenCalledWith("old", "new");
    expect(deps.setThreadWorkspace).toHaveBeenCalledWith("new", "/project");
  });
  it("keeps a matching empty thread, and only materializes the final selection", async () => {
    const { runtime, args } = setup();
    expect(await runtime.ensureThreadModelToolCompatibility({ ...args, model: "gpt-5.5" })).toEqual({
      ok: true,
      threadId: "old",
    });
    await runtime.ensureThreadModelToolCompatibility(args);
    await runtime.ensureThreadModelToolCompatibility({ ...args, threadId: "new" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("keeps history-bearing thread for existing main rebind", async () => {
    const { runtime, args } = setup([{ method: "turn/completed" }]);
    expect(await runtime.ensureThreadModelToolCompatibility(args)).toEqual({ ok: true, threadId: "old" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not mutate old state or expose raw errors when candidate start fails", async () => {
    const { runtime, deps, args } = setup();
    rpc.mockRejectedValueOnce(new Error("localhost router private failure"));
    const result = await runtime.ensureThreadModelToolCompatibility(args);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/localhost|private/);
    expect(deps.timelineStore.moveThread).not.toHaveBeenCalled();
  });
  it("does not activate a background workspace after asynchronous replacement", async () => {
    const { runtime, deps, args } = setup();
    deps.runtimeStore.currentThreadId = "another";
    await runtime.ensureThreadModelToolCompatibility(args);
    expect(deps.runtimeStore.setCurrentThread).not.toHaveBeenCalled();
    expect(deps.threadStore.setCurrentThread).not.toHaveBeenCalled();
  });
});
