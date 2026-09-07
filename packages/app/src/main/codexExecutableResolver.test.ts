import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "/app",
  },
}));

import {
  CodexRuntimeUnavailableError,
  codexCommandInvocation,
  resolveCodexExecutable,
  type CodexExecutableResolverDependencies,
  type CodexExecutableResolverOptions,
  type NativeCodexCommand,
} from "./codexExecutableResolver";

const manifest = JSON.stringify({
  schemaVersion: 1,
  version: "0.153.2",
  releaseTag: "rust-v0.153.2",
  platforms: {
    "mac-arm64": {
      target: "aarch64-apple-darwin",
      entrypoint: "bin/codex",
      files: [
        { path: "bin/codex", executable: true },
        { path: "bin/codex-code-mode-host", executable: true },
        { path: "codex-package.json", executable: false },
        { path: "codex-path/rg", executable: true },
        { path: "codex-resources/zsh/bin/zsh", executable: true },
      ],
    },
    "win-x64": {
      target: "x86_64-pc-windows-msvc",
      entrypoint: "bin/codex.exe",
      files: [
        { path: "bin/codex.exe", executable: true },
        { path: "bin/codex-code-mode-host.exe", executable: true },
        { path: "codex-package.json", executable: false },
        { path: "codex-path/rg.exe", executable: true },
        { path: "codex-resources/codex-command-runner.exe", executable: true },
        { path: "codex-resources/codex-windows-sandbox-setup.exe", executable: true },
      ],
    },
  },
});

function descriptor(target: string, entrypoint: string) {
  return JSON.stringify({
    layoutVersion: 1,
    version: "0.153.2",
    target,
    variant: "codex",
    entrypoint,
    resourcesDir: "codex-resources",
    pathDir: "codex-path",
  });
}

function options(overrides: Partial<CodexExecutableResolverOptions> = {}): CodexExecutableResolverOptions {
  return {
    isPackaged: true,
    platform: "darwin",
    arch: "arm64",
    resourcesPath: "/Applications/CodeNexus App.app/Contents/Resources",
    appPath: "/workspace/packages/app",
    ...overrides,
  };
}

function dependencies(overrides: Partial<CodexExecutableResolverDependencies> = {}) {
  const probe = vi.fn(async (_command: NativeCodexCommand, args: string[]) =>
    args[0] === "--version"
      ? { stdout: "codex-cli 0.153.2\n", stderr: "" }
      : { stdout: "Usage: codex app-server [OPTIONS]", stderr: "" }
  );
  const deps: CodexExecutableResolverDependencies = {
    readText: vi.fn(async (path: string) =>
      path.endsWith("codex-runtime-manifest.json")
        ? manifest
        : descriptor(
            path.includes("win-x64") ? "x86_64-pc-windows-msvc" : "aarch64-apple-darwin",
            path.includes("win-x64") ? "bin/codex.exe" : "bin/codex"
          )
    ),
    stat: vi.fn(async () => ({ isFile: () => true, mode: 0o100755 })),
    accessExecutable: vi.fn(async () => undefined),
    probe,
    discoverSystem: vi.fn(() => null),
    ...overrides,
  };
  return deps;
}

describe("Codex executable resolver", () => {
  it("uses the bundled runtime in a packaged app and self-checks it once", async () => {
    const deps = dependencies();
    const result = await resolveCodexExecutable(options(), deps);

    expect(result).toMatchObject({
      source: "bundled",
      version: "0.153.2",
      path: "/Applications/CodeNexus App.app/Contents/Resources/codex/mac-arm64/bin/codex",
    });
    expect(deps.discoverSystem).not.toHaveBeenCalled();
    expect(deps.probe).toHaveBeenNthCalledWith(1, result.command, ["--version"]);
    expect(deps.probe).toHaveBeenNthCalledWith(2, result.command, ["app-server", "--help"]);
  });

  it("never falls back to PATH when the packaged runtime is missing", async () => {
    const deps = dependencies({
      readText: vi.fn(async () => {
        throw new Error("ENOENT");
      }),
    });
    await expect(resolveCodexExecutable(options(), deps)).rejects.toMatchObject({
      code: "bundled_runtime_invalid",
    });
    expect(deps.discoverSystem).not.toHaveBeenCalled();
  });

  it("rejects a packaged runtime when a required helper is missing", async () => {
    const deps = dependencies({
      stat: vi.fn(async (path: string) => {
        if (path.endsWith("codex-code-mode-host")) throw new Error("ENOENT");
        return { isFile: () => true, mode: 0o100755 };
      }),
    });
    await expect(resolveCodexExecutable(options(), deps)).rejects.toMatchObject({
      code: "bundled_runtime_invalid",
      technicalDetail: "ENOENT",
    });
    expect(deps.discoverSystem).not.toHaveBeenCalled();
  });

  it("uses an explicit absolute development executable before every fallback", async () => {
    const deps = dependencies({
      discoverSystem: vi.fn((): NativeCodexCommand => ({ kind: "direct", path: "/path/codex" })),
    });
    const result = await resolveCodexExecutable(
      options({ isPackaged: false, explicitDevExecutable: "/custom path/codex" }),
      deps
    );
    expect(result).toMatchObject({ source: "explicit-dev", path: "/custom path/codex" });
    expect(deps.readText).not.toHaveBeenCalled();
    expect(deps.discoverSystem).not.toHaveBeenCalled();
  });

  it("rejects a relative explicit development executable", async () => {
    await expect(
      resolveCodexExecutable(options({ isPackaged: false, explicitDevExecutable: "./codex" }), dependencies())
    ).rejects.toMatchObject({ code: "explicit_dev_path_not_absolute" });
  });

  it("prefers a prepared development runtime over PATH", async () => {
    const deps = dependencies({
      discoverSystem: vi.fn((): NativeCodexCommand => ({ kind: "direct", path: "/path/codex" })),
    });
    const result = await resolveCodexExecutable(options({ isPackaged: false }), deps);
    expect(result).toMatchObject({
      source: "bundled",
      path: "/workspace/packages/app/build/codex-runtime/mac-arm64/bin/codex",
    });
    expect(deps.discoverSystem).not.toHaveBeenCalled();
  });

  it("falls back to PATH only in development", async () => {
    const system: NativeCodexCommand = { kind: "direct", path: "/usr/local/bin/codex" };
    const deps = dependencies({
      readText: vi.fn(async () => {
        throw new Error("not prepared");
      }),
      discoverSystem: vi.fn(() => system),
    });
    const result = await resolveCodexExecutable(options({ isPackaged: false }), deps);
    expect(result).toMatchObject({ source: "system-dev", path: system.path });
  });

  it("fails cleanly on an unsupported packaged platform", async () => {
    const deps = dependencies({
      discoverSystem: vi.fn((): NativeCodexCommand => ({ kind: "direct", path: "/path/codex" })),
    });
    await expect(resolveCodexExecutable(options({ platform: "linux", arch: "x64" }), deps)).rejects.toMatchObject({
      code: "unsupported_platform",
    });
    expect(deps.discoverSystem).not.toHaveBeenCalled();
  });

  it("rejects a mismatched manifest version", async () => {
    const broken = manifest.replace('"releaseTag":"rust-v0.153.2"', '"releaseTag":"rust-v0.153.1"');
    const deps = dependencies({
      readText: vi.fn(async (path: string) =>
        path.endsWith("codex-runtime-manifest.json") ? broken : descriptor("aarch64-apple-darwin", "bin/codex")
      ),
    });
    await expect(resolveCodexExecutable(options(), deps)).rejects.toBeInstanceOf(CodexRuntimeUnavailableError);
    await expect(resolveCodexExecutable(options(), deps)).rejects.toMatchObject({ code: "bundled_runtime_invalid" });
  });

  it("rejects an unexpected bundled version and malformed version output", async () => {
    const mismatched = dependencies({
      probe: vi.fn(async () => ({ stdout: "codex-cli 0.153.1", stderr: "" })),
    });
    await expect(resolveCodexExecutable(options(), mismatched)).rejects.toMatchObject({
      code: "bundled_runtime_invalid",
      technicalDetail: expect.stringContaining("version mismatch"),
    });

    const malformed = dependencies({
      probe: vi.fn(async () => ({ stdout: "unknown tool", stderr: "" })),
    });
    await expect(resolveCodexExecutable(options(), malformed)).rejects.toMatchObject({
      technicalDetail: expect.stringContaining("unrecognized result"),
    });
  });

  it("requires the app-server subcommand to pass its help probe", async () => {
    const deps = dependencies({
      probe: vi.fn(async (_command, args) =>
        args[0] === "--version" ? { stdout: "codex-cli 0.153.2", stderr: "" } : { stdout: "Usage: codex", stderr: "" }
      ),
    });
    await expect(resolveCodexExecutable(options(), deps)).rejects.toMatchObject({
      technicalDetail: expect.stringContaining("expected command"),
    });
  });

  it("checks executable permission on macOS but not Windows", async () => {
    const macDeps = dependencies();
    await resolveCodexExecutable(options(), macDeps);
    expect(macDeps.accessExecutable).toHaveBeenCalled();

    const winDeps = dependencies();
    const result = await resolveCodexExecutable(
      options({ platform: "win32", arch: "x64", resourcesPath: "C:\\Program Files\\CodeNexus\\resources" }),
      winDeps
    );
    expect(result.path).toBe("C:\\Program Files\\CodeNexus\\resources\\codex\\win-x64\\bin\\codex.exe");
    expect(winDeps.accessExecutable).not.toHaveBeenCalled();
  });

  it("quotes Windows cmd paths and arguments containing spaces", () => {
    const invocation = codexCommandInvocation({ kind: "cmd", path: "C:\\Users\\Test User\\codex.cmd" }, [
      "-c",
      "model_catalog_json='C:\\Test Data\\model-catalog.json'",
      "app-server",
    ]);
    expect(invocation).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '""C:\\Users\\Test User\\codex.cmd" -c "model_catalog_json=\'C:\\Test Data\\model-catalog.json\'" app-server"',
      ],
      windowsVerbatimArguments: true,
    });
  });
});
