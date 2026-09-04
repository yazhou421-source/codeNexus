import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));

import { CodexAppServer, buildCodexAppServerSpawnCommand, redactCodexChildValue } from "./codexAppServer";
import type { CodexAppServerRuntimeConfig } from "./codexRouterRuntime";

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

  it("spawns app-server from a bundled executable path containing spaces", () => {
    const bundledPath = "/Applications/CodeNexus Preview.app/Contents/Resources/codex/mac-arm64/bin/codex";
    const result = buildCodexAppServerSpawnCommand({
      nativeCodex: { kind: "direct", path: bundledPath },
      globalConfigOverrides: ['model_provider="codenexus-router-codex"'],
    });
    expect(result.command).toBe(bundledPath);
    expect(result.args).toEqual([
      "-c",
      'model_provider="codenexus-router-codex"',
      "app-server",
      "--listen",
      "stdio://",
    ]);
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

  it("keeps a model catalog path with spaces intact in the Windows cmd fallback", () => {
    const result = buildCodexAppServerSpawnCommand({
      nativeCodex: { kind: "cmd", path: "C:\\Users\\Test User\\codex.cmd" },
      globalConfigOverrides: [
        "model_catalog_json='C:\\Users\\Test User\\AppData\\Roaming\\CodeNexus\\model-catalog.json'",
      ],
    });
    expect(result.command).toBe("cmd.exe");
    expect(result.args.at(-1)).toContain(
      "\"model_catalog_json='C:\\Users\\Test User\\AppData\\Roaming\\CodeNexus\\model-catalog.json'\""
    );
  });

  it("redacts secrets recursively before child output reaches renderer", () => {
    const secret = "synthetic-router-token";
    expect(redactCodexChildValue({ error: `Bearer ${secret}`, nested: [secret] }, [secret])).toEqual({
      error: "Bearer [REDACTED]",
      nested: ["[REDACTED]"],
    });
    expect(redactCodexChildValue(`not-json ${secret}`, [secret])).toBe("not-json [REDACTED]");
  });

  it("rebinds an existing thread before switching between Codex-auth and API-key models", async () => {
    const runtimeConfig: CodexAppServerRuntimeConfig = {
      globalConfigOverrides: [],
      childEnv: {},
      sensitiveValues: [],
      localTokenModelIds: new Set(["deepseek-v4-flash"]),
    };
    const server = new CodexAppServer({ id: "test", mode: "native", runtimeConfig });
    const requests: Array<{ id: number; method: string; params?: Record<string, unknown> }> = [];
    (server as any).proc = {
      stdin: {
        write(line: string) {
          const request = JSON.parse(line);
          requests.push(request);
          const modelProvider = String(request.params?.modelProvider ?? "");
          queueMicrotask(() =>
            (server as any).handleIncoming({
              id: request.id,
              result:
                request.method === "turn/start"
                  ? { turn: { id: "turn-1" } }
                  : {
                      thread: { id: request.params?.threadId ?? "thread-1" },
                      modelProvider,
                    },
            })
          );
          return true;
        },
      },
    };

    await server.request("thread/start", { model: "gpt-5.5" } as any);
    await server.request("turn/start", { threadId: "thread-1", model: "deepseek-v4-flash", input: [] } as any, 1_000);

    expect(requests.map(({ method }) => method)).toEqual(["thread/start", "thread/resume", "turn/start"]);
    expect(requests[1]?.params).toMatchObject({
      threadId: "thread-1",
      model: "deepseek-v4-flash",
      modelProvider: "codenexus-router",
    });
  });
});
