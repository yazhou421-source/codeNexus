import { spawn } from "node:child_process";
import * as readline from "node:readline";
import { existsSync, statSync } from "node:fs";
import { app } from "electron";
import {
  CodexRuntimeUnavailableError,
  resolveCurrentCodexExecutable,
  type CodexExecutableResolution,
  type NativeCodexCommand,
} from "./codexExecutableResolver";
import {
  applyCodexRouterModelProvider,
  codexRouterModelProviderForModel,
  type CodexAppServerRuntimeConfig,
} from "./codexRouterRuntime";
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

export type { NativeCodexCommand } from "./codexExecutableResolver";

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
  private readonly threadModelProviders = new Map<string, string>();
  private onMessage?: (msg: CodexIncomingMessage) => void;
  private nativeCodex?: NativeCodexCommand;
  private readonly resolveExecutable: () => Promise<CodexExecutableResolution>;

  constructor(opts: {
    id: string;
    mode: ServerMode;
    cwd?: string;
    experimentalApiOptIn?: boolean;
    runtimeConfig?: CodexAppServerRuntimeConfig | null;
    onMessage?: (msg: CodexIncomingMessage) => void;
    resolveExecutable?: () => Promise<CodexExecutableResolution>;
  }) {
    this.id = opts.id;
    this.mode = opts.mode;
    this.cwd = opts.cwd;
    this.experimentalApiOptIn = Boolean(opts.experimentalApiOptIn);
    this.runtimeConfig = opts.runtimeConfig ?? null;
    this.onMessage = opts.onMessage;
    this.resolveExecutable = opts.resolveExecutable ?? resolveCurrentCodexExecutable;
  }

  get running() {
    return Boolean(this.proc && !this.proc.killed);
  }

  get capabilities() {
    return { experimentalApi: this.experimentalApiEnabled };
  }

  async start(): Promise<void> {
    if (this.proc) throw new Error("server already started");

    if (this.mode === "native") await this.preflightNative();

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
    await this.ensureRouterProviderForTurn(method, params, timeoutMs);
    const id: JsonRpcId = this.nextId++;
    const routedParams = applyCodexRouterModelProvider(method, params, this.runtimeConfig);
    const req: JsonRpcRequest = {
      id,
      method: method.trim(),
      params: routedParams,
    };
    this.write(req);
    const result = await new Promise<CodexRpcResult<M>>((resolve, reject) => {
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
    this.rememberThreadModelProvider(method, routedParams, result);
    return result;
  }

  private async ensureRouterProviderForTurn(method: string, params: unknown, timeoutMs: number): Promise<void> {
    if (method !== "turn/start" || !params || typeof params !== "object" || Array.isArray(params)) return;
    const record = params as Record<string, unknown>;
    const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
    const model = typeof record.model === "string" ? record.model.trim() : "";
    const desiredProvider = codexRouterModelProviderForModel(model, this.runtimeConfig);
    if (!threadId || !model || !desiredProvider || this.threadModelProviders.get(threadId) === desiredProvider) return;

    await this.request("thread/resume", { threadId, model }, timeoutMs);
  }

  private rememberThreadModelProvider(method: string, params: unknown, result: unknown): void {
    if (!["thread/start", "thread/resume", "thread/fork"].includes(method)) return;
    const paramsRecord = params && typeof params === "object" ? (params as Record<string, unknown>) : {};
    const resultRecord = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    const thread =
      resultRecord.thread && typeof resultRecord.thread === "object"
        ? (resultRecord.thread as Record<string, unknown>)
        : {};
    const threadId = String(thread.id ?? paramsRecord.threadId ?? "").trim();
    const modelProvider = String(resultRecord.modelProvider ?? paramsRecord.modelProvider ?? "").trim();
    if (threadId && modelProvider) this.threadModelProviders.set(threadId, modelProvider);
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

  private async preflightNative(): Promise<void> {
    try {
      const resolution = await this.resolveExecutable();
      this.nativeCodex = resolution.command;
      logger.info("codex-runtime", `using ${resolution.source} Codex ${resolution.version} at ${resolution.path}`);
    } catch (error) {
      if (error instanceof CodexRuntimeUnavailableError) {
        logger.error("codex-runtime", `${error.code}: ${error.technicalDetail}`);
      } else {
        logger.error("codex-runtime", "Codex runtime resolution failed", error);
      }
      throw error;
    }
  }

  private async initializeHandshake(): Promise<void> {
    const initializeParams = {
      clientInfo: {
        name: "calmnova-code",
        title: "Calmnova Code",
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
