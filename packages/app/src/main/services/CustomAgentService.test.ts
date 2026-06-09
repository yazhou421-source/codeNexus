import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserLocalSettings } from "@codenexus/shared/localSettings";
import { DEFAULT_USER_LOCAL_SETTINGS } from "@codenexus/shared/localSettings";
import { CustomAgentService } from "./CustomAgentService";
import type { LocalSettingsService } from "./LocalSettingsService";

const agentCoreMocks = vi.hoisted(() => {
  const state = {
    runOptions: null as any,
  };
  return {
    state,
    runAgent: vi.fn(async (options: any) => {
      state.runOptions = options;
      return { finalText: "ok", messages: options.messages, steps: 1 };
    }),
    createChatCompletionsClient: vi.fn(() => ({ kind: "openai-compatible-client" })),
    createAnthropicClient: vi.fn(() => ({ kind: "anthropic-client" })),
    createGeminiClient: vi.fn(() => ({ kind: "gemini-client" })),
    createFileTools: vi.fn((_rootDir: string, _options: any) => [
      { name: "read_file", description: "", parameters: {}, execute: vi.fn(async () => "file") },
    ]),
    createCommandTools: vi.fn((_options: any) => [
      { name: "run_command", description: "", parameters: {}, execute: vi.fn(async () => "command") },
    ]),
    ProcessRegistry: vi.fn(function ProcessRegistryMock(this: { killAll: () => void }) {
      this.killAll = vi.fn();
    }),
  };
});

vi.mock("@codenexus/agent-core", () => ({
  runAgent: agentCoreMocks.runAgent,
  createChatCompletionsClient: agentCoreMocks.createChatCompletionsClient,
  createAnthropicClient: agentCoreMocks.createAnthropicClient,
  createGeminiClient: agentCoreMocks.createGeminiClient,
  createFileTools: agentCoreMocks.createFileTools,
  createCommandTools: agentCoreMocks.createCommandTools,
  ProcessRegistry: agentCoreMocks.ProcessRegistry,
}));

function buildSettings(workspaceRoot: string | null): UserLocalSettings {
  return {
    ...DEFAULT_USER_LOCAL_SETTINGS,
    customProviders: {
      activeProviderId: "provider-1",
      workspaceRoot,
      providers: [
        {
          id: "provider-1",
          kind: "openai-compatible",
          name: "Provider",
          baseUrl: "https://example.test/v1",
          apiKey: "sk-test",
          model: "model",
        },
      ],
    },
  };
}

function buildService(settings: UserLocalSettings): CustomAgentService {
  return new CustomAgentService({
    read: vi.fn(async () => ({ exists: true, settings })),
  } as unknown as LocalSettingsService);
}

async function runService(service: CustomAgentService) {
  return service.run({
    runId: "run-1",
    messages: [{ role: "user", content: "hello" }],
  });
}

describe("CustomAgentService tool routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    agentCoreMocks.state.runOptions = null;
  });

  it("uses the selected workspace as the file and command tool root", async () => {
    const service = buildService(buildSettings("D:\\repo"));

    await expect(runService(service)).resolves.toMatchObject({ ok: true, finalText: "ok" });

    expect(agentCoreMocks.createFileTools).toHaveBeenCalledWith("D:\\repo", expect.any(Object));
    expect(agentCoreMocks.createCommandTools).toHaveBeenCalledWith(expect.objectContaining({ cwd: "D:\\repo" }));
    expect(agentCoreMocks.state.runOptions?.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "read_file",
      "run_command",
    ]);
  });

  it("falls back to the system tool root when no workspace is selected", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("D:\\Desktop\\codex\\electron");
    const service = buildService(buildSettings(null));

    await expect(runService(service)).resolves.toMatchObject({ ok: true, finalText: "ok" });

    expect(agentCoreMocks.createFileTools).toHaveBeenCalledWith("D:\\Desktop\\codex\\electron", expect.any(Object));
    expect(agentCoreMocks.createCommandTools).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "D:\\Desktop\\codex\\electron" })
    );
    expect(agentCoreMocks.state.runOptions?.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "read_file",
      "run_command",
    ]);
  });

  it("rejects approval-gated tool actions when approval cannot round-trip", async () => {
    const service = buildService(buildSettings(null));

    await service.run({
      messages: [{ role: "user", content: "hello" }],
    });

    const fileOptions = agentCoreMocks.createFileTools.mock.calls[0]![1];
    const commandOptions = agentCoreMocks.createCommandTools.mock.calls[0]![0];
    await expect(fileOptions.requireApproval({ tool: "write_file", path: "./a.txt", preview: "body" })).resolves.toBe(
      false
    );
    await expect(commandOptions.requireConfirmation("node -v")).resolves.toBe(false);
  });
});
