import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCodexRouterModelProvider,
  codexRouterModelProviderForModel,
  CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID,
  CODEX_ROUTER_PROVIDER_ID,
  CODEX_ROUTER_TOKEN_ENV,
  createCodexRouterRuntime,
} from "./codexRouterRuntime";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function ownedConnection() {
  return {
    origin: "http://127.0.0.1:15722",
    authToken: "synthetic-router-token",
    routes: [
      { modelId: "gpt-5.5", authMode: "codex_openai" as const },
      { modelId: "gpt-5.4-mini", authMode: "api_key" as const },
    ],
  };
}

describe("Codex Router process-scoped runtime", () => {
  it("uses Router mode only for an owned connection", () => {
    expect(createCodexRouterRuntime(ownedConnection())).not.toBeNull();
    expect(createCodexRouterRuntime(null)).toBeNull();
  });

  it("keeps the local Router token only in child env and sensitive values", () => {
    const runtime = createCodexRouterRuntime(ownedConnection())!;
    expect(runtime.childEnv).toEqual({
      [CODEX_ROUTER_TOKEN_ENV]: "synthetic-router-token",
    });
    expect(runtime.sensitiveValues).toEqual(["synthetic-router-token"]);
  });

  it("never places the Router token in config argv", () => {
    const runtime = createCodexRouterRuntime(ownedConnection())!;
    expect(runtime.globalConfigOverrides.join(" ")).not.toContain("synthetic-router-token");
  });

  it("overrides only provider and endpoint fields", () => {
    const runtime = createCodexRouterRuntime(ownedConnection())!;
    expect(runtime.globalConfigOverrides).toEqual([
      "model_provider='codenexus-router-codex'",
      "openai_base_url='http://127.0.0.1:15722/codex-auth/v1'",
      "model_providers.codenexus-router-codex.name='CodeNexusRouterCodexAuth'",
      "model_providers.codenexus-router-codex.base_url='http://127.0.0.1:15722/codex-auth/v1'",
      "model_providers.codenexus-router-codex.wire_api='responses'",
      "model_providers.codenexus-router-codex.requires_openai_auth=true",
      "model_providers.codenexus-router.name='CodeNexusRouter'",
      "model_providers.codenexus-router.base_url='http://127.0.0.1:15722/v1'",
      "model_providers.codenexus-router.wire_api='responses'",
      "model_providers.codenexus-router.env_key='CODENEXUS_ROUTER_TOKEN'",
      "model_providers.codenexus-router.requires_openai_auth=false",
    ]);
    expect(runtime.globalConfigOverrides.every((override) => !/\s/.test(override))).toBe(true);
  });

  it("does not override user MCP, sandbox, approvals, history, skills, or CODEX_HOME", () => {
    const runtime = createCodexRouterRuntime(ownedConnection())!;
    const text = runtime.globalConfigOverrides.join("\n");
    for (const key of [
      "mcp_servers",
      "sandbox_mode",
      "approval_policy",
      "history",
      "skills",
      "CODEX_HOME",
      "model_catalog_json",
    ]) {
      expect(text).not.toContain(key);
      expect(runtime.childEnv).not.toHaveProperty(key);
    }
  });

  it("adds an app-private model catalog only when one is provided", () => {
    const runtime = createCodexRouterRuntime(ownedConnection(), {
      modelCatalogPath: "/Users/Test User/Library/Application Support/CodeNexus/model-catalog.json",
    })!;
    expect(runtime.globalConfigOverrides).toContain(
      "model_catalog_json='/Users/Test User/Library/Application Support/CodeNexus/model-catalog.json'"
    );
    expect(runtime.childEnv).toEqual({ CODENEXUS_ROUTER_TOKEN: "synthetic-router-token" });
  });

  it("does not write or alter a user config file", () => {
    const directory = mkdtempSync(join(tmpdir(), "codenexus-runtime-config-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "config.toml");
    const original = '[mcp_servers.example]\ncommand = "example"\nsandbox_mode = "workspace-write"\n';
    writeFileSync(configPath, original);
    createCodexRouterRuntime(ownedConnection());
    expect(readFileSync(configPath, "utf8")).toBe(original);
  });

  it("uses the dedicated provider for an API-key route", () => {
    const params = applyCodexRouterModelProvider(
      "thread/start",
      { model: "gpt-5.4-mini", cwd: "/workspace" },
      createCodexRouterRuntime(ownedConnection())
    );
    expect(params).toMatchObject({ modelProvider: CODEX_ROUTER_PROVIDER_ID });
  });

  it("uses the Codex-auth Router provider for a subscription route", () => {
    const params = applyCodexRouterModelProvider(
      "thread/resume",
      { threadId: "thread", model: "gpt-5.5" },
      createCodexRouterRuntime(ownedConnection())
    );
    expect(params).toMatchObject({ modelProvider: CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID });
  });

  it("resolves the provider required by a turn model", () => {
    const runtime = createCodexRouterRuntime(ownedConnection());
    expect(codexRouterModelProviderForModel("gpt-5.4-mini", runtime)).toBe(CODEX_ROUTER_PROVIDER_ID);
    expect(codexRouterModelProviderForModel("gpt-5.5", runtime)).toBe(CODEX_ROUTER_CODEX_AUTH_PROVIDER_ID);
    expect(codexRouterModelProviderForModel("", runtime)).toBeNull();
  });

  it("leaves requests unchanged without an owned Router", () => {
    const params = { model: "gpt-5.4-mini" };
    expect(applyCodexRouterModelProvider("thread/start", params, null)).toBe(params);
  });

  it("leaves resume requests without an explicit model unchanged", () => {
    const params = { threadId: "existing-thread" };
    expect(applyCodexRouterModelProvider("thread/resume", params, createCodexRouterRuntime(ownedConnection()))).toBe(
      params
    );
  });

  it("gives multiple workspace launches the same singleton credentials", () => {
    const connection = ownedConnection();
    const first = createCodexRouterRuntime(connection)!;
    const second = createCodexRouterRuntime(connection)!;
    expect(first.childEnv).toEqual(second.childEnv);
    expect(first.globalConfigOverrides).toEqual(second.globalConfigOverrides);
  });
});
