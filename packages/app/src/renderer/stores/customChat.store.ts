// 自定义运行时聊天 Store：脱离 codex-app-server，通过 IPC agent.run 驱动 agent-core 内核。
//
// 流式：发送时生成 runId 并推入一条「占位助手消息」；主进程经 agent:event 回吐事件，按 runId 关联：
//   - delta：文本增量，追加到该消息 content，同时按到达顺序写入 parts[] 中的 text part
//   - tool_call / tool_result / tool_error：工具活动按到达顺序写入 / 更新 parts[] 中的 tool part
//   - approval_request：写改/命令需审批，挂到 pendingApprovals，由 UI 弹卡片回传决策
// run() 的 Promise 返回最终文本仅作非流式兜底；不覆盖已经按顺序累积的 parts。
// 仍用最简消息列表（不复用 Codex 时间线渲染——其事件形状与 Codex 协议耦合）。
import { defineStore } from "pinia";
import { codexDesktop } from "../api/codexDesktopClient";
import type { CustomSession, CustomSessionMessage } from "@codenexus/shared/ipc/contracts";

export type CustomChatRole = "user" | "assistant";

// 一次工具调用的活动记录（展示用）。
export type CustomToolActivity = {
  callId: string;
  name: string;
  argsText: string;
  status: "running" | "done" | "error";
  resultText?: string;
  error?: string;
};

export type CustomChatTextPart = {
  id: string;
  type: "text";
  text: string;
};

export type CustomChatToolPart = {
  id: string;
  type: "tool";
  tool: CustomToolActivity;
};

export type CustomChatPart = CustomChatTextPart | CustomChatToolPart;

// 一条挂起的审批请求（命令/写改），等待用户同意或拒绝。
export type CustomApprovalRequest = {
  runId: string;
  approvalId: string;
  kind: "command" | "file";
  title: string;
  detail: string;
};

export type CustomChatMessage = {
  id: string;
  role: CustomChatRole;
  content: string;
  createdAt?: number;
  // 本地错误占位（runtime/provider 报错），不计入发往模型的对话历史。
  error?: boolean;
  // 流式期间用 runId 关联本条助手消息；完成后清除。
  runId?: string;
  streaming?: boolean;
  // 本轮内按事件到达顺序展示的正文 / 工具活动。
  parts?: CustomChatPart[];
  // 思考/推理文本（provider 开启 thinking 时流式累积）；展示用，不发回模型。
  reasoning?: string;
};

let messageSeq = 0;
function nextMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${Date.now()}-${messageSeq}`;
}

let runSeq = 0;
function nextRunId(): string {
  runSeq += 1;
  return `run-${Date.now()}-${runSeq}`;
}

let partSeq = 0;
function nextPartId(prefix: string): string {
  partSeq += 1;
  return `${prefix}-${Date.now()}-${partSeq}`;
}

// 模块级：流式订阅只装一次。
let streamUnsubscribe: (() => void) | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const runSessionById = new Map<string, string>();

type SessionSnapshotInput = {
  providerId?: string | null;
  providerLabel?: string | null;
  workspaceRoot?: string | null;
};

function deriveSessionTitle(messages: CustomChatMessage[]): string {
  const firstUserText = messages.find((message) => message.role === "user")?.content.trim();
  if (!firstUserText) return "新会话";
  return firstUserText.length > 30 ? `${firstUserText.slice(0, 30)}...` : firstUserText;
}

function deserializeMessage(message: CustomSessionMessage): CustomChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    ...(message.error ? { error: true } : {}),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.parts ? { parts: message.parts as CustomChatPart[] } : {}),
  };
}

function serializeMessage(message: CustomChatMessage): CustomSessionMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? Date.now(),
    ...(message.error ? { error: true } : {}),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.parts ? { parts: message.parts } : {}),
  };
}

export const useCustomChatStore = defineStore("customChat", {
  state: () => ({
    messages: [] as CustomChatMessage[],
    pendingApprovals: [] as CustomApprovalRequest[],
    sessions: [] as CustomSession[],
    currentSessionId: "",
    loadingSessions: false,
    sending: false,
  }),
  actions: {
    reset() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      this.messages = [];
      this.pendingApprovals = [];
      this.sessions = [];
      this.currentSessionId = "";
      this.loadingSessions = false;
      this.sending = false;
    },
    hydrateSession(session: CustomSession) {
      this.currentSessionId = session.id;
      this.messages = session.messages.map(deserializeMessage);
      this.pendingApprovals = [];
    },
    currentSession(snapshot?: SessionSnapshotInput): CustomSession {
      const existing = this.sessions.find((session) => session.id === this.currentSessionId);
      const now = Date.now();
      return {
        id: this.currentSessionId || existing?.id || nextMessageId("session"),
        title: deriveSessionTitle(this.messages),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        providerId:
          snapshot && "providerId" in snapshot ? (snapshot.providerId ?? null) : (existing?.providerId ?? null),
        providerLabel:
          snapshot && "providerLabel" in snapshot
            ? (snapshot.providerLabel ?? null)
            : (existing?.providerLabel ?? null),
        workspaceRoot:
          snapshot && "workspaceRoot" in snapshot
            ? (snapshot.workspaceRoot ?? null)
            : (existing?.workspaceRoot ?? null),
        messages: this.messages.map(serializeMessage),
      };
    },
    async initSessions(snapshot?: SessionSnapshotInput) {
      this.loadingSessions = true;
      try {
        const result = await codexDesktop.agent.listSessions();
        this.sessions = result.items;
        if (this.currentSessionId && this.sessions.some((session) => session.id === this.currentSessionId)) {
          return;
        }
        const first = this.sessions[0];
        if (first) {
          this.hydrateSession(first);
        } else {
          await this.newSession(snapshot);
        }
      } finally {
        this.loadingSessions = false;
      }
    },
    async newSession(snapshot?: SessionSnapshotInput): Promise<CustomSession | null> {
      if (this.sending) return null;
      const result = await codexDesktop.agent.createSession({
        providerId: snapshot?.providerId ?? null,
        providerLabel: snapshot?.providerLabel ?? null,
        workspaceRoot: snapshot?.workspaceRoot ?? null,
        messages: [],
      });
      this.sessions = result.items;
      this.hydrateSession(result.item);
      return result.item;
    },
    async loadSession(id: string): Promise<boolean> {
      if (this.sending) return false;
      const sessionId = String(id ?? "").trim();
      if (!sessionId || sessionId === this.currentSessionId) return false;
      const result = await codexDesktop.agent.getSession({ id: sessionId });
      if (!result.item) return false;
      this.hydrateSession(result.item);
      return true;
    },
    async deleteSession(id: string, snapshot?: SessionSnapshotInput): Promise<boolean> {
      const sessionId = String(id ?? "").trim();
      if (!sessionId || (this.sending && sessionId === this.currentSessionId)) return false;
      const result = await codexDesktop.agent.deleteSession({ id: sessionId });
      this.sessions = result.items;
      if (sessionId === this.currentSessionId) {
        const next = result.items[0];
        if (next) {
          this.hydrateSession(next);
        } else {
          await this.newSession(snapshot);
        }
      }
      return result.deleted;
    },
    async persistCurrentSession(snapshot?: SessionSnapshotInput): Promise<void> {
      if (!this.currentSessionId) {
        await this.newSession(snapshot);
        return;
      }
      const session = this.currentSession(snapshot);
      const result = await codexDesktop.agent.upsertSession({ session });
      this.sessions = result.items;
      this.currentSessionId = result.item.id;
    },
    schedulePersistCurrentSession(snapshot?: SessionSnapshotInput) {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        void this.persistCurrentSession(snapshot);
      }, 800);
    },
    // 幂等订阅主进程的流式事件。
    ensureStreamSubscription() {
      if (streamUnsubscribe) return;
      streamUnsubscribe = codexDesktop.agent.onEvent((event) => {
        switch (event.type) {
          case "delta":
            this.applyDelta(event.runId, event.text);
            break;
          case "reasoning":
            this.applyReasoning(event.runId, event.text);
            break;
          case "tool_call":
            this.startTool(event.runId, event.callId, event.name, event.argsText);
            break;
          case "tool_result":
            this.finishTool(event.runId, event.callId, "done", { resultText: event.resultText });
            break;
          case "tool_error":
            this.finishTool(event.runId, event.callId, "error", { error: event.error });
            break;
          case "approval_request":
            this.pendingApprovals.push({
              runId: event.runId,
              approvalId: event.approvalId,
              kind: event.kind,
              title: event.title,
              detail: event.detail,
            });
            break;
        }
      });
    },
    findAssistantByRun(runId: string): CustomChatMessage | undefined {
      const sessionId = runSessionById.get(runId);
      if (sessionId && sessionId !== this.currentSessionId) return undefined;
      return this.messages.find((item) => item.runId === runId && item.role === "assistant");
    },
    applyDelta(runId: string, text: string) {
      const message = this.findAssistantByRun(runId);
      if (!message) return;
      message.content += text;
      if (!message.parts) message.parts = [];
      const lastPart = message.parts[message.parts.length - 1];
      if (lastPart?.type === "text") {
        lastPart.text += text;
        this.schedulePersistCurrentSession();
        return;
      }
      message.parts.push({ id: nextPartId("text"), type: "text", text });
      this.schedulePersistCurrentSession();
    },
    applyReasoning(runId: string, text: string) {
      const message = this.findAssistantByRun(runId);
      if (message) {
        message.reasoning = (message.reasoning ?? "") + text;
        this.schedulePersistCurrentSession();
      }
    },
    startTool(runId: string, callId: string, name: string, argsText: string) {
      const message = this.findAssistantByRun(runId);
      if (!message) return;
      if (!message.parts) message.parts = [];
      message.parts.push({
        id: `tool-${callId}`,
        type: "tool",
        tool: { callId, name, argsText, status: "running" },
      });
      this.schedulePersistCurrentSession();
    },
    finishTool(
      runId: string,
      callId: string,
      status: "done" | "error",
      patch: { resultText?: string; error?: string }
    ) {
      const message = this.findAssistantByRun(runId);
      const toolPart = message?.parts?.find(
        (item): item is CustomChatToolPart => item.type === "tool" && item.tool.callId === callId
      );
      const tool = toolPart?.tool;
      if (!tool) return;
      tool.status = status;
      if (patch.resultText !== undefined) tool.resultText = patch.resultText;
      if (patch.error !== undefined) tool.error = patch.error;
      this.schedulePersistCurrentSession();
    },
    // 用户在审批卡片上点同意/拒绝：回传决策并从队列移除。
    async respondApproval(approvalId: string, approved: boolean) {
      const idx = this.pendingApprovals.findIndex((item) => item.approvalId === approvalId);
      if (idx < 0) return;
      const request = this.pendingApprovals[idx];
      this.pendingApprovals.splice(idx, 1);
      await codexDesktop.agent.approve({ runId: request.runId, approvalId, approved });
    },
    async send(text: string, opts?: SessionSnapshotInput): Promise<void> {
      const content = String(text ?? "").trim();
      if (!content || this.sending) return;
      const providerId = String(opts?.providerId ?? "").trim() || undefined;
      if (!this.currentSessionId) {
        await this.newSession(opts);
      }
      this.ensureStreamSubscription();

      this.messages.push({ id: nextMessageId("user"), role: "user", content, createdAt: Date.now() });
      // 历史在推入「占位助手消息」之前快照，避免把空占位发给模型。
      const history = this.messages
        .filter((item) => !item.error)
        .map((item) => ({ role: item.role, content: item.content }));

      const runId = nextRunId();
      const assistantId = nextMessageId("assistant");
      this.messages.push({
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
        runId,
        streaming: true,
      });
      if (this.currentSessionId) runSessionById.set(runId, this.currentSessionId);
      this.sending = true;
      await this.persistCurrentSession(opts);
      try {
        const result = await codexDesktop.agent.run({ runId, providerId, messages: history });
        const message = this.messages.find((item) => item.id === assistantId);
        if (message) {
          message.streaming = false;
          message.runId = undefined;
          if (result.ok) {
            const hasTextPart = Boolean(message.parts?.some((part) => part.type === "text" && part.text.length > 0));
            if (!hasTextPart) {
              const text = result.finalText || "(模型返回了空内容)";
              message.content = text;
              message.parts = [...(message.parts ?? []), { id: nextPartId("text"), type: "text", text }];
            }
          } else {
            message.content = result.error;
            message.error = true;
          }
        }
      } catch (error: unknown) {
        const messageText = error instanceof Error ? error.message : String(error);
        const message = this.messages.find((item) => item.id === assistantId);
        if (message) {
          message.streaming = false;
          message.runId = undefined;
          message.content = messageText;
          message.error = true;
        }
      } finally {
        // 本轮残留的挂起审批（理论上主进程已兜底拒绝）从队列清掉，避免悬挂卡片。
        this.pendingApprovals = this.pendingApprovals.filter((item) => item.runId !== runId);
        runSessionById.delete(runId);
        this.sending = false;
        await this.persistCurrentSession(opts);
      }
    },
  },
});
