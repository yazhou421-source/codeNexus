// MCP Store：展示/维护 MCP 服务器列表与连接状态，并处理 OAuth 登录回调刷新。
import { defineStore } from "./zustandCompat";
import type { McpServerState } from "../domain/types";

export const useMcpStore = defineStore("mcp", {
  state: () => ({
    loadState: "idle" as "idle" | "loading" | "ready" | "error",
    errorText: "" as string,
    statusText: "" as string,
    servers: [] as McpServerState[],
  }),
  actions: {
    // 统一维护 MCP 面板的加载状态与错误信息。
    setLoadState(next: "idle" | "loading" | "ready" | "error", errorText = "") {
      this.loadState = next;
      this.errorText = errorText;
    },
    setStatusText(next: string) {
      this.statusText = next;
    },
    setServers(servers: McpServerState[]) {
      this.servers = [...servers];
    },
    // 清空面板数据，常用于服务断开或刷新失败后。
    resetState(errorText = "") {
      this.loadState = "idle";
      this.errorText = errorText;
      this.statusText = "";
      this.servers = [];
    },
  },
});
