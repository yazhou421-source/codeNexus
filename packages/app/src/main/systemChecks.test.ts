import { beforeEach, describe, expect, it, vi } from "vitest";

const { electronApp, resolveCurrentCodexExecutable } = vi.hoisted(() => ({
  electronApp: { isPackaged: true },
  resolveCurrentCodexExecutable: vi.fn(),
}));

vi.mock("electron", () => ({ app: electronApp }));
vi.mock("./codexExecutableResolver", () => ({
  resolveCurrentCodexExecutable,
}));
vi.mock("./utils/logger", () => ({
  logger: { error: vi.fn() },
}));

import { detectCodexNative, getCodexDiagnostics } from "./systemChecks";

describe("Codex runtime diagnostics", () => {
  beforeEach(() => {
    electronApp.isPackaged = true;
    resolveCurrentCodexExecutable.mockReset();
  });

  it("treats Node.js and npm as unnecessary in a packaged app", async () => {
    resolveCurrentCodexExecutable.mockResolvedValue({
      path: "/Applications/CodeNexus.app/Contents/Resources/codex/mac-arm64/bin/codex",
      source: "bundled",
      version: "0.153.2",
      command: { kind: "direct", path: "/bundled/codex" },
    });

    await expect(getCodexDiagnostics()).resolves.toMatchObject({
      selfContained: true,
      codex: { ok: true, source: "bundled", version: "0.153.2" },
      node: { ok: true, required: false },
      npm: { ok: true, required: false },
    });
  });

  it("returns only the product-safe runtime error to diagnostics", async () => {
    resolveCurrentCodexExecutable.mockRejectedValue(
      new Error("内置 Codex 运行时不可用。请重新安装 Calmnova Code；如果问题仍然存在，请联系支持。")
    );
    await expect(detectCodexNative()).resolves.toEqual({
      ok: false,
      details: "内置 Codex 运行时不可用。请重新安装 Calmnova Code；如果问题仍然存在，请联系支持。",
    });
  });
});
