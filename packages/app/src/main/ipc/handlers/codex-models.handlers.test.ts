import { describe, expect, it, vi } from "vitest";
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) },
}));
import { IPC_CODEX_CHANNELS } from "@codenexus/shared/ipc/channels";
import { registerCodexHandlers } from "./codex.handlers";
import { CodexServerManager } from "../../services/CodexServerManager";

describe("account model discovery IPC", () => {
  it("queries without starting or resolving a workspace server", async () => {
    const listAccountModels = vi.fn(async () => ({ data: [], nextCursor: null }));
    const createServer = vi.fn();
    registerCodexHandlers({
      serverManager: new CodexServerManager({ listAccountModels, createServer }),
      sendEvent: () => undefined,
    });
    expect(await handlers.get(IPC_CODEX_CHANNELS.codexListAccountModels)?.({})).toEqual({ data: [], nextCursor: null });
    expect(listAccountModels).toHaveBeenCalledOnce();
    expect(createServer).not.toHaveBeenCalled();
  });
  it("propagates discovery failure instead of returning an empty success", async () => {
    registerCodexHandlers({
      serverManager: new CodexServerManager({
        listAccountModels: async () => {
          throw new Error("temporary RPC failure");
        },
      }),
      sendEvent: () => undefined,
    });
    await expect(handlers.get(IPC_CODEX_CHANNELS.codexListAccountModels)?.({})).rejects.toThrow(
      "temporary RPC failure"
    );
  });
});
