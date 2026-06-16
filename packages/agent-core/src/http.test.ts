import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { postJson } from "./http";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  // 用假时钟把退避等待瞬时推进，避免测试真等几百毫秒。
  vi.useFakeTimers();
  // 固定 jitter，保证 retryDelay 可预测。
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 跑 postJson 并把假时钟推进到所有退避计时器结束。 */
async function runWithTimers<T>(promise: Promise<T>): Promise<T> {
  // 先吞掉可能的 reject，避免在推进定时器期间被报成 unhandled rejection；
  // 真正的断言仍由调用方对返回的同一个 promise 进行。
  promise.catch(() => {});
  await vi.runAllTimersAsync();
  return promise;
}

describe("postJson retry/backoff", () => {
  it("retries on 503 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, "busy"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await runWithTimers(
      postJson("https://x/v1", {
        headers: {},
        body: {},
        timeoutMs: 1000,
        errorLabel: "test",
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 up to maxRetries then throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, "slow down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runWithTimers(
        postJson("https://x/v1", {
          headers: {},
          body: {},
          timeoutMs: 1000,
          errorLabel: "test",
          maxRetries: 2,
        }),
      ),
    ).rejects.toThrow(/test failed \(429\)/);
    // 初次 + 2 次重试 = 3 次。
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry on a non-retryable 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, "bad request"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runWithTimers(
        postJson("https://x/v1", {
          headers: {},
          body: {},
          timeoutMs: 1000,
          errorLabel: "test",
        }),
      ),
    ).rejects.toThrow(/test failed \(400\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("respects Retry-After header (seconds)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, "busy", { "retry-after": "2" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await runWithTimers(
      postJson("https://x/v1", {
        headers: {},
        body: {},
        timeoutMs: 5000,
        errorLabel: "test",
      }),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("disables retry when maxRetries is 0", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, "busy"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runWithTimers(
        postJson("https://x/v1", {
          headers: {},
          body: {},
          timeoutMs: 1000,
          errorLabel: "test",
          maxRetries: 0,
        }),
      ),
    ).rejects.toThrow(/test failed \(503\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("postJson max_tokens rejection mapping", () => {
  it("wraps a max_tokens-over-limit 400 with actionable guidance", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, {
          error: { message: "max_tokens is too large: maximum is 8192" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runWithTimers(
        postJson("https://x/v1", {
          headers: {},
          body: {},
          timeoutMs: 1000,
          errorLabel: "anthropic messages",
        }),
      ),
    ).rejects.toThrow(/maxOutputTokens/);
  });

  it("leaves unrelated 400s with the generic message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(400, { error: { message: "invalid api key" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runWithTimers(
        postJson("https://x/v1", {
          headers: {},
          body: {},
          timeoutMs: 1000,
          errorLabel: "test",
        }),
      ),
    ).rejects.toThrow(/test failed \(400\): .*invalid api key/);
  });
});
