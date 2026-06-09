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
    createWorkspaceTools: vi.fn((_rootDir: string, _options: any) => [
      { name: "search_files", description: "", parameters: {}, execute: vi.fn(async () => "files") },
      { name: "grep", description: "", parameters: {}, execute: vi.fn(async () => "grep") },
      { name: "read_file_range", description: "", parameters: {}, execute: vi.fn(async () => "range") },
      { name: "read_file", description: "", parameters: {}, execute: vi.fn(async () => "file") },
      { name: "write_file", description: "", parameters: {}, execute: vi.fn(async () => "written") },
      { name: "edit_file", description: "", parameters: {}, execute: vi.fn(async () => "edited") },
      { name: "git_status", description: "", parameters: {}, execute: vi.fn(async () => "status") },
      { name: "git_diff", description: "", parameters: {}, execute: vi.fn(async () => "diff") },
      { name: "git_show", description: "", parameters: {}, execute: vi.fn(async () => "show") },
      { name: "apply_patch", description: "", parameters: {}, execute: vi.fn(async () => "patch") },
      { name: "delete_file", description: "", parameters: {}, execute: vi.fn(async () => "delete") },
      { name: "move_file", description: "", parameters: {}, execute: vi.fn(async () => "move") },
      { name: "mkdir", description: "", parameters: {}, execute: vi.fn(async () => "mkdir") },
      { name: "web_search", description: "", parameters: {}, execute: vi.fn(async () => "search") },
      { name: "web_fetch", description: "", parameters: {}, execute: vi.fn(async () => "fetch") },
    ]),
    createCommandTools: vi.fn((_options: any) => [
      { name: "run_command", description: "", parameters: {}, execute: vi.fn(async () => "command") },
    ]),
  };
});

vi.mock("@codenexus/agent-core", () => ({
  runAgent: agentCoreMocks.runAgent,
  createChatCompletionsClient: agentCoreMocks.createChatCompletionsClient,
  createAnthropicClient: agentCoreMocks.createAnthropicClient,
  createGeminiClient: agentCoreMocks.createGeminiClient,
  createWorkspaceTools: agentCoreMocks.createWorkspaceTools,
  createCommandTools: agentCoreMocks.createCommandTools,
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

    expect(agentCoreMocks.createWorkspaceTools).toHaveBeenCalledWith("D:\\repo", expect.any(Object));
    expect(agentCoreMocks.createCommandTools).toHaveBeenCalledWith(expect.objectContaining({ cwd: "D:\\repo" }));
    expect(agentCoreMocks.state.runOptions?.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "search_files",
      "grep",
      "read_file_range",
      "read_file",
      "write_file",
      "edit_file",
      "git_status",
      "git_diff",
      "git_show",
      "apply_patch",
      "delete_file",
      "move_file",
      "mkdir",
      "web_search",
      "web_fetch",
      "run_command",
    ]);
  });

  it("falls back to the system tool root when no workspace is selected", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("D:\\Desktop\\codex\\electron");
    const service = buildService(buildSettings(null));

    await expect(runService(service)).resolves.toMatchObject({ ok: true, finalText: "ok" });

    expect(agentCoreMocks.createWorkspaceTools).toHaveBeenCalledWith("D:\\Desktop\\codex\\electron", expect.any(Object));
    expect(agentCoreMocks.createCommandTools).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "D:\\Desktop\\codex\\electron" })
    );
    expect(agentCoreMocks.state.runOptions?.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "search_files",
      "grep",
      "read_file_range",
      "read_file",
      "write_file",
      "edit_file",
      "git_status",
      "git_diff",
      "git_show",
      "apply_patch",
      "delete_file",
      "move_file",
      "mkdir",
      "web_search",
      "web_fetch",
      "run_command",
    ]);
  });

  it("can run multiple turns on the same service instance", async () => {
    const service = buildService(buildSettings("D:\\repo"));

    await expect(
      service.run({
        runId: "run-1",
        messages: [{ role: "user", content: "first" }],
      })
    ).resolves.toMatchObject({ ok: true, finalText: "ok" });
    await expect(
      service.run({
        runId: "run-2",
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "second" },
        ],
      })
    ).resolves.toMatchObject({ ok: true, finalText: "ok" });

    expect(agentCoreMocks.runAgent).toHaveBeenCalledTimes(2);
    expect(
      agentCoreMocks.runAgent.mock.calls[1]?.[0].messages.map((message: { content: string | null }) => message.content)
    ).toEqual(["first", "ok", "second"]);
  });

  it("rejects approval-gated tool actions when approval cannot round-trip", async () => {
    const service = buildService(buildSettings(null));

    await service.run({
      messages: [{ role: "user", content: "hello" }],
    });

    const workspaceOptions = agentCoreMocks.createWorkspaceTools.mock.calls[0]![1];
    const commandOptions = agentCoreMocks.createCommandTools.mock.calls[0]![0];
    await expect(workspaceOptions.requireApproval({ tool: "apply_patch", details: "file.txt" })).resolves.toBe(false);
    await expect(commandOptions.requireConfirmation("node -v")).resolves.toBe(false);
  });
});
