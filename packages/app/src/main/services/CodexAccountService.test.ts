import { describe, expect, it, vi } from "vitest";
import type { CodexIncomingMessage } from "@codenexus/shared/codex-protocol";
import type { CodexServerManager } from "./CodexServerManager";
import { CodexAccountService } from "./CodexAccountService";

function fixture(results: unknown[]) {
  let onMessage: ((payload: { serverId: string; msg: CodexIncomingMessage }) => void) | null = null;
  const manager = {
    start: vi.fn(async (args) => {
      onMessage = args.onMessage;
      return { serverId: "account-server", capabilities: { experimentalApi: true } };
    }),
    request: vi.fn(async () => {
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as CodexServerManager;
  const service = new CodexAccountService(manager, "/app-user-data");
  return {
    manager,
    service,
    emit: (msg: CodexIncomingMessage) => onMessage?.({ serverId: "account-server", msg }),
  };
}

describe("CodexAccountService", () => {
  it("returns only the safe ChatGPT account DTO", async () => {
    const { service } = fixture([
      {
        account: { type: "chatgpt", email: "user@example.com", planType: "plus", accessToken: "must-not-leak" },
        requiresOpenaiAuth: true,
        auth: { token: "must-not-leak" },
      },
    ]);
    const result = await service.read();
    expect(result).toEqual({
      state: "logged_in",
      email: "user@example.com",
      planType: "plus",
      requiresOpenaiAuth: true,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("reports non-ChatGPT accounts as logged out", async () => {
    const { service } = fixture([{ account: null, requiresOpenaiAuth: true }]);
    await expect(service.read()).resolves.toMatchObject({ state: "logged_out", email: null, planType: null });
  });

  it("starts, completes, re-reads, and cancels login without persisting loginId", async () => {
    const { service, manager, emit } = fixture([
      { type: "chatgpt", loginId: "transient-login", authUrl: "https://auth.openai.com/start" },
      { account: { type: "chatgpt", email: null, planType: "free" }, requiresOpenaiAuth: true },
      { type: "chatgpt", loginId: "cancel-me", authUrl: "https://auth.openai.com/retry" },
      {},
    ]);
    const completed = vi.fn();
    service.onLoginCompleted(completed);

    await expect(service.startChatGptLogin()).resolves.toEqual({ authUrl: "https://auth.openai.com/start" });
    emit({ method: "account/login/completed", params: { loginId: "transient-login", success: true } } as any);
    expect(completed).toHaveBeenCalledWith({ success: true });
    await expect(service.read()).resolves.toMatchObject({ state: "logged_in" });

    await service.startChatGptLogin();
    await expect(service.cancelLogin()).resolves.toEqual({ ok: true });
    expect((manager.request as any).mock.calls.at(-1)?.[0]).toMatchObject({
      method: "account/login/cancel",
      params: { loginId: "cancel-me" },
    });
  });

  it("rejects unsafe auth URLs and exposes only a product error", async () => {
    const { service } = fixture([{ type: "chatgpt", loginId: "id", authUrl: "file:///tmp/auth" }]);
    await expect(service.startChatGptLogin()).rejects.toMatchObject({ code: "login_start_failed" });
  });

  it("emits a redacted failure result", async () => {
    const { service, emit } = fixture([{ type: "chatgpt", loginId: "id", authUrl: "https://auth.openai.com/start" }]);
    const completed = vi.fn();
    service.onLoginCompleted(completed);
    await service.startChatGptLogin();
    emit({
      method: "account/login/completed",
      params: { loginId: "id", success: false, error: "token=must-not-leak" },
    } as any);
    expect(completed).toHaveBeenCalledWith({ success: false });
    expect(JSON.stringify(completed.mock.calls)).not.toContain("must-not-leak");
  });

  it("replaces account RPC errors with product-safe errors", async () => {
    const { service } = fixture([
      new Error("token=must-not-cross-ipc"),
      new Error("Authorization: must-not-cross-ipc"),
    ]);
    await expect(service.read()).rejects.toMatchObject({ code: "agent_unavailable" });
    await expect(service.startChatGptLogin()).rejects.toMatchObject({ code: "login_start_failed" });
  });
});
