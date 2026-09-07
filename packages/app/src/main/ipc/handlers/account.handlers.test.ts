import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  openExternal: vi.fn(async () => undefined),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) =>
      electronMocks.handlers.set(channel, handler)
    ),
  },
  shell: { openExternal: electronMocks.openExternal },
}));

import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import type { CodexAccountService } from "../../services/CodexAccountService";
import { registerAccountHandlers } from "./account.handlers";

describe("account IPC handlers", () => {
  beforeEach(() => {
    electronMocks.handlers.clear();
    electronMocks.openExternal.mockClear();
  });

  it("opens the auth URL in the system browser and returns no URL or loginId", async () => {
    const listeners: Array<(payload: { success: boolean }) => void> = [];
    const service = {
      read: vi.fn(async () => ({ state: "logged_out", email: null, planType: null, requiresOpenaiAuth: true })),
      startChatGptLogin: vi.fn(async () => ({
        authUrl: "https://auth.openai.com/start",
        loginId: "must-not-cross-ipc",
      })),
      cancelLogin: vi.fn(async () => ({ ok: true as const })),
      onLoginCompleted: vi.fn((value) => {
        listeners.push(value);
        return () => undefined;
      }),
    } as unknown as CodexAccountService;
    const sendLoginCompleted = vi.fn();
    registerAccountHandlers({ accountService: service, sendLoginCompleted });

    const result = await electronMocks.handlers.get(IPC_APP_CHANNELS.appAccountLoginStart)?.({});
    expect(result).toEqual({ ok: true });
    expect(electronMocks.openExternal).toHaveBeenCalledWith("https://auth.openai.com/start");
    expect(JSON.stringify(result)).not.toContain("must-not-cross-ipc");

    listeners[0]?.({ success: true });
    expect(sendLoginCompleted).toHaveBeenCalledWith({ success: true });
  });

  it("cancels the Codex login when opening the browser fails", async () => {
    electronMocks.openExternal.mockRejectedValueOnce(new Error("synthetic browser failure"));
    const service = {
      startChatGptLogin: vi.fn(async () => ({ authUrl: "https://auth.openai.com/start" })),
      cancelLogin: vi.fn(async () => ({ ok: true as const })),
      onLoginCompleted: vi.fn(() => () => undefined),
    } as unknown as CodexAccountService;
    registerAccountHandlers({ accountService: service, sendLoginCompleted: () => undefined });

    await expect(electronMocks.handlers.get(IPC_APP_CHANNELS.appAccountLoginStart)?.({})).rejects.toMatchObject({
      code: "browser_open_failed",
    });
    expect(service.cancelLogin).toHaveBeenCalledOnce();
  });
});
