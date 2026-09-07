import { describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  writeTextFile: vi.fn(),
  writeCodexAuthApiKey: vi.fn(),
  prepareDeepSeekProxy: vi.fn(),
}));
vi.mock("../../api/codexDesktopClient", () => ({ codexDesktop: { app: api } }));
import { createCodexProfileRuntime } from "./codexProfileRuntime";
describe("legacy profile persistence boundary", () => {
  it.each(["codenexus-router", "codenexus-router-codex"])(
    "P0-6 rejects imported %s before any auth or config mutation",
    async (modelProviderId) => {
      const requestConfigBatchWrite = vi.fn();
      const showToast = vi.fn();
      const runtime = createCodexProfileRuntime({
        appTimelineId: "__app__",
        codexProfilesStore: {
          loadState: "ready",
          profiles: [{ id: "legacy", modelProviderId, baseUrl: "http://127.0.0.1:15722/codex-auth/v1" }],
        },
        getWorkspacePath: () => "/tmp",
        getServerIdForWorkspace: () => "server",
        requestConfigBatchWrite,
        refreshGlobalConfig: vi.fn(),
        pushEvent: vi.fn(),
        translate: (key: string) => key,
        showToast,
      } as any);
      await expect(runtime.applyCodexProfile("legacy")).rejects.toThrow("process-scoped");
      expect(showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          message: "Router configuration is process-scoped. Use AI provider settings.",
        })
      );
      expect(requestConfigBatchWrite).not.toHaveBeenCalled();
      expect(api.writeTextFile).not.toHaveBeenCalled();
      expect(api.writeCodexAuthApiKey).not.toHaveBeenCalled();
    }
  );
});
