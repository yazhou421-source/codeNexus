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
  cwd?: string;
};

export class CodexServerManager {
  private readonly servers = new Map<string, ServerRecord>();

  constructor(
    private readonly options: {
      resolveRuntimeConfig?: () => CodexAppServerRuntimeConfig | null;
      createServer?: (options: ConstructorParameters<typeof CodexAppServer>[0]) => CodexAppServer;
    } = {}
  ) {}

  async start(args: {
    cwd?: string;
    experimentalApi?: boolean;
    onMessage: (payload: { serverId: string; msg: CodexIncomingMessage }) => void;
  }): Promise<{ serverId: string; capabilities: { experimentalApi: boolean } }> {
    const serverId = randomUUID();
    const onMessage = (msg: CodexIncomingMessage) => {
      args.onMessage({ serverId, msg });
    };

    const runtimeConfig = this.options.resolveRuntimeConfig?.() ?? null;
    let server = this.createServer({
      serverId,
      cwd: args.cwd,
      experimentalApi: args.experimentalApi,
      onMessage,
      runtimeConfig,
    });
    try {
      await server.start();
    } catch (error) {
      server.stop();
      if (!runtimeConfig) throw error;
      logger.warn("codex-server", "Router-backed app-server failed; retrying normal Codex mode");
      server = this.createServer({
        serverId,
        cwd: args.cwd,
        experimentalApi: args.experimentalApi,
        onMessage,
        runtimeConfig: null,
      });
      try {
        await server.start();
      } catch (fallbackError) {
        server.stop();
        throw fallbackError;
      }
    }

    this.servers.set(serverId, { server, cwd: args.cwd });
    return { serverId, capabilities: server.capabilities };
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
    record?.server.stop();
    this.servers.delete(serverId);
    return { ok: true };
  }

  stopAll(): void {
    let firstError: unknown = null;
    for (const [serverId, record] of this.servers.entries()) {
      try {
        record.server.stop();
      } catch (error) {
        firstError ??= error;
      } finally {
        this.servers.delete(serverId);
      }
    }
    if (firstError) throw firstError;
  }

  async request<M extends CodexRpcMethod>(args: CodexRpcArgs<M>): Promise<CodexRpcResult<M>> {
    const record = this.getServer(args.serverId);
    return await record.server.request(args.method, args.params);
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
}
