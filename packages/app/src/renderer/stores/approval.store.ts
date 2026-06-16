// Approval store: queue and manage v2 server approval requests.
import { defineStore } from "./zustandCompat";
import type { OfficialCodexServerRequest } from "@codenexus/shared/codex-protocol";

export type ApprovalPromptKind = "fileChange" | "commandExecution" | "permissions";

type ApprovalRequest = Extract<
  OfficialCodexServerRequest,
  {
    method:
      | "item/fileChange/requestApproval"
      | "item/commandExecution/requestApproval"
      | "item/permissions/requestApproval";
  }
>;

type ApprovalPromptBase<M extends ApprovalRequest["method"], K extends ApprovalPromptKind> = {
  kind: K;
  serverId: string;
  requestId: number | string;
  method: M;
  threadId: string;
  turnId: string | null;
  itemId: string | null;
  createdAt: number;
  params: Extract<ApprovalRequest, { method: M }>["params"];
  paramsText: string;
};

export type FileChangeApprovalPrompt = ApprovalPromptBase<"item/fileChange/requestApproval", "fileChange">;
export type CommandExecutionApprovalPrompt = ApprovalPromptBase<
  "item/commandExecution/requestApproval",
  "commandExecution"
>;
export type PermissionsApprovalPrompt = ApprovalPromptBase<"item/permissions/requestApproval", "permissions">;

export type ApprovalPrompt = FileChangeApprovalPrompt | CommandExecutionApprovalPrompt | PermissionsApprovalPrompt;

function keyForPrompt(serverId: string, requestId: number | string): string {
  return `${String(serverId ?? "").trim()}:${String(requestId ?? "").trim()}`;
}

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeRequestId(value: number | string): string {
  return String(value ?? "").trim();
}

export const useApprovalStore = defineStore("approval", {
  state: () => ({
    queue: [] as ApprovalPrompt[],
    activeKey: "" as string,
  }),
  getters: {
    activePrompt(state): ApprovalPrompt | null {
      if (!state.activeKey) return null;
      return state.queue.find((p) => keyForPrompt(p.serverId, p.requestId) === state.activeKey) ?? null;
    },
  },
  actions: {
    enqueue(prompt: ApprovalPrompt) {
      const serverId = normalizeId(prompt?.serverId);
      const requestId = prompt?.requestId as any;
      const k = keyForPrompt(serverId, requestId);
      const existingIdx = this.queue.findIndex((p) => keyForPrompt(p.serverId, p.requestId) === k);
      if (existingIdx >= 0) {
        // Keep original createdAt ordering; update details if repeated.
        const existing = this.queue[existingIdx];
        this.queue.splice(existingIdx, 1, { ...existing, ...prompt, serverId });
      } else {
        this.queue.push({ ...prompt, serverId });
      }
      if (!this.activeKey) this.activeKey = k;
    },
    remove(serverId: string, requestId: number | string) {
      const k = keyForPrompt(serverId, requestId);
      const idx = this.queue.findIndex((p) => keyForPrompt(p.serverId, p.requestId) === k);
      if (idx < 0) return;
      this.queue.splice(idx, 1);
      if (this.activeKey === k) {
        const next = this.queue[0] ?? null;
        this.activeKey = next ? keyForPrompt(next.serverId, next.requestId) : "";
      }
    },
    removeResolved(threadId: string, requestId: number | string) {
      const resolvedThreadId = normalizeId(threadId);
      const resolvedRequestId = normalizeRequestId(requestId);
      if (!resolvedThreadId || !resolvedRequestId) return;
      const idx = this.queue.findIndex(
        (p) => p.threadId === resolvedThreadId && normalizeRequestId(p.requestId) === resolvedRequestId
      );
      if (idx < 0) return;
      const prompt = this.queue[idx];
      this.remove(prompt.serverId, prompt.requestId);
    },
    setActive(serverId: string, requestId: number | string) {
      const k = keyForPrompt(serverId, requestId);
      if (this.queue.some((p) => keyForPrompt(p.serverId, p.requestId) === k)) {
        this.activeKey = k;
      }
    },
  },
});
