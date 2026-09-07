import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

import { CodexAppServer } from "./codexAppServer";
import { createCodexRouterRuntime } from "./codexRouterRuntime";

function harness(options: { active?: boolean; stuck?: boolean; wrongAfterReload?: boolean } = {}) {
  const runtimeConfig = createCodexRouterRuntime({
    origin: "http://127.0.0.1:15722",
    authToken: "synthetic-local-token",
    routes: [
      { modelId: "gpt-5.5", authMode: "codex_openai" },
      ...["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-r1", "kimi-k2-7-code", "gpt-labelled-api-model"].map(
        (modelId) => ({ modelId, authMode: "api_key" as const })
      ),
    ],
  });
  const server = new CodexAppServer({ id: "switch", mode: "native", runtimeConfig });
  let loaded = false;
  let provider = "";
  let unloading = false;

  const requests: Array<{ method: string; params: Record<string, any> }> = [];
  const turns: Array<{ model: string; provider: string }> = [];
  (server as any).proc = {
    stdin: {
      write(line: string) {
        const request = JSON.parse(line);
        requests.push(request);
        const { method, params } = request;
        let result: unknown;
        if (["thread/start", "thread/resume"].includes(method)) {
          // Real 0.153.2 rejoins loaded threads, ignoring modelProvider overrides.
          if (!loaded || unloading)
            provider = options.wrongAfterReload && unloading ? "codenexus-router-codex" : params.modelProvider;
          loaded = true;
          unloading = false;
          result = {
            thread: { id: "thread-1", status: { type: options.active ? "active" : "idle" } },
            modelProvider: provider,
          };
        } else if (method === "thread/unsubscribe") {
          unloading = true;
          if (options.stuck) {
            queueMicrotask(() =>
              (server as any).handleIncoming({ id: request.id, error: { code: -32603, message: "unsubscribe failed" } })
            );
            return true;
          }
          result = { status: "unsubscribed" };
        } else if (method === "turn/start") {
          turns.push({ model: params.model, provider });
          result = { turn: { id: `turn-${turns.length}`, status: "completed" } };
        }
        queueMicrotask(() => (server as any).handleIncoming({ id: request.id, result }));
        return true;
      },
    },
  };
  const start = (model = "gpt-5.5") => server.request("thread/start", { model });
  const turn = (model: string, timeoutMs = 1_000) =>
    server.request("turn/start", { threadId: "thread-1", model, input: [] } as any, timeoutMs);
  return { start, turn, requests, turns };
}

describe("model Provider switching against loaded app-server threads", () => {
  it("keeps GPT on Codex-auth without unloading a same-provider thread", async () => {
    const h = harness();
    await h.start();
    await h.turn("gpt-5.5");
    expect(h.turns).toEqual([{ model: "gpt-5.5", provider: "codenexus-router-codex" }]);
    expect(h.requests.some((r) => r.method === "thread/unsubscribe")).toBe(false);
  });

  it.each(["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-r1", "kimi-k2-7-code", "gpt-labelled-api-model"])(
    "routes %s by registered auth metadata through the API-key provider",
    async (model) => {
      const h = harness();
      await h.start();
      await h.turn(model);
      expect(h.turns).toEqual([{ model, provider: "codenexus-router" }]);
      expect(h.requests.map((r) => r.method)).toEqual([
        "thread/start",
        "thread/resume",
        "thread/unsubscribe",
        "thread/resume",
        "turn/start",
      ]);
    }
  );

  it("switches GPT → DeepSeek → GPT on the same persisted thread", async () => {
    const h = harness();
    await h.start();
    await h.turn("gpt-5.5");
    await h.turn("deepseek-v4-flash");
    await h.turn("gpt-5.5");
    expect(h.turns.map((t) => t.provider)).toEqual([
      "codenexus-router-codex",
      "codenexus-router",
      "codenexus-router-codex",
    ]);
    expect(h.requests.filter((r) => r.method === "thread/start")).toHaveLength(1);
  });

  it("does not interrupt an active thread to change its provider", async () => {
    const h = harness({ active: true });
    await h.start();
    await expect(h.turn("deepseek-v4-flash")).rejects.toThrow(/active turn/i);
    expect(h.turns).toEqual([]);
    expect(h.requests.some((r) => r.method === "thread/unsubscribe")).toBe(false);
  });

  it("does not send through the old provider if unsubscribing fails", async () => {
    const h = harness({ stuck: true });
    await h.start();
    await expect(h.turn("deepseek-v4-flash", 120)).rejects.toThrow(/unsubscribe/i);
    expect(h.turns).toEqual([]);
  });

  it("checks the actual provider after reloading before sending", async () => {
    const h = harness({ wrongAfterReload: true });
    await h.start();
    await expect(h.turn("deepseek-v4-flash")).rejects.toThrow(/provider/i);
    expect(h.requests.filter((r) => r.method === "thread/unsubscribe")).toHaveLength(3);
    expect(h.turns).toEqual([]);
  });
});
