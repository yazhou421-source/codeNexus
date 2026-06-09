import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { CustomAgentStreamEvent, CustomSession } from "@codenexus/shared/ipc/contracts";

type AgentRunArgs = {
  runId?: string;
  providerId?: string;
  messages: Array<{ role: string; content: string }>;
};

async function loadStoreWithAgent(
  agent: {
    run?: (
      args: AgentRunArgs
    ) => Promise<{ ok: true; finalText: string; steps: number } | { ok: false; error: string }>;
    onEvent?: (cb: (event: CustomAgentStreamEvent) => void) => () => void;
    approve?: (...args: unknown[]) => Promise<{ ok: boolean }>;
    listSessions?: () => Promise<{ items: CustomSession[] }>;
    getSession?: (args: { id: string }) => Promise<{ item: CustomSession | null }>;
    createSession?: (args?: Partial<CustomSession>) => Promise<{ item: CustomSession; items: CustomSession[] }>;
    upsertSession?: (args: { session: CustomSession }) => Promise<{ item: CustomSession; items: CustomSession[] }>;
    deleteSession?: (args: { id: string }) => Promise<{ deleted: boolean; items: CustomSession[] }>;
  } = {}
) {
  vi.resetModules();
  const sessions: CustomSession[] = [];
  let sessionSeq = 0;
  const listSessions = agent.listSessions ?? vi.fn(async () => ({ items: sessions }));
  const getSession =
    agent.getSession ??
    vi.fn(async ({ id }: { id: string }) => ({ item: sessions.find((session) => session.id === id) ?? null }));
  const createSession =
    agent.createSession ??
    vi.fn(async (args?: Partial<CustomSession>) => {
      sessionSeq += 1;
      const now = Date.now();
      const item: CustomSession = {
        id: `session-${sessionSeq}`,
        title: args?.title ?? "新会话",
        createdAt: now,
        updatedAt: now,
        providerId: args?.providerId ?? null,
        providerLabel: args?.providerLabel ?? null,
        workspaceRoot: args?.workspaceRoot ?? null,
        messages: args?.messages ?? [],
      };
      sessions.unshift(item);
      return { item, items: sessions };
    });
  const upsertSession =
    agent.upsertSession ??
    vi.fn(async ({ session }: { session: CustomSession }) => {
      const idx = sessions.findIndex((item) => item.id === session.id);
      if (idx >= 0) sessions.splice(idx, 1);
      sessions.unshift(session);
      return { item: session, items: sessions };
    });
  const deleteSession =
    agent.deleteSession ??
    vi.fn(async ({ id }: { id: string }) => {
      const before = sessions.length;
      const next = sessions.filter((session) => session.id !== id);
      sessions.splice(0, sessions.length, ...next);
      return { deleted: next.length !== before, items: sessions };
    });
  vi.stubGlobal("window", {
    codexDesktop: {
      agent: {
        run: agent.run ?? vi.fn(async () => ({ ok: true, finalText: "", steps: 1 })),
        onEvent: agent.onEvent ?? vi.fn(() => () => undefined),
        approve: agent.approve ?? vi.fn(async () => ({ ok: true })),
        listSessions,
        getSession,
        createSession,
        upsertSession,
        deleteSession,
      },
    },
  });
  setActivePinia(createPinia());
  const mod = await import("./customChat.store");
  return mod.useCustomChatStore();
}

describe("customChat.store ordered parts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps delta, tool call, result and later delta in arrival order", async () => {
    const store = await loadStoreWithAgent();
    store.messages.push({ id: "assistant-1", role: "assistant", content: "", runId: "run-1", streaming: true });

    store.applyDelta("run-1", "Before ");
    store.startTool("run-1", "tool-1", "read_file", '{"path":"a.txt"}');
    store.finishTool("run-1", "tool-1", "done", { resultText: "file body" });
    store.applyDelta("run-1", "After");

    const message = store.messages[0];
    expect(message.content).toBe("Before After");
    expect(message.parts?.map((part) => part.type)).toEqual(["text", "tool", "text"]);
    expect(message.parts?.[0]).toMatchObject({ type: "text", text: "Before " });
    expect(message.parts?.[1]).toMatchObject({
      type: "tool",
      tool: { callId: "tool-1", name: "read_file", status: "done", resultText: "file body" },
    });
    expect(message.parts?.[2]).toMatchObject({ type: "text", text: "After" });
  });

  it("updates parallel tool results without changing original call order", async () => {
    const store = await loadStoreWithAgent();
    store.messages.push({ id: "assistant-1", role: "assistant", content: "", runId: "run-1", streaming: true });

    store.startTool("run-1", "tool-a", "read_file", '{"path":"a.txt"}');
    store.startTool("run-1", "tool-b", "list_dir", '{"path":"."}');
    store.finishTool("run-1", "tool-b", "done", { resultText: "entries" });
    store.finishTool("run-1", "tool-a", "done", { resultText: "body" });

    const tools = store.messages[0].parts?.filter((part) => part.type === "tool").map((part) => part.tool);
    expect(tools?.map((tool) => tool.callId)).toEqual(["tool-a", "tool-b"]);
    expect(tools?.map((tool) => tool.resultText)).toEqual(["body", "entries"]);
  });

  it("keeps a tool error in place", async () => {
    const store = await loadStoreWithAgent();
    store.messages.push({ id: "assistant-1", role: "assistant", content: "", runId: "run-1", streaming: true });

    store.applyDelta("run-1", "Checking ");
    store.startTool("run-1", "tool-1", "run_command", '{"command":"bad"}');
    store.finishTool("run-1", "tool-1", "error", { error: "failed" });
    store.applyDelta("run-1", "Done");

    expect(store.messages[0].parts?.map((part) => part.type)).toEqual(["text", "tool", "text"]);
    expect(store.messages[0].parts?.[1]).toMatchObject({
      type: "tool",
      tool: { callId: "tool-1", status: "error", error: "failed" },
    });
  });

  it("does not let finalText overwrite already streamed parts", async () => {
    let listener: ((event: CustomAgentStreamEvent) => void) | null = null;
    const store = await loadStoreWithAgent({
      onEvent: (cb) => {
        listener = cb;
        return () => undefined;
      },
      run: async (args) => {
        listener?.({ type: "delta", runId: args.runId ?? "", text: "Before " });
        listener?.({ type: "tool_call", runId: args.runId ?? "", callId: "tool-1", name: "read_file", argsText: "{}" });
        listener?.({
          type: "tool_result",
          runId: args.runId ?? "",
          callId: "tool-1",
          name: "read_file",
          resultText: "ok",
        });
        listener?.({ type: "delta", runId: args.runId ?? "", text: "After" });
        return { ok: true, finalText: "Final replacement text", steps: 1 };
      },
    });

    await store.send("inspect", { providerId: "provider-1" });

    const assistant = store.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("Before After");
    expect(assistant?.parts?.map((part) => part.type)).toEqual(["text", "tool", "text"]);
    expect(assistant?.parts?.some((part) => part.type === "text" && part.text === "Final replacement text")).toBe(
      false
    );
  });

  it("uses finalText as a fallback when no text streamed", async () => {
    const store = await loadStoreWithAgent({
      run: async () => ({ ok: true, finalText: "Non-streamed answer", steps: 1 }),
    });

    await store.send("answer");

    const assistant = store.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("Non-streamed answer");
    expect(assistant?.parts).toEqual([expect.objectContaining({ type: "text", text: "Non-streamed answer" })]);
  });
});

describe("customChat.store sessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("creates a new empty session and switches to it", async () => {
    const store = await loadStoreWithAgent();

    await store.newSession({ providerId: "provider-1", providerLabel: "Provider · Model" });

    expect(store.currentSessionId).toBe("session-1");
    expect(store.messages).toEqual([]);
    expect(store.sessions[0]).toMatchObject({
      id: "session-1",
      providerId: "provider-1",
      providerLabel: "Provider · Model",
    });
  });

  it("persists user and assistant parts after sending", async () => {
    let listener: ((event: CustomAgentStreamEvent) => void) | null = null;
    const upsertSession = vi.fn(async ({ session }: { session: CustomSession }) => ({
      item: session,
      items: [session],
    }));
    const store = await loadStoreWithAgent({
      onEvent: (cb) => {
        listener = cb;
        return () => undefined;
      },
      upsertSession,
      run: async (args) => {
        listener?.({ type: "delta", runId: args.runId ?? "", text: "Looked " });
        listener?.({ type: "tool_call", runId: args.runId ?? "", callId: "tool-1", name: "read_file", argsText: "{}" });
        listener?.({
          type: "tool_result",
          runId: args.runId ?? "",
          callId: "tool-1",
          name: "read_file",
          resultText: "ok",
        });
        listener?.({ type: "delta", runId: args.runId ?? "", text: "done" });
        return { ok: true, finalText: "ignored", steps: 1 };
      },
    });

    await store.send("inspect", { providerId: "provider-1" });

    const saved = upsertSession.mock.calls.at(-1)?.[0].session;
    expect(saved?.title).toBe("inspect");
    expect(saved?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(saved?.messages[1].parts?.map((part) => part.type)).toEqual(["text", "tool", "text"]);
  });

  it("loads a historical session and restores messages", async () => {
    const historical: CustomSession = {
      id: "history-1",
      title: "旧会话",
      createdAt: 1,
      updatedAt: 2,
      providerId: "provider-1",
      providerLabel: "Provider",
      workspaceRoot: "D:\\repo",
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: 1 }],
    };
    const store = await loadStoreWithAgent({
      getSession: vi.fn(async () => ({ item: historical })),
    });

    await store.loadSession("history-1");

    expect(store.currentSessionId).toBe("history-1");
    expect(store.messages).toEqual([expect.objectContaining({ id: "m1", content: "hello" })]);
  });

  it("deletes the current session and falls back to the most recent remaining session", async () => {
    const remaining: CustomSession = {
      id: "session-2",
      title: "剩余会话",
      createdAt: 1,
      updatedAt: 3,
      providerId: null,
      providerLabel: null,
      workspaceRoot: null,
      messages: [{ id: "m2", role: "user", content: "still here", createdAt: 1 }],
    };
    const store = await loadStoreWithAgent({
      deleteSession: vi.fn(async () => ({ deleted: true, items: [remaining] })),
    });
    store.currentSessionId = "session-1";
    store.messages = [{ id: "m1", role: "user", content: "delete me" }];

    await store.deleteSession("session-1");

    expect(store.currentSessionId).toBe("session-2");
    expect(store.messages).toEqual([expect.objectContaining({ id: "m2", content: "still here" })]);
  });

  it("ignores stream events whose run belongs to a different session", async () => {
    let listener: ((event: CustomAgentStreamEvent) => void) | null = null;
    let store: Awaited<ReturnType<typeof loadStoreWithAgent>>;
    store = await loadStoreWithAgent({
      onEvent: (cb) => {
        listener = cb;
        return () => undefined;
      },
      run: async (args) => {
        store.currentSessionId = "other-session";
        listener?.({ type: "delta", runId: args.runId ?? "", text: "wrong session" });
        return { ok: true, finalText: "fallback", steps: 1 };
      },
    });

    await store.send("hello", { providerId: "provider-1" });

    const assistant = store.messages.find((message) => message.role === "assistant");
    expect(assistant?.content).toBe("fallback");
    expect(assistant?.parts).toEqual([expect.objectContaining({ type: "text", text: "fallback" })]);
  });
});
