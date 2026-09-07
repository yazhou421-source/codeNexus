import { execFile, spawnSync } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import { discoverExistingCodexPaths } from "./codexNativeDiscovery";

const execFileAsync = promisify(execFile);
const SELF_CHECK_TIMEOUT_MS = 15_000;

export type NativeCodexCommand =
  | { kind: "direct"; path: string }
  | { kind: "node"; nodeExe: string; script: string }
  | { kind: "cmd"; path: string };

export type CodexExecutableSource = "bundled" | "explicit-dev" | "system-dev";

export type CodexExecutableResolution = {
  path: string;
  source: CodexExecutableSource;
  version: string;
  command: NativeCodexCommand;
  runtimeRoot?: string;
};

type RuntimeFileStats = { isFile(): boolean; mode: number };
type ProbeResult = { stdout: string; stderr: string };

export type CodexExecutableResolverDependencies = {
  readText(path: string): Promise<string>;
  stat(path: string): Promise<RuntimeFileStats>;
  accessExecutable(path: string): Promise<void>;
  probe(command: NativeCodexCommand, args: string[]): Promise<ProbeResult>;
  discoverSystem(platform: NodeJS.Platform): NativeCodexCommand | null;
};

export type CodexExecutableResolverOptions = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  arch: string;
  resourcesPath: string;
  appPath: string;
  explicitDevExecutable?: string;
};

type RuntimeManifest = {
  schemaVersion?: unknown;
  version?: unknown;
  releaseTag?: unknown;
  platforms?: Record<string, RuntimePlatformDefinition>;
};

type RuntimePlatformDefinition = {
  target?: unknown;
  entrypoint?: unknown;
  files?: unknown;
};

type RuntimeFileDefinition = {
  path?: unknown;
  executable?: unknown;
};

type CodexPackageDescriptor = {
  layoutVersion?: unknown;
  version?: unknown;
  target?: unknown;
  variant?: unknown;
  entrypoint?: unknown;
  resourcesDir?: unknown;
  pathDir?: unknown;
};

export class CodexRuntimeUnavailableError extends Error {
  readonly code: string;
  readonly technicalDetail: string;

  constructor(code: string, technicalDetail: string, isPackaged: boolean) {
    super(
      isPackaged
        ? "内置 Codex 运行时不可用。请重新安装 Calmnova Code；如果问题仍然存在，请联系支持。"
        : "Codex 开发运行时不可用。请准备已校验的 bundled runtime，或配置开发专用 Codex executable。"
    );
    this.name = "CodexRuntimeUnavailableError";
    this.code = code;
    this.technicalDetail = technicalDetail;
  }
}

function runtimeKey(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "darwin" && arch === "arm64") return "mac-arm64";
  if (platform === "win32" && arch === "x64") return "win-x64";
  return null;
}

function expectedTarget(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "darwin" && arch === "arm64") return "aarch64-apple-darwin";
  if (platform === "win32" && arch === "x64") return "x86_64-pc-windows-msvc";
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeRelativeRuntimePath(value: unknown): string {
  const path = text(value).replaceAll("\\", "/");
  const segments = path.split("/");
  if (!path || path.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`runtime path is unsafe or missing: ${path || "<empty>"}`);
  }
  return path;
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${label} is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isAbsoluteForPlatform(path: string, platform: NodeJS.Platform): boolean {
  return platformPath(platform).isAbsolute(path);
}

function platformPath(platform: NodeJS.Platform) {
  return platform === "win32" ? win32 : posix;
}

async function assertExecutableFile(
  path: string,
  platform: NodeJS.Platform,
  deps: CodexExecutableResolverDependencies
): Promise<void> {
  const metadata = await deps.stat(path);
  if (!metadata.isFile()) throw new Error(`not a regular file: ${path}`);
  if (platform !== "win32") await deps.accessExecutable(path);
}

function quoteWindowsCmdArgument(value: string): string {
  if (!/[\s&|<>^()]/.test(value)) return value;
  if (value.includes('"') || value.includes("%") || value.includes("!")) {
    throw new Error("unsupported character in Windows Codex command argument");
  }
  return `"${value}"`;
}

export function codexCommandInvocation(command: NativeCodexCommand, args: string[]) {
  if (command.kind === "cmd") {
    const joined = args.map(quoteWindowsCmdArgument).join(" ");
    const cmdline = `""${command.path}"${joined ? " " : ""}${joined}"`;
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", cmdline],
      windowsVerbatimArguments: true,
    };
  }
  if (command.kind === "node") {
    return { command: command.nodeExe, args: [command.script, ...args], windowsVerbatimArguments: false };
  }
  return { command: command.path, args, windowsVerbatimArguments: false };
}

async function defaultProbe(command: NativeCodexCommand, args: string[]): Promise<ProbeResult> {
  const invocation = codexCommandInvocation(command, args);
  const result = await execFileAsync(invocation.command, invocation.args, {
    encoding: "utf8",
    timeout: SELF_CHECK_TIMEOUT_MS,
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    maxBuffer: 2 * 1024 * 1024,
  });
  return { stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

function commandForSystemPath(path: string, platform: NodeJS.Platform): NativeCodexCommand | null {
  if (platform !== "win32") return { kind: "direct", path };
  if (path.toLowerCase().endsWith(".exe")) return { kind: "direct", path };
  if (!/\.(cmd|bat)$/i.test(path)) return null;
  const paths = platformPath(platform);
  const base = paths.dirname(path);
  const nodeExe = paths.join(base, "node.exe");
  const codexJs = paths.join(base, "node_modules", "@openai", "codex", "bin", "codex.js");
  if (existsSync(nodeExe) && existsSync(codexJs)) return { kind: "node", nodeExe, script: codexJs };
  return { kind: "cmd", path };
}

function defaultDiscoverSystem(platform: NodeJS.Platform): NativeCodexCommand | null {
  const locator = platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, ["codex"], { encoding: "utf8" });
  const paths = discoverExistingCodexPaths({
    whereStdout: result.stdout,
    appData: process.env.APPDATA,
    exists: existsSync,
  });
  for (const path of paths) {
    const command = commandForSystemPath(path, platform);
    if (command) return command;
  }
  return null;
}

const defaultDependencies: CodexExecutableResolverDependencies = {
  readText: (path) => readFile(path, "utf8"),
  stat: (path) => stat(path),
  accessExecutable: (path) => access(path, constants.X_OK),
  probe: defaultProbe,
  discoverSystem: defaultDiscoverSystem,
};

function resolutionPath(command: NativeCodexCommand): string {
  if (command.kind === "node") return command.script;
  return command.path;
}

async function selfCheck(
  command: NativeCodexCommand,
  expectedVersion: string | null,
  deps: CodexExecutableResolverDependencies
): Promise<string> {
  const versionResult = await deps.probe(command, ["--version"]);
  const versionOutput = `${versionResult.stdout}\n${versionResult.stderr}`;
  const match = versionOutput.match(/\bcodex-cli\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  if (!match) throw new Error(`codex --version returned an unrecognized result: ${versionOutput.trim()}`);
  const version = match[1];
  if (expectedVersion && version !== expectedVersion) {
    throw new Error(`bundled Codex version mismatch: expected ${expectedVersion}, got ${version}`);
  }
  const helpResult = await deps.probe(command, ["app-server", "--help"]);
  const helpOutput = `${helpResult.stdout}\n${helpResult.stderr}`;
  if (!/Usage:\s+codex app-server\b/.test(helpOutput)) {
    throw new Error(`codex app-server --help did not expose the expected command`);
  }
  return version;
}

async function resolveBundled(
  options: CodexExecutableResolverOptions,
  deps: CodexExecutableResolverDependencies,
  key: string
): Promise<CodexExecutableResolution> {
  const paths = platformPath(options.platform);
  const manifestFile = options.isPackaged
    ? paths.join(options.resourcesPath, "codex", "codex-runtime-manifest.json")
    : paths.join(options.appPath, "codex-runtime-manifest.json");
  const runtimeRoot = options.isPackaged
    ? paths.join(options.resourcesPath, "codex", key)
    : paths.join(options.appPath, "build", "codex-runtime", key);
  const manifest = parseJson<RuntimeManifest>(await deps.readText(manifestFile), "Codex runtime manifest");
  if (manifest.schemaVersion !== 1)
    throw new Error(`unsupported runtime manifest schema: ${String(manifest.schemaVersion)}`);
  const version = text(manifest.version);
  if (!version || text(manifest.releaseTag) !== `rust-v${version}`) {
    throw new Error("runtime manifest version and release tag do not match");
  }
  const definition = manifest.platforms?.[key];
  if (!definition) throw new Error(`runtime manifest does not contain ${key}`);
  const target = expectedTarget(options.platform, options.arch);
  if (!target || text(definition.target) !== target) {
    throw new Error(`runtime target mismatch: expected ${String(target)}, got ${text(definition.target)}`);
  }
  const entrypoint = safeRelativeRuntimePath(definition.entrypoint);
  if (!Array.isArray(definition.files) || definition.files.length === 0) {
    throw new Error("runtime file manifest is missing");
  }
  const runtimeFiles = definition.files as RuntimeFileDefinition[];
  const seenRuntimeFiles = new Set<string>();
  for (const file of runtimeFiles) {
    const relativePath = safeRelativeRuntimePath(file.path);
    if (seenRuntimeFiles.has(relativePath)) throw new Error(`duplicate runtime file: ${relativePath}`);
    seenRuntimeFiles.add(relativePath);
    const filePath = paths.join(runtimeRoot, ...relativePath.split("/"));
    if (file.executable === true) await assertExecutableFile(filePath, options.platform, deps);
    else if (!(await deps.stat(filePath)).isFile()) throw new Error(`not a regular file: ${filePath}`);
  }
  if (!seenRuntimeFiles.has(entrypoint)) throw new Error("runtime entrypoint is not in its file manifest");
  const descriptor = parseJson<CodexPackageDescriptor>(
    await deps.readText(paths.join(runtimeRoot, "codex-package.json")),
    "Codex package metadata"
  );
  const expectedDescriptor: CodexPackageDescriptor = {
    layoutVersion: 1,
    version,
    target,
    variant: "codex",
    entrypoint,
    resourcesDir: "codex-resources",
    pathDir: "codex-path",
  };
  for (const [field, expected] of Object.entries(expectedDescriptor)) {
    if (descriptor[field as keyof CodexPackageDescriptor] !== expected) {
      throw new Error(`Codex package metadata mismatch for ${field}`);
    }
  }
  const executablePath = paths.join(runtimeRoot, ...entrypoint.split("/"));
  await assertExecutableFile(executablePath, options.platform, deps);
  const command: NativeCodexCommand = { kind: "direct", path: executablePath };
  const checkedVersion = await selfCheck(command, version, deps);
  return {
    path: executablePath,
    source: "bundled",
    version: checkedVersion,
    command,
    runtimeRoot,
  };
}

async function resolveDevelopmentCandidate(
  command: NativeCodexCommand,
  source: "explicit-dev" | "system-dev",
  options: CodexExecutableResolverOptions,
  deps: CodexExecutableResolverDependencies
): Promise<CodexExecutableResolution> {
  const path = resolutionPath(command);
  await assertExecutableFile(path, options.platform, deps);
  const version = await selfCheck(command, null, deps);
  return { path, source, version, command };
}

export async function resolveCodexExecutable(
  options: CodexExecutableResolverOptions,
  dependencies: Partial<CodexExecutableResolverDependencies> = {}
): Promise<CodexExecutableResolution> {
  const deps = { ...defaultDependencies, ...dependencies };
  const key = runtimeKey(options.platform, options.arch);
  if (options.isPackaged) {
    if (!key) {
      throw new CodexRuntimeUnavailableError(
        "unsupported_platform",
        `No packaged Codex runtime supports ${options.platform}-${options.arch}`,
        true
      );
    }
    try {
      return await resolveBundled(options, deps, key);
    } catch (error) {
      throw new CodexRuntimeUnavailableError(
        "bundled_runtime_invalid",
        error instanceof Error ? error.message : String(error),
        true
      );
    }
  }

  const explicit = text(options.explicitDevExecutable);
  if (explicit) {
    if (!isAbsoluteForPlatform(explicit, options.platform)) {
      throw new CodexRuntimeUnavailableError(
        "explicit_dev_path_not_absolute",
        "CODENEXUS_CODEX_EXECUTABLE must be an absolute path",
        false
      );
    }
    try {
      const command = commandForSystemPath(explicit, options.platform) ?? { kind: "direct" as const, path: explicit };
      return await resolveDevelopmentCandidate(command, "explicit-dev", options, deps);
    } catch (error) {
      throw new CodexRuntimeUnavailableError(
        "explicit_dev_runtime_invalid",
        error instanceof Error ? error.message : String(error),
        false
      );
    }
  }

  if (key) {
    try {
      return await resolveBundled(options, deps, key);
    } catch {
      // A prepared bundled runtime is optional in development. Continue to the PATH-only development fallback.
    }
  }

  const system = deps.discoverSystem(options.platform);
  if (system) {
    try {
      return await resolveDevelopmentCandidate(system, "system-dev", options, deps);
    } catch (error) {
      throw new CodexRuntimeUnavailableError(
        "system_dev_runtime_invalid",
        error instanceof Error ? error.message : String(error),
        false
      );
    }
  }
  throw new CodexRuntimeUnavailableError(
    "development_runtime_missing",
    "No explicit, prepared bundled, or PATH Codex development runtime was found",
    false
  );
}

let currentResolution: Promise<CodexExecutableResolution> | null = null;

export function resolveCurrentCodexExecutable(): Promise<CodexExecutableResolution> {
  if (!currentResolution) {
    currentResolution = resolveCodexExecutable({
      isPackaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      explicitDevExecutable: process.env.CODENEXUS_CODEX_EXECUTABLE,
    }).catch((error) => {
      currentResolution = null;
      throw error;
    });
  }
  return currentResolution;
}

export function resetCodexExecutableResolutionForTests(): void {
  currentResolution = null;
}
