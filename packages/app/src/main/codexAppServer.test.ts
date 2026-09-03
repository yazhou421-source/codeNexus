import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

import { buildCodexAppServerSpawnCommand, redactCodexChildValue } from "./codexAppServer";

describe("Codex app-server spawn configuration", () => {
  it("puts every global -c before the app-server subcommand", () => {
    const result = buildCodexAppServerSpawnCommand({
      nativeCodex: { kind: "direct", path: "/opt/codex" },
      cwd: "/workspace",
      globalConfigOverrides: ['model_provider="openai"', 'openai_base_url="http://127.0.0.1:15722/v1"'],
    });
    expect(result).toEqual({
      command: "/opt/codex",
      args: [
        "-c",
        'model_provider="openai"',
        "-c",
        'openai_base_url="http://127.0.0.1:15722/v1"',
        "app-server",
        "--listen",
        "stdio://",
      ],
      spawnCwd: "/workspace",
    });
  });

  it("keeps the token out of direct, node, and cmd argv", () => {
    const overrides = ['model_provider="openai"'];
    const commands = [
      buildCodexAppServerSpawnCommand({
        nativeCodex: { kind: "direct", path: "codex" },
        globalConfigOverrides: overrides,
      }),
      buildCodexAppServerSpawnCommand({
        nativeCodex: { kind: "node", nodeExe: "node", script: "codex.js" },
        globalConfigOverrides: overrides,
      }),
      buildCodexAppServerSpawnCommand({
        nativeCodex: { kind: "cmd", path: "codex.cmd" },
        globalConfigOverrides: overrides,
      }),
    ];
    expect(JSON.stringify(commands)).not.toContain("synthetic-router-token");
  });

  it("redacts secrets recursively before child output reaches renderer", () => {
    const secret = "synthetic-router-token";
    expect(redactCodexChildValue({ error: `Bearer ${secret}`, nested: [secret] }, [secret])).toEqual({
      error: "Bearer [REDACTED]",
      nested: ["[REDACTED]"],
    });
    expect(redactCodexChildValue(`not-json ${secret}`, [secret])).toBe("not-json [REDACTED]");
  });
});
