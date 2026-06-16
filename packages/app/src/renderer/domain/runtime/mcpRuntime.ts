import { codexDesktop } from "../../api/codexDesktopClient";
import { normalizeMcpStatusListResult } from "../serverInterop";
import type { McpResourceContentState, McpServerState } from "../types";
import type { ListMcpServerStatusParams } from "@codenexus/generated/codex-app-server/v2/ListMcpServerStatusParams";
import type { McpResourceReadParams } from "@codenexus/generated/codex-app-server/v2/McpResourceReadParams";

type McpRuntimeDeps = {
  requireActiveWorkspaceServerId: () => string;
  getWorkspacePath: () => string;
  getWorkspaceForThread: (threadId: string) => string;
  ensureServerForWorkspace: (workspacePath: string) => Promise<string>;
};

export type McpStatusState = Pick<
  McpServerState,
  "id" | "state" | "authenticated" | "authStatus" | "message" | "tools" | "resources" | "resourceTemplates"
>;

export type McpRuntime = {
  requestMcpStatusList: () => Promise<McpStatusState[]>;
  requestReloadMcpConfig: () => Promise<void>;
  requestStartMcpOAuthLogin: (serverKey: string) => Promise<string>;
  requestMcpResourceRead: (params: {
    threadId: string;
    serverKey: string;
    uri: string;
  }) => Promise<{ contents: McpResourceContentState[] }>;
};

function normalizePath(value: unknown): string {
  return String(value ?? "").trim();
}

function toMcpResourceContents(contentsValue: unknown): McpResourceContentState[] {
  const contents: McpResourceContentState[] = [];
  if (!Array.isArray(contentsValue)) return contents;
  for (const content of contentsValue) {
    const uriValue = String(content?.uri ?? "").trim();
    const mimeType = typeof content?.mimeType === "string" ? content.mimeType.trim() : "";
    if (typeof (content as { text?: unknown }).text === "string") {
      contents.push({
        uri: uriValue,
        ...(mimeType ? { mimeType } : {}),
        text: String((content as { text: string }).text ?? ""),
      });
      continue;
    }
    if (typeof (content as { blob?: unknown }).blob === "string") {
      contents.push({
        uri: uriValue,
        ...(mimeType ? { mimeType } : {}),
        blob: String((content as { blob: string }).blob ?? ""),
      });
    }
  }
  return contents;
}

export function createMcpRuntime(deps: McpRuntimeDeps): McpRuntime {
  const requestMcpStatusList = async (): Promise<McpStatusState[]> => {
    const serverId = deps.requireActiveWorkspaceServerId();
    const mergedById = new Map<string, McpStatusState>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    while (true) {
      const params: ListMcpServerStatusParams = {
        detail: "full",
        ...(cursor ? { cursor } : {}),
      };
      const { result } = await codexDesktop.codexServer.rpc({ serverId, method: "mcpServerStatus/list", params });
      const normalized = normalizeMcpStatusListResult(result);
      for (const item of normalized) mergedById.set(item.id, item);
      const nextCursor = typeof result?.nextCursor === "string" ? result.nextCursor.trim() : "";
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return [...mergedById.values()].sort((a, b) => a.id.localeCompare(b.id));
  };

  const requestReloadMcpConfig = async (): Promise<void> => {
    const serverId = deps.requireActiveWorkspaceServerId();
    await codexDesktop.codexServer.rpc({ serverId, method: "config/mcpServer/reload" });
  };

  const requestStartMcpOAuthLogin = async (serverKey: string): Promise<string> => {
    const serverId = deps.requireActiveWorkspaceServerId();
    const id = String(serverKey ?? "").trim();
    if (!id) throw new Error("missing mcp server id");
    const { result } = await codexDesktop.codexServer.rpc({
      serverId,
      method: "mcpServer/oauth/login",
      params: { name: id },
    });
    const url = typeof result.authorizationUrl === "string" ? result.authorizationUrl : "";
    if (!url) throw new Error("服务端未返回 authorizationUrl");
    return url;
  };

  const requestMcpResourceRead = async (params: {
    threadId: string;
    serverKey: string;
    uri: string;
  }): Promise<{ contents: McpResourceContentState[] }> => {
    const threadId = String(params.threadId ?? "").trim();
    const serverKey = String(params.serverKey ?? "").trim();
    const uri = String(params.uri ?? "").trim();
    if (!threadId) throw new Error("缺少 threadId，无法读取 MCP 资源。");
    if (!serverKey) throw new Error("缺少 MCP 服务器标识。");
    if (!uri) throw new Error("缺少资源 URI。");
    const workspace = normalizePath(deps.getWorkspaceForThread(threadId) || deps.getWorkspacePath());
    const serverId = await deps.ensureServerForWorkspace(workspace);
    if (!serverId) throw new Error("未连接服务");
    const rpcParams: McpResourceReadParams = {
      threadId,
      server: serverKey,
      uri,
    };
    const { result } = await codexDesktop.codexServer.rpc({
      serverId,
      method: "mcpServer/resource/read",
      params: rpcParams,
    });
    return { contents: toMcpResourceContents(result?.contents) };
  };

  return {
    requestMcpStatusList,
    requestReloadMcpConfig,
    requestStartMcpOAuthLogin,
    requestMcpResourceRead,
  };
}
