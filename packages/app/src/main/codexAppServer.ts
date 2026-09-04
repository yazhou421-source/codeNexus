import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { discoverExistingCodexPaths } from "./codexNativeDiscovery";
import { applyCodexRouterModelProvider, type CodexAppServerRuntimeConfig } from "./codexRouterRuntime";
import { logger } from "./utils/logger";
import type {
  CodexIncomingMessage,
  CodexNotifyParams,
  CodexRpcMethod,
  CodexRpcParams,
  CodexRpcResult,
  JsonRpcId as ProtocolJsonRpcId,
} from "@codenexus/shared/codex-protocol";

export type ServerMode = "native";

export type JsonRpcId = ProtocolJsonRpcId;

export type JsonRpcRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: unknown;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
};

export type NativeCodexCommand =
  | { kind: "direct"; path: string }
  | { kind: "node"; nodeExe: string; script: string }
  | { kind: "cmd"; path: string };

export type CodexSpawnCommand = {
  command: string;
  args: string[];
  spawnCwd?: string;
};

function configArgs(overrides: readonly string[]): string[] {
  return overrides.flatMap((override) => ["-c", override]);
}

export function buildCodexAppServerSpawnCommand(args: {
  nativeCodex?: NativeCodexCommand;
  cwd?: string;
  globalConfigOverrides?: readonly string[];
}): CodexSpawnCommand {
  const appServerArgs = [...configArgs(args.globalConfigOverrides ?? []), "app-server", "--listen", "stdio://"];
  if (args.nativeCodex?.kind === "cmd") {
    const joined = appServerArgs.map(quoteWindowsCmdArgument).join(" ");
    const cmdline = `""${args.nativeCodex.path}"${joined ? " " : ""}${joined}"`;
    return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdline], spawnCwd: args.cwd };
  }
  if (args.nativeCodex?.kind === "node") {
    return {
      command: args.nativeCodex.nodeExe,
      args: [args.nativeCodex.script, ...appServerArgs],
      spawnCwd: args.cwd,
    };
  }
  return {
    command: args.nativeCodex?.path ?? "codex",
    args: appServerArgs,
    spawnCwd: args.cwd,
  };
}

function quoteWindowsCmdArgument(value: string): string {
  if (!/[\s&|<>^()]/.test(value)) return value;
  if (value.includes('"') || value.includes("%") || value.includes("!")) {
    throw new Error("unsupported character in Windows Codex command argument");
  }
  return `"${value}"`;
}

export function redactCodexChildValue<T>(value: T, sensitiveValues: readonly string[]): T {
  if (typeof value === "string") {
    let result: string = value;
    for (const secret of sensitiveValues) {
      if (secret) result = result.split(secret).join("[REDACTED]");
    }
    return result as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactCodexChildValue(item, sensitiveValues)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactCodexChildValue(item, sensitiveValues)])
    ) as T;
  }
  return value;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

function isValidMethod(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidParams(value: unknown): boolean {
  if (value === undefined) return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export class CodexAppServer {
  readonly id: string;
  private experimentalApiEnabled = false;
  private readonly experimentalApiOptIn: boolean;
  private readonly mode: ServerMode;
  private readonly cwd?: string;
  private readonly runtimeConfig: CodexAppServerRuntimeConfig | null;
  private proc?: ReturnType<typeof spawn>;
  private rl?: readline.Interface;
  private stopping = false;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private onMessage?: (msg: CodexIncomingMessage) => void;
  private nativeCodex?: NativeCodexCommand;

  constructor(opts: {
    id: string;
    mode: ServerMode;
    cwd?: string;
    experimentalApiOptIn?: boolean;
    runtimeConfig?: CodexAppServerRuntimeConfig | null;
    onMessage?: (msg: CodexIncomingMessage) => void;
  }) {
    this.id = opts.id;
    this.mode = opts.mode;
    this.cwd = opts.cwd;
    this.experimentalApiOptIn = Boolean(opts.experimentalApiOptIn);
    this.runtimeConfig = opts.runtimeConfig ?? null;
    this.onMessage = opts.onMessage;
  }

  get running() {
    return Boolean(this.proc && !this.proc.killed);
  }

  get capabilities() {
    return { experimentalApi: this.experimentalApiEnabled };
  }

  async start(): Promise<void> {
    if (this.proc) throw new Error("server already started");

    if (this.mode === "native") this.preflightNative();

    const { command, args, spawnCwd } = this.getSpawnCommand();
    if (spawnCwd) this.ensureSpawnCwd(spawnCwd);
    this.proc = spawn(command, args, {
      cwd: spawnCwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      windowsVerbatimArguments: command.toLowerCase().endsWith("cmd.exe"),
      env: { ...process.env, ...this.runtimeConfig?.childEnv },
    });
    this.stopping = false;

    const spawnFailed = new Promise<never>((_resolve, reject) => {
      this.proc?.once("error", (err: any) => {
        const missingWorkspace = Boolean(spawnCwd) && !existsSync(String(spawnCwd));
        const msg =
          err?.code === "ENOENT"
            ? missingWorkspace
              ? `Workspace directory does not exist: ${spawnCwd}`
              : `Executable not found: ${command}`
            : String(err?.message ?? err);
        reject(new Error(`codex app-server failed to start: ${msg}`));
      });
    });

    this.proc.on("exit", (code, signal) => {
      const error = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
      this.rejectPending(error);
      this.onMessage?.({ kind: "local", method: "codex/exit", params: { code, signal, expected: this.stopping } });
      this.stopping = false;
    });

    this.proc.stderr?.on("data", (buf) => {
      const text = redactCodexChildValue(buf.toString("utf8"), this.runtimeConfig?.sensitiveValues ?? []);
      this.onMessage?.({ kind: "local", method: "codex/stderr", params: { text } });
    });

    if (!this.proc.stdout || !this.proc.stdin) throw new Error("failed to start codex app-server");

    this.rl = readline.createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: any;
      try {
        msg = redactCodexChildValue(JSON.parse(trimmed), this.runtimeConfig?.sensitiveValues ?? []);
      } catch {
        const redactedLine = redactCodexChildValue(trimmed, this.runtimeConfig?.sensitiveValues ?? []);
        this.onMessage?.({ kind: "local", method: "codex/parseError", params: { line: redactedLine } });
        return;
      }
      this.handleIncoming(msg);
    });

    await Promise.race([this.initializeHandshake(), spawnFailed]);
  }

  stop(): void {
    const proc = this.proc;
    if (!proc) return;
    const pid = proc.pid;
    this.stopping = true;
    this.rejectPending(new Error("codex app-server stopped"));
    try {
      this.rl?.close();
    } catch (error) {
      logger.warn("codex-server", "failed to close readline", error);
    }
    try {
      proc.stdin?.destroy();
    } catch (error) {
      logger.warn("codex-server", "failed to destroy stdin", error);
    }
    try {
      proc.stdout?.destroy();
    } catch (error) {
      logger.warn("codex-server", "failed to destroy stdout", error);
    }
    try {
      proc.stderr?.destroy();
    } catch (error) {
      logger.warn("codex-server", "failed to destroy stderr", error);
    }
    try {
      if (process.platform === "win32" && pid) {
        const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.on("error", () => undefined);
        killer.unref();
      } else {
        proc.kill();
      }
    } catch (error) {
      logger.warn("codex-server", "primary kill failed, retrying", error);
      try {
        proc.kill();
      } catch (retryError) {
        logger.warn("codex-server", "retry kill also failed", retryError);
      }
    }
    try {
      proc.unref();
    } catch (error) {
      logger.warn("codex-server", "failed to unref process", error);
    }
    this.proc = undefined;
    this.rl = undefined;
  }

  async request<M extends CodexRpcMethod>(
    method: M,
    params?: CodexRpcParams<M>,
    timeoutMs = 120_000
  ): Promise<CodexRpcResult<M>> {
    if (!isValidMethod(method)) throw new Error("invalid json-rpc method");
    if (!isValidParams(params)) throw new Error(`invalid json-rpc params for method: ${method}`);
    const id: JsonRpcId = this.nextId++;
    const req: JsonRpcRequest = {
      id,
      method: method.trim(),
      params: applyCodexRouterModelProvider(method, params, this.runtimeConfig),
    };
    this.write(req);
    return await new Promise<CodexRpcResult<M>>((resolve, reject) => {
      const pending: Pending = {
        resolve: (value) => resolve(value as CodexRpcResult<M>),
        reject,
        timeout: setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`request timeout: ${method}`));
        }, timeoutMs),
      };
      this.pending.set(id, pending);
    });
  }

  notify<M extends string>(method: M, params?: CodexNotifyParams<M>): void {
    if (!isValidMethod(method)) throw new Error("invalid json-rpc method");
    if (!isValidParams(params)) throw new Error(`invalid json-rpc params for method: ${method}`);
    const n: JsonRpcNotification = { method: method.trim(), params };
    this.write(n);
  }

  respond(id: JsonRpcId, result?: unknown, error?: unknown): void {
    if (!isJsonRpcId(id)) throw new Error("invalid json-rpc id");
    const res: JsonRpcResponse = { id };
    if (error !== undefined) res.error = error;
    else res.result = result;
    this.write(res);
  }

  private write(msg: JsonRpcMessage): void {
    if (!this.proc?.stdin) throw new Error("server not running");
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private handleIncoming(msg: any) {
    if (typeof msg !== "object" || msg === null) {
      this.emitProtocolError("incoming message is not an object", msg);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(msg, "method")) {
      if (!isValidMethod(msg.method)) {
        this.emitProtocolError("invalid notification/request method", msg);
        return;
      }
      if (!isValidParams(msg.params)) {
        this.emitProtocolError("invalid notification/request params", msg);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(msg, "id") && !isJsonRpcId(msg.id)) {
        this.emitProtocolError("invalid request id", msg);
        return;
      }
      this.onMessage?.(
        (Object.prototype.hasOwnProperty.call(msg, "id")
          ? { kind: "request", ...msg }
          : { kind: "notification", ...msg }) as CodexIncomingMessage
      );
      return;
    }

    if (Object.prototype.hasOwnProperty.call(msg, "id")) {
      if (!isJsonRpcId(msg.id)) {
        this.emitProtocolError("invalid response id", msg);
        return;
      }
      const hasResult = Object.prototype.hasOwnProperty.call(msg, "result");
      const hasError = Object.prototype.hasOwnProperty.call(msg, "error");
      if (hasResult === hasError) {
        this.emitProtocolError("response must contain exactly one of result/error", msg);
        return;
      }
      const p = this.pending.get(msg.id);
      if (p) {
        clearTimeout(p.timeout);
        this.pending.delete(msg.id);
        if (hasError) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else {
        this.onMessage?.({ kind: "local", method: "codex/unmatchedResponse", params: msg });
      }
      return;
    }

    this.emitProtocolError("unknown json-rpc envelope", msg);
  }

  private emitProtocolError(reason: string, message: unknown) {
    this.onMessage?.({
      kind: "local",
      method: "codex/protocolError",
      params: {
        reason,
        message,
      },
    });
  }

  private rejectPending(error: Error): void {
    for (const [id, p] of this.pending.entries()) {
      clearTimeout(p.timeout);
      p.reject(error);
      this.pending.delete(id);
    }
  }

  private getSpawnCommand(): CodexSpawnCommand {
    return buildCodexAppServerSpawnCommand({
      nativeCodex: this.nativeCodex,
      cwd: this.cwd,
      globalConfigOverrides: this.runtimeConfig?.globalConfigOverrides,
    });
  }

  private ensureSpawnCwd(spawnCwd: string): void {
    const cwd = String(spawnCwd ?? "").trim();
    if (!cwd) return;
    if (!existsSync(cwd)) {
      throw new Error(`Workspace directory does not exist: ${cwd}`);
    }
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(cwd);
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e);
      throw new Error(`Workspace directory is not accessible: ${cwd} (${msg})`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${cwd}`);
    }
  }

  private preflightNative(): void {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const found = spawnSync(locator, ["codex"], { encoding: "utf8" });
    const paths = discoverExistingCodexPaths({
      whereStdout: found.stdout,
      appData: process.env.APPDATA,
      exists: existsSync,
    });

    if (paths.length === 0) {
      throw new Error(
        "codex (native) was not detected. Install Node.js LTS (including npm), run: npm i -g @openai/codex, and make sure codex is available on PATH. Restart the terminal or this app if needed."
      );
    }

    if (process.platform !== "win32") {
      this.nativeCodex = { kind: "direct", path: paths[0] };
      return;
    }

    const exe = paths.find((p) => p.toLowerCase().endsWith(".exe"));
    if (exe) {
      this.nativeCodex = { kind: "direct", path: exe };
      return;
    }

    const cmd = paths.find((p) => p.toLowerCase().endsWith(".cmd"));
    if (cmd) {
      const base = dirname(cmd);
      const nodeExe = join(base, "node.exe");
      const codexJs = join(base, "node_modules", "@openai", "codex", "bin", "codex.js");
      if (existsSync(nodeExe) && existsSync(codexJs)) {
        // 为避免 cmd.exe 转义/引号问题，直接以 node.exe 运行底层入口脚本。
        this.nativeCodex = { kind: "node", nodeExe, script: codexJs };
        return;
      }
      this.nativeCodex = { kind: "cmd", path: cmd };
      return;
    }

    const bat = paths.find((p) => p.toLowerCase().endsWith(".bat"));
    if (bat) {
      this.nativeCodex = { kind: "cmd", path: bat };
      return;
    }

    throw new Error(
      `codex was found, but no executable entry (.exe/.cmd/.bat) was found. where.exe codex returned:\n${paths.join("\n")}\n\n` +
        `Confirm that you can run this directly in PowerShell: codex --version`
    );
  }

  private async initializeHandshake(): Promise<void> {
    const initializeParams = {
      clientInfo: {
        name: "codex-electron-win",
        title: null,
        version: app.getVersion(),
      },
      capabilities: this.experimentalApiOptIn ? { experimentalApi: true, requestAttestation: false } : null,
    };
    const result = await this.request("initialize", initializeParams);
    // 备注：Codex app-server 的 initialize result 往往只返回 userAgent，不会回显 capabilities。
    // 只要我们在 initialize params 中显式 opt-in，后续就应该按“已启用 experimentalApi”处理。
    this.experimentalApiEnabled = this.experimentalApiOptIn || this.detectExperimentalApiCapability(result);
    this.notify("initialized");
  }

  private detectExperimentalApiCapability(result: unknown): boolean {
    const fromRoot = this.readExperimentalApiFlag(result);
    if (typeof fromRoot === "boolean") return fromRoot;

    const capabilities =
      result && typeof result === "object" ? (result as Record<string, unknown>).capabilities : undefined;
    const fromCapabilities = this.readExperimentalApiFlag(capabilities);
    if (typeof fromCapabilities === "boolean") return fromCapabilities;

    return false;
  }

  private readExperimentalApiFlag(value: unknown): boolean | undefined {
    if (!value || typeof value !== "object") return undefined;
    const obj = value as Record<string, unknown>;
    const direct = obj.experimentalApi;
    if (typeof direct === "boolean") return direct;
    if (typeof direct === "string") {
      const normalized = direct.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }

    return undefined;
  }
}
