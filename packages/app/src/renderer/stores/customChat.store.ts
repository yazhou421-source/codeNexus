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
import { useDebugTimelineStore } from "./debugTimeline.store";
import { safeJsonStringify } from "../utils/safeJson";
import type { TimelineEventLevel } from "../domain/types";
import type { CustomAgentStreamEvent, CustomSession, CustomSessionMessage } from "@codenexus/shared/ipc/contracts";

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

const CANCELLED_MARKER = "[已取消]";
const CUSTOM_DEBUG_THREAD_FALLBACK = "__custom__";
const DEBUG_TEXT_PREVIEW_MAX = 2_000;
const DEBUG_HISTORY_TAIL_MAX = 24;

export function customDebugThreadId(sessionIdValue: string | null | undefined): string {
  const sessionId = String(sessionIdValue ?? "").trim();
  return sessionId ? `custom:${sessionId}` : CUSTOM_DEBUG_THREAD_FALLBACK;
}

function summarizeDebugText(value: unknown, maxChars = DEBUG_TEXT_PREVIEW_MAX) {
  const text = String(value ?? "");
  const limit = Math.max(0, Math.round(maxChars));
  const truncated = text.length > limit;
  return {
    text: truncated ? text.slice(0, limit) : text,
    length: text.length,
    truncated,
  };
}

function summarizeDebugMessages(messages: Array<{ role: string; content: string }>) {
  const tail = messages.slice(Math.max(0, messages.length - DEBUG_HISTORY_TAIL_MAX));
  return {
    count: messages.length,
    omittedHeadCount: Math.max(0, messages.length - tail.length),
    tail: tail.map((message, index) => ({
      index: messages.length - tail.length + index,
      role: message.role,
      content: summarizeDebugText(message.content, 1_000),
    })),
  };
}

function summarizeDebugMessage(message: CustomChatMessage | undefined) {
  if (!message) return null;
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return {
    id: message.id,
    role: message.role,
    error: Boolean(message.error),
    streaming: Boolean(message.streaming),
    content: summarizeDebugText(message.content),
    reasoning: message.reasoning ? summarizeDebugText(message.reasoning) : null,
    parts: {
      count: parts.length,
      textCount: parts.filter((part) => part.type === "text").length,
      toolCount: parts.filter((part) => part.type === "tool").length,
    },
  };
}

function summarizeStreamEventForDebug(event: CustomAgentStreamEvent): Record<string, unknown> {
  switch (event.type) {
    case "delta":
      return {
        type: event.type,
        runId: event.runId,
        text: summarizeDebugText(event.text),
      };
    case "reasoning":
      return {
        type: event.type,
        runId: event.runId,
        text: summarizeDebugText(event.text),
      };
    case "tool_call_delta":
      return {
        type: event.type,
        runId: event.runId,
        index: event.index,
        callId: event.callId,
        name: event.name,
        argsTextDelta: summarizeDebugText(event.argsTextDelta),
      };
    case "tool_call":
      return {
        type: event.type,
        runId: event.runId,
        callId: event.callId,
        name: event.name,
        argsText: summarizeDebugText(event.argsText),
      };
    case "tool_result":
      return {
        type: event.type,
        runId: event.runId,
        callId: event.callId,
        name: event.name,
        resultText: summarizeDebugText(event.resultText),
      };
    case "tool_error":
      return {
        type: event.type,
        runId: event.runId,
        callId: event.callId,
        name: event.name,
        error: summarizeDebugText(event.error),
      };
    case "approval_request":
      return {
        type: event.type,
        runId: event.runId,
        approvalId: event.approvalId,
        kind: event.kind,
        title: event.title,
        detail: summarizeDebugText(event.detail),
      };
  }
}

function markMessageCancelled(message: CustomChatMessage): void {
  if (!message.content || message.content.trim().length === 0) {
    message.content = CANCELLED_MARKER;
  } else if (!message.content.includes(CANCELLED_MARKER)) {
    message.content += `\n\n${CANCELLED_MARKER}`;
  }

  if (!message.parts) message.parts = [];
  const lastPart = message.parts[message.parts.length - 1];
  if (lastPart?.type === "text") {
    if (!lastPart.text.includes(CANCELLED_MARKER)) {
      lastPart.text = lastPart.text.trim().length > 0 ? `${lastPart.text}\n\n${CANCELLED_MARKER}` : CANCELLED_MARKER;
    }
    return;
  }
  message.parts.push({ id: nextPartId("text"), type: "text", text: CANCELLED_MARKER });
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

function cloneCustomChatParts(parts: CustomChatPart[] | undefined): CustomChatPart[] | undefined {
  if (!Array.isArray(parts)) return undefined;
  return parts
    .map((part) => {
      if (part?.type === "text") {
        return {
          id: String(part.id ?? ""),
          type: "text" as const,
          text: String(part.text ?? ""),
        };
      }
      if (part?.type === "tool") {
        const tool = part.tool;
        return {
          id: String(part.id ?? ""),
          type: "tool" as const,
          tool: {
            callId: String(tool?.callId ?? ""),
            name: String(tool?.name ?? ""),
            argsText: String(tool?.argsText ?? ""),
            status: tool?.status === "done" || tool?.status === "error" ? tool.status : "running",
            ...(tool?.resultText !== undefined ? { resultText: String(tool.resultText) } : {}),
            ...(tool?.error !== undefined ? { error: String(tool.error) } : {}),
          },
        };
      }
      return null;
    })
    .filter((part): part is CustomChatPart => Boolean(part));
}

function serializeMessage(message: CustomChatMessage): CustomSessionMessage {
  const parts = cloneCustomChatParts(message.parts);
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt ?? Date.now(),
    ...(message.error ? { error: true } : {}),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(parts ? { parts } : {}),
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
    currentRunId: "" as string,
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
      this.currentRunId = "";
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
    debugThreadId(sessionIdValue?: string | null): string {
      return customDebugThreadId(sessionIdValue ?? this.currentSessionId);
    },
    currentWorkspaceRootForDebug(): string {
      const existing = this.sessions.find((session) => session.id === this.currentSessionId);
      return String(existing?.workspaceRoot ?? "").trim();
    },
    appendDebugEvent(params: {
      method: string;
      payload?: unknown;
      runId?: string;
      sessionId?: string | null;
      level?: TimelineEventLevel;
      createdAt?: number;
    }) {
      const method = String(params.method ?? "").trim();
      if (!method) return;
      const mappedSessionId = params.runId ? runSessionById.get(params.runId) : undefined;
      const sessionId = String(params.sessionId ?? mappedSessionId ?? this.currentSessionId).trim();
      const payload = params.payload ?? {};
      useDebugTimelineStore().appendEvent({
        threadId: this.debugThreadId(sessionId),
        method,
        paramsText: safeJsonStringify(payload, { space: 2 }),
        params: payload,
        turnId: String(params.runId ?? "").trim() || undefined,
        level: params.level ?? "info",
        hidden: true,
        createdAt: params.createdAt,
      });
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
    async persistCurrentSessionBestEffort(
      snapshot: SessionSnapshotInput | undefined,
      context: { phase: "before_run" | "after_run"; runId: string; sessionId: string }
    ): Promise<void> {
      try {
        await this.persistCurrentSession(snapshot);
      } catch (error: unknown) {
        this.appendDebugEvent({
          method: "custom/session/persist_failed",
          runId: context.runId,
          sessionId: context.sessionId,
          payload: {
            phase: context.phase,
            runId: context.runId,
            sessionId: context.sessionId,
            error,
          },
          level: "warn",
        });
        console.warn("[customChat] persist current session failed", error);
      }
    },
    // 幂等订阅主进程的流式事件。
    ensureStreamSubscription() {
      if (streamUnsubscribe) return;
      streamUnsubscribe = codexDesktop.agent.onEvent((event) => {
        const streamMethodByType: Record<CustomAgentStreamEvent["type"], string> = {
          delta: "custom/stream/delta",
          reasoning: "custom/stream/reasoning",
          tool_call_delta: "custom/tool/call_delta",
          tool_call: "custom/tool/call",
          tool_result: "custom/tool/result",
          tool_error: "custom/tool/error",
          approval_request: "custom/approval/requested",
        };
        this.appendDebugEvent({
          method: streamMethodByType[event.type],
          runId: event.runId,
          payload: summarizeStreamEventForDebug(event),
          level: event.type === "tool_error" ? "error" : "info",
        });
        switch (event.type) {
          case "delta":
            this.applyDelta(event.runId, event.text);
            break;
          case "reasoning":
            this.applyReasoning(event.runId, event.text);
            break;
          case "tool_call_delta":
            this.applyToolCallDelta(event.runId, event.callId, event.name, event.argsTextDelta);
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
    // 流式期间按 callId 累积工具调用参数：首个增量创建 running tool part，
    // 后续增量把 argsText 片段拼接上去。最终的 tool_call 事件由 startTool 覆盖为权威值。
    applyToolCallDelta(runId: string, callId: string | undefined, name: string | undefined, argsTextDelta: string) {
      if (!callId) return;
      const message = this.findAssistantByRun(runId);
      if (!message) return;
      if (!message.parts) message.parts = [];
      const existing = message.parts.find(
        (item): item is CustomChatToolPart => item.type === "tool" && item.tool.callId === callId
      );
      if (existing) {
        existing.tool.argsText += argsTextDelta;
        if (name && !existing.tool.name) existing.tool.name = name;
      } else {
        message.parts.push({
          id: `tool-${callId}`,
          type: "tool",
          tool: { callId, name: name ?? "", argsText: argsTextDelta, status: "running" },
        });
      }
      this.schedulePersistCurrentSession();
    },
    startTool(runId: string, callId: string, name: string, argsText: string) {
      const message = this.findAssistantByRun(runId);
      if (!message) return;
      if (!message.parts) message.parts = [];
      // tool_call_delta 可能已为这次调用建好 part：用权威值覆盖，不重复 push。
      const existing = message.parts.find(
        (item): item is CustomChatToolPart => item.type === "tool" && item.tool.callId === callId
      );
      if (existing) {
        existing.tool.name = name;
        existing.tool.argsText = argsText;
        this.schedulePersistCurrentSession();
        return;
      }
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
      this.appendDebugEvent({
        method: "custom/approval/responding",
        runId: request.runId,
        payload: {
          runId: request.runId,
          approvalId,
          approved,
          kind: request.kind,
          title: request.title,
          detail: summarizeDebugText(request.detail),
        },
      });
      this.pendingApprovals.splice(idx, 1);
      try {
        const result = await codexDesktop.agent.approve({ runId: request.runId, approvalId, approved });
        this.appendDebugEvent({
          method: "custom/approval/resolved",
          runId: request.runId,
          payload: {
            runId: request.runId,
            approvalId,
            approved,
            ok: result.ok,
          },
          level: result.ok ? "info" : "warn",
        });
      } catch (error: unknown) {
        this.appendDebugEvent({
          method: "custom/approval/failed",
          runId: request.runId,
          payload: {
            runId: request.runId,
            approvalId,
            approved,
            error,
          },
          level: "error",
        });
        throw error;
      }
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
      this.currentRunId = runId;
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
      const runSessionId = this.currentSessionId;
      this.appendDebugEvent({
        method: "custom/run/start",
        runId,
        sessionId: runSessionId,
        payload: {
          runId,
          sessionId: runSessionId,
          providerId: providerId ?? null,
          providerLabel: opts?.providerLabel ?? null,
          workspaceRoot: opts?.workspaceRoot ?? null,
          userMessage: summarizeDebugText(content),
          history: summarizeDebugMessages(history),
        },
      });
      try {
        await this.persistCurrentSessionBestEffort(opts, {
          phase: "before_run",
          runId,
          sessionId: runSessionId,
        });
        const result = await codexDesktop.agent.run({ runId, providerId, messages: history });
        const message = this.messages.find((item) => item.id === assistantId);
        if (message) {
          message.streaming = false;
          message.runId = undefined;
          if (result.ok) {
            if (result.cancelled) {
              markMessageCancelled(message);
            } else {
              const hasTextPart = Boolean(message.parts?.some((part) => part.type === "text" && part.text.length > 0));
              if (!hasTextPart) {
                const text = result.finalText || "(模型返回了空内容)";
                message.content = text;
                message.parts = [...(message.parts ?? []), { id: nextPartId("text"), type: "text", text }];
              }
            }
          } else {
            message.content = result.error;
            message.error = true;
          }
        }
        this.appendDebugEvent({
          method: result.ok
            ? result.cancelled
              ? "custom/run/cancelled"
              : "custom/run/completed"
            : "custom/run/failed",
          runId,
          sessionId: runSessionId,
          payload: {
            runId,
            sessionId: runSessionId,
            providerId: providerId ?? null,
            ok: result.ok,
            ...(result.ok
              ? {
                  steps: result.steps,
                  cancelled: Boolean(result.cancelled),
                  finalText: summarizeDebugText(result.finalText),
                }
              : {
                  error: summarizeDebugText(result.error),
                }),
            assistantMessage: summarizeDebugMessage(message),
          },
          level: result.ok ? "info" : "error",
        });
      } catch (error: unknown) {
        const messageText = error instanceof Error ? error.message : String(error);
        const message = this.messages.find((item) => item.id === assistantId);
        if (message) {
          message.streaming = false;
          message.runId = undefined;
          message.content = messageText;
          message.error = true;
        }
        this.appendDebugEvent({
          method: "custom/run/thrown",
          runId,
          sessionId: runSessionId,
          payload: {
            runId,
            sessionId: runSessionId,
            providerId: providerId ?? null,
            error,
            assistantMessage: summarizeDebugMessage(message),
          },
          level: "error",
        });
      } finally {
        // 本轮残留的挂起审批（理论上主进程已兜底拒绝）从队列清掉，避免悬挂卡片。
        this.pendingApprovals = this.pendingApprovals.filter((item) => item.runId !== runId);
        runSessionById.delete(runId);
        this.currentRunId = "";
        this.sending = false;
        await this.persistCurrentSessionBestEffort(opts, {
          phase: "after_run",
          runId,
          sessionId: runSessionId,
        });
      }
    },
    async cancelCurrentRun(): Promise<boolean> {
      if (!this.currentRunId || !this.sending) return false;
      const runId = this.currentRunId;
      const sessionId = runSessionById.get(runId) ?? this.currentSessionId;

      this.appendDebugEvent({
        method: "custom/run/cancel_requested",
        runId,
        sessionId,
        payload: { runId, sessionId },
      });

      try {
        const result = await codexDesktop.agent.cancel({ runId });
        if (result.ok) {
          // 找到当前流式消息并标记为已取消
          const message = this.messages.find((item) => item.runId === runId && item.role === "assistant");
          if (message) {
            message.streaming = false;
            message.runId = undefined;
            markMessageCancelled(message);
          }

          this.currentRunId = "";
          this.sending = false;
          this.pendingApprovals = [];
          await this.persistCurrentSession();
          this.appendDebugEvent({
            method: "custom/run/cancel_result",
            runId,
            sessionId,
            payload: {
              runId,
              sessionId,
              ok: true,
              assistantMessage: summarizeDebugMessage(message),
            },
          });
          return true;
        }
        this.appendDebugEvent({
          method: "custom/run/cancel_result",
          runId,
          sessionId,
          payload: { runId, sessionId, ok: false },
          level: "warn",
        });
        return false;
      } catch (error) {
        this.appendDebugEvent({
          method: "custom/run/cancel_failed",
          runId,
          sessionId,
          payload: { runId, sessionId, error },
          level: "error",
        });
        console.error("Failed to cancel run:", error);
        return false;
      }
    },
  },
});
