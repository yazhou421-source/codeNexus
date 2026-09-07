import { randomUUID } from "node:crypto";
import { CodexAppServer, type ServerMode } from "../codexAppServer";
import type { CodexAppServerRuntimeConfig } from "../codexRouterRuntime";
import { logger } from "../utils/logger";
import type {
  CodexIncomingMessage,
  CodexNotifyArgs,
  CodexRpcArgs,
  CodexRpcMethod,
  CodexRpcResult,
  CodexServerRespondArgs,
} from "@codenexus/shared/codex-protocol";

type ServerRecord = {
  server: CodexAppServer;
  startingServer: CodexAppServer | null;
  cwd?: string;
  experimentalApi?: boolean;
  onMessage: (payload: { serverId: string; msg: CodexIncomingMessage }) => void;
  startedWithRevision: number;
  generation: number;
  turnStartRequestsInFlight: number;
  turnStartsAwaitingLifecycle: number;
  pendingRefresh: boolean;
  refreshPromise: Promise<void> | null;
  retryTimer: NodeJS.Timeout | null;
  retryAttempt: number;
  stopped: boolean;
};

export type CodexServerRuntimeState = {
  serverId: string;
  startedWithRevision: number;
  currentRevision: number;
  stale: boolean;
  busy: boolean;
  pendingRefresh: boolean;
};

export class CodexServerManager {
  private readonly servers = new Map<string, ServerRecord>();

  constructor(
    private readonly options: {
      resolveRuntimeConfig?: () => CodexAppServerRuntimeConfig | null;
      resolveRuntimeRevision?: () => number;
      isServerBusy?: (serverId: string) => boolean;
      refreshRetryBaseMs?: number;
      createServer?: (options: ConstructorParameters<typeof CodexAppServer>[0]) => CodexAppServer;
      listAccountModels?: () => Promise<CodexRpcResult<"model/list">>;
    } = {}
  ) {}

  async start(args: {
    cwd?: string;
    experimentalApi?: boolean;
    onMessage: (payload: { serverId: string; msg: CodexIncomingMessage }) => void;
  }): Promise<{ serverId: string; capabilities: { experimentalApi: boolean } }> {
    const serverId = randomUUID();
    const record: ServerRecord = {
      server: null as unknown as CodexAppServer,
      startingServer: null,
      cwd: args.cwd,
      experimentalApi: args.experimentalApi,
      onMessage: args.onMessage,
      startedWithRevision: this.runtimeRevision,
      generation: 1,
      turnStartRequestsInFlight: 0,
      turnStartsAwaitingLifecycle: 0,
      pendingRefresh: false,
      refreshPromise: null,
      retryTimer: null,
      retryAttempt: 0,
      stopped: false,
    };
    const started = await this.startServerInstance(serverId, record, record.generation, true);
    record.server = started.server;
    record.startedWithRevision = started.revision;
    this.servers.set(serverId, record);
    return { serverId, capabilities: started.server.capabilities };
  }

  async refreshForRuntimeRevision(): Promise<void> {
    const attempts: Promise<void>[] = [];
    for (const [serverId, record] of this.servers) {
      if (record.startedWithRevision >= this.runtimeRevision) continue;
      record.pendingRefresh = true;
      attempts.push(this.refreshWhenSafe(serverId, record));
    }
    await Promise.all(attempts);
  }

  hasActiveTurns(): boolean {
    return [...this.servers].some(([id, record]) => this.recordBusy(id, record));
  }

  runtimeState(serverId: string): CodexServerRuntimeState | null {
    const record = this.servers.get(serverId);
    if (!record) return null;
    const currentRevision = this.runtimeRevision;
    return {
      serverId,
      startedWithRevision: record.startedWithRevision,
      currentRevision,
      stale: record.startedWithRevision < currentRevision,
      busy: this.recordBusy(serverId, record),
      pendingRefresh: record.pendingRefresh,
    };
  }

  private createServer(args: {
    serverId: string;
    cwd?: string;
    experimentalApi?: boolean;
    onMessage: (msg: CodexIncomingMessage) => void;
    runtimeConfig: CodexAppServerRuntimeConfig | null;
  }): CodexAppServer {
    const create = this.options.createServer ?? ((options) => new CodexAppServer(options));
    return create({
      id: args.serverId,
      mode: "native" as ServerMode,
      cwd: args.cwd,
      experimentalApiOptIn: Boolean(args.experimentalApi),
      onMessage: args.onMessage,
      runtimeConfig: args.runtimeConfig,
    });
  }

  stop(serverId: string): { ok: true } {
    const record = this.servers.get(serverId);
    if (record) this.stopRecord(record);
    record?.server.stop();
    this.servers.delete(serverId);
    return { ok: true };
  }

  stopAll(): void {
    let firstError: unknown = null;
    for (const [serverId, record] of this.servers.entries()) {
      try {
        this.stopRecord(record);
        record.server.stop();
      } catch (error) {
        firstError ??= error;
      } finally {
        this.servers.delete(serverId);
      }
    }
    if (firstError) throw firstError;
  }

  async listAccountModels(): Promise<CodexRpcResult<"model/list">> {
    if (!this.options.listAccountModels) throw new Error("Account model discovery is unavailable.");
    return this.options.listAccountModels();
  }

  async request<M extends CodexRpcMethod>(args: CodexRpcArgs<M>): Promise<CodexRpcResult<M>> {
    const record = this.getServer(args.serverId);
    if (args.method === "model/list" && this.options.listAccountModels) {
      return (await this.listAccountModels()) as CodexRpcResult<M>;
    }
    const protectsTurnStart = args.method === "turn/start";
    if (protectsTurnStart && record.startedWithRevision < this.runtimeRevision) {
      record.pendingRefresh = true;
      if (this.recordBusy(args.serverId, record)) {
        throw runtimeRefreshPendingError();
      }
      await this.refreshWhenSafe(args.serverId, record);
      if (record.startedWithRevision < this.runtimeRevision) throw runtimeRefreshPendingError();
    }
    if (protectsTurnStart) {
      record.turnStartRequestsInFlight += 1;
      record.turnStartsAwaitingLifecycle += 1;
    }
    try {
      const result = await record.server.request(args.method, args.params);
      if (protectsTurnStart && turnStartAlreadyFinished(result)) {
        this.releaseTurnStartGuard(record);
        void this.refreshWhenSafe(args.serverId, record);
      }
      return result;
    } catch (error) {
      if (protectsTurnStart) {
        this.releaseTurnStartGuard(record);
        void this.refreshWhenSafe(args.serverId, record);
      }
      throw error;
    } finally {
      if (protectsTurnStart) {
        record.turnStartRequestsInFlight = Math.max(0, record.turnStartRequestsInFlight - 1);
        void this.refreshWhenSafe(args.serverId, record);
      }
    }
  }

  notify<M extends string>(args: CodexNotifyArgs<M>): { ok: true } {
    const record = this.getServer(args.serverId);
    record.server.notify(args.method, args.params);
    return { ok: true };
  }

  respond(args: CodexServerRespondArgs): { ok: true } {
    const record = this.getServer(args.serverId);
    record.server.respond(args.id, args.result, args.error);
    return { ok: true };
  }

  private getServer(serverId: string): ServerRecord {
    const record = this.servers.get(serverId);
    if (!record) throw new Error("server not found");
    return record;
  }

  private get runtimeRevision(): number {
    const value = Number(this.options.resolveRuntimeRevision?.() ?? 0);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  private recordBusy(serverId: string, record: ServerRecord): boolean {
    return (
      record.turnStartRequestsInFlight > 0 ||
      record.turnStartsAwaitingLifecycle > 0 ||
      Boolean(this.options.isServerBusy?.(serverId))
    );
  }

  private async startServerInstance(
    serverId: string,
    record: ServerRecord,
    generation: number,
    allowFallback: boolean
  ): Promise<{ server: CodexAppServer; revision: number }> {
    const revision = this.runtimeRevision;
    const onMessage = (msg: CodexIncomingMessage) => {
      if (record.stopped || record.generation !== generation) return;
      record.onMessage({ serverId, msg });
      if ("method" in msg && msg.method === "turn/started") {
        this.releaseTurnStartGuard(record);
      }
      if ("method" in msg && msg.method === "turn/completed") void this.refreshWhenSafe(serverId, record);
    };
    const runtimeConfig = this.options.resolveRuntimeConfig?.() ?? null;
    let server = this.createServer({
      serverId,
      cwd: record.cwd,
      experimentalApi: record.experimentalApi,
      onMessage,
      runtimeConfig,
    });
    record.startingServer = server;
    try {
      await server.start();
      if (record.startingServer === server) record.startingServer = null;
      return { server, revision };
    } catch (error) {
      if (record.startingServer === server) record.startingServer = null;
      server.stop();
      if (!allowFallback || !runtimeConfig) throw error;
      logger.warn("codex-server", "Router-backed app-server failed; retrying normal Codex mode");
      server = this.createServer({
        serverId,
        cwd: record.cwd,
        experimentalApi: record.experimentalApi,
        onMessage,
        runtimeConfig: null,
      });
      record.startingServer = server;
      try {
        await server.start();
        if (record.startingServer === server) record.startingServer = null;
        return { server, revision };
      } catch (fallbackError) {
        if (record.startingServer === server) record.startingServer = null;
        server.stop();
        throw fallbackError;
      }
    }
  }

  private async refreshWhenSafe(serverId: string, record: ServerRecord): Promise<void> {
    if (record.stopped || this.servers.get(serverId) !== record) return;
    if (record.startedWithRevision >= this.runtimeRevision) {
      record.pendingRefresh = false;
      return;
    }
    record.pendingRefresh = true;
    if (this.recordBusy(serverId, record) || record.refreshPromise)
      return await (record.refreshPromise ?? Promise.resolve());

    const refresh = this.replaceServer(serverId, record);
    record.refreshPromise = refresh;
    try {
      await refresh;
    } finally {
      if (record.refreshPromise === refresh) record.refreshPromise = null;
    }
    if (!record.stopped && !record.retryTimer && record.startedWithRevision < this.runtimeRevision) {
      record.pendingRefresh = true;
      if (!this.recordBusy(serverId, record)) void this.refreshWhenSafe(serverId, record);
    }
  }

  private async replaceServer(serverId: string, record: ServerRecord): Promise<void> {
    const previousServer = record.server;
    const nextGeneration = record.generation + 1;
    try {
      const started = await this.startServerInstance(serverId, record, nextGeneration, false);
      if (record.stopped || this.servers.get(serverId) !== record) {
        started.server.stop();
        return;
      }
      if (this.recordBusy(serverId, record)) {
        started.server.stop();
        record.pendingRefresh = true;
        return;
      }
      record.server = started.server;
      record.startedWithRevision = started.revision;
      record.generation = nextGeneration;
      record.pendingRefresh = record.startedWithRevision < this.runtimeRevision;
      record.retryAttempt = 0;
      this.clearRetry(record);
      try {
        previousServer.stop();
      } catch (error) {
        logger.warn("codex-server", "replacement started but the previous app-server did not stop cleanly", error);
      }
    } catch (error) {
      record.pendingRefresh = true;
      record.retryAttempt += 1;
      logger.warn("codex-server", "app-server runtime refresh failed; keeping the previous server", error);
      this.scheduleRetry(serverId, record);
    }
  }

  private scheduleRetry(serverId: string, record: ServerRecord): void {
    if (record.stopped || record.retryTimer) return;
    const base = Math.max(10, Number(this.options.refreshRetryBaseMs ?? 1_000));
    const delay = Math.min(30_000, base * 2 ** Math.min(record.retryAttempt - 1, 5));
    record.retryTimer = setTimeout(() => {
      record.retryTimer = null;
      void this.refreshWhenSafe(serverId, record);
    }, delay);
    record.retryTimer.unref?.();
  }

  private clearRetry(record: ServerRecord): void {
    if (record.retryTimer) clearTimeout(record.retryTimer);
    record.retryTimer = null;
  }

  private releaseTurnStartGuard(record: ServerRecord): void {
    record.turnStartsAwaitingLifecycle = Math.max(0, record.turnStartsAwaitingLifecycle - 1);
  }

  private stopRecord(record: ServerRecord): void {
    record.stopped = true;
    record.pendingRefresh = false;
    this.clearRetry(record);
    const startingServer = record.startingServer;
    record.startingServer = null;
    if (startingServer && startingServer !== record.server) {
      try {
        startingServer.stop();
      } catch (error) {
        logger.warn("codex-server", "failed to stop an app-server replacement during shutdown", error);
      }
    }
  }
}

function turnStartAlreadyFinished(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const turn = (value as Record<string, unknown>).turn;
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) return false;
  const status = (turn as Record<string, unknown>).status;
  return status === "completed" || status === "interrupted" || status === "failed";
}

function runtimeRefreshPendingError(): Error & { code: string } {
  return Object.assign(
    new Error("AI model configuration is refreshing. Wait for the active turn to finish, then try again."),
    { code: "codex_runtime_refresh_pending" }
  );
}
