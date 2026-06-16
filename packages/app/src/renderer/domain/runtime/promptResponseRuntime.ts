import type { JsonValue } from "@codenexus/generated/codex-app-server/serde_json/JsonValue";
import type { GrantedPermissionProfile } from "@codenexus/generated/codex-app-server/v2/GrantedPermissionProfile";
import type { useApprovalStore } from "../../stores/approval.store";
import type { useRuntimeStore } from "../../stores/runtime.store";
import type { useUserInputStore } from "../../stores/userInput.store";
import { safeJsonStringify } from "../../utils/safeJson";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ApprovalStore = ReturnType<typeof useApprovalStore>;
type UserInputStore = ReturnType<typeof useUserInputStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;
type CodexRespond = (args: {
  serverId: string;
  id: string | number;
  method: string;
  result?: unknown;
  error?: { code: number; message: string };
}) => Promise<unknown>;

export type PromptResponseRuntimeDeps = {
  appTimelineId: string;
  runtimeStore: RuntimeStore;
  approvalStore: ApprovalStore;
  userInputStore: UserInputStore;
  respond: CodexRespond;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type PromptResponseRuntime = {
  submitUserInputPromptForThread: (threadIdValue: unknown) => Promise<void>;
  cancelUserInputPromptForThread: (threadIdValue: unknown) => Promise<void>;
  submitActiveUserInputPrompt: () => Promise<void>;
  cancelActiveUserInputPrompt: () => Promise<void>;
  submitActiveApprovalPrompt: (decisionRaw: unknown) => Promise<void>;
  dismissActiveApprovalPrompt: () => void;
};

function toGrantedPermissionProfile(value: {
  network?: GrantedPermissionProfile["network"] | null;
  fileSystem?: GrantedPermissionProfile["fileSystem"] | null;
}): GrantedPermissionProfile {
  return {
    ...(value.network ? { network: value.network } : {}),
    ...(value.fileSystem ? { fileSystem: value.fileSystem } : {}),
  };
}

function toPlainObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function isEmptyMcpElicitationSchema(value: unknown): boolean {
  const schema = toPlainObjectRecord(value);
  if (!schema || schema.type !== "object") return false;
  const properties = toPlainObjectRecord(schema.properties);
  if (!properties || Object.keys(properties).length > 0) return false;
  const hasRequired = Array.isArray(schema.required)
    ? schema.required.some((item) => String(item ?? "").trim())
    : false;
  return !hasRequired;
}

export function createPromptResponseRuntime(deps: PromptResponseRuntimeDeps): PromptResponseRuntime {
  const { appTimelineId, runtimeStore, approvalStore, userInputStore, respond, pushEvent, showToast } = deps;

  const submitUserInputPromptForThread = async (threadIdValue: unknown) => {
    const tid = String(threadIdValue ?? "").trim();
    if (!tid) return;
    const prompt = userInputStore.activePromptForThread(tid);
    if (!prompt) return;
    const promptThreadId = String(prompt.threadId || tid).trim();
    if (!promptThreadId) return;
    try {
      if (prompt.kind === "questions") {
        const answers: Record<string, { answers: string[] }> = {};
        for (const question of prompt.questions) {
          const draft = userInputStore.getDraft(promptThreadId, prompt.requestId, question.id);
          const normalized = draft.map((answer) => answer.trim()).filter(Boolean);
          if (normalized.length === 0) {
            const detail = `问题未作答：${question.header}`;
            pushEvent("plan:input:error", detail, { threadId: promptThreadId || appTimelineId, level: "error" });
            showToast({ kind: "warn", title: "问答未完成", message: detail });
            return;
          }
          answers[question.id] = { answers: normalized };
        }

        await respond({
          serverId: prompt.serverId,
          id: prompt.requestId,
          method: prompt.method,
          result: { answers },
        });
        pushEvent("plan:input", `已提交问答（${prompt.questions.length} 题）`, {
          threadId: promptThreadId || appTimelineId,
        });
      } else if (prompt.kind === "elicitationForm") {
        const question = prompt.questions[0];
        if (!question) return;
        const draft = userInputStore.getDraft(promptThreadId, prompt.requestId, question.id);
        const raw = String(draft[0] ?? "").trim();
        const isEmptySchema = isEmptyMcpElicitationSchema(prompt.requestedSchema);
        if (!raw && !isEmptySchema) {
          const detail = `MCP 输入未完成：${prompt.serverName}`;
          pushEvent("mcp:elicitation:error", detail, { threadId: promptThreadId || appTimelineId, level: "error" });
          showToast({ kind: "warn", title: "输入未完成", message: detail });
          return;
        }

        let content: JsonValue = {};
        try {
          if (raw) content = JSON.parse(raw) as JsonValue;
        } catch {
          const detail = "MCP 输入必须是合法 JSON";
          pushEvent("mcp:elicitation:error", detail, { threadId: promptThreadId || appTimelineId, level: "error" });
          showToast({ kind: "warn", title: "JSON 无效", message: detail });
          return;
        }

        await respond({
          serverId: prompt.serverId,
          id: prompt.requestId,
          method: prompt.method,
          result: { action: "accept", content, _meta: null },
        });
        pushEvent("mcp:elicitation", `已提交 MCP 输入（${prompt.serverName}）`, {
          threadId: promptThreadId || appTimelineId,
        });
      } else {
        await respond({
          serverId: prompt.serverId,
          id: prompt.requestId,
          method: prompt.method,
          result: { action: "accept", content: null, _meta: null },
        });
        pushEvent("mcp:elicitation", `已确认 MCP 链接操作（${prompt.serverName}）`, {
          threadId: promptThreadId || appTimelineId,
        });
      }

      userInputStore.completeActivePrompt(promptThreadId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message || e.name : String(e ?? "");
      const eventMethod =
        prompt.method === "mcpServer/elicitation/request" ? "mcp:elicitation:error" : "plan:input:error";
      const title =
        prompt.method === "mcpServer/elicitation/request"
          ? "MCP 输入提交失败"
          : "问答提交失败";
      pushEvent(eventMethod, msg, { threadId: promptThreadId || appTimelineId, level: "error" });
      showToast({ kind: "error", title, message: msg });
    }
  };

  const cancelUserInputPromptForThread = async (threadIdValue: unknown) => {
    const tid = String(threadIdValue ?? "").trim();
    if (!tid) return;
    const prompt = userInputStore.activePromptForThread(tid);
    if (!prompt) return;
    const promptThreadId = String(prompt.threadId || tid).trim();
    if (!promptThreadId) return;
    try {
      if (prompt.method === "mcpServer/elicitation/request") {
        await respond({
          serverId: prompt.serverId,
          id: prompt.requestId,
          method: prompt.method,
          result: { action: "cancel", content: null, _meta: null },
        });
        pushEvent("mcp:elicitation:cancel", `${prompt.method} (id=${prompt.requestId})`, {
          threadId: promptThreadId || appTimelineId,
          level: "warn",
        });
      } else {
        await respond({
          serverId: prompt.serverId,
          id: prompt.requestId,
          method: prompt.method,
          error: { code: 4001, message: "request_user_input cancelled by user" },
        });
        pushEvent("plan:input:cancel", `${prompt.method} (id=${prompt.requestId})`, {
          threadId: promptThreadId || appTimelineId,
          level: "warn",
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message || e.name : String(e ?? "");
      pushEvent(prompt.method === "mcpServer/elicitation/request" ? "mcp:elicitation:error" : "plan:input:error", msg, {
        threadId: promptThreadId || appTimelineId,
        level: "error",
      });
      showToast({
        kind: "error",
        title:
          prompt.method === "mcpServer/elicitation/request"
            ? "取消 MCP 输入失败"
            : "取消问答失败",
        message: msg,
      });
    } finally {
      userInputStore.completeActivePrompt(promptThreadId);
    }
  };

  const submitActiveUserInputPrompt = async () => {
    const tid = String(runtimeStore.currentThreadId ?? "").trim();
    if (!tid) return;
    await submitUserInputPromptForThread(tid);
  };

  const cancelActiveUserInputPrompt = async () => {
    const tid = String(runtimeStore.currentThreadId ?? "").trim();
    if (!tid) return;
    await cancelUserInputPromptForThread(tid);
  };

  const dismissActiveApprovalPrompt = () => {
    const prompt = approvalStore.activePrompt;
    if (!prompt) return;
    approvalStore.remove(prompt.serverId, prompt.requestId);
  };

  const submitActiveApprovalPrompt = async (decisionRaw: unknown) => {
    const prompt = approvalStore.activePrompt;
    if (!prompt) return;
    const decision = decisionRaw;
    if (typeof decision === "string" && !decision.trim()) return;
    if (decision == null) return;

    const threadId = prompt.threadId || runtimeStore.currentThreadId || appTimelineId;

    try {
      if (prompt.method === "item/fileChange/requestApproval") {
        await respond({
          serverId: prompt.serverId,
          id: prompt.requestId,
          method: prompt.method,
          result: { decision },
        });
        const decisionText = typeof decision === "string" ? decision : safeJsonStringify(decision, { space: 0 });
        const level = typeof decisionText === "string" && decisionText.startsWith("accept") ? "info" : "warn";
        pushEvent("approval:fileChange", `decision=${decisionText}`, { threadId, level });
      } else if (prompt.method === "item/commandExecution/requestApproval") {
        await respond({
          serverId: prompt.serverId,
          id: prompt.requestId,
          method: prompt.method,
          result: { decision },
        });
        const decisionText = typeof decision === "string" ? decision : safeJsonStringify(decision, { space: 0 });
        const normalized = typeof decisionText === "string" ? decisionText : "";
        const level = normalized.includes("decline") || normalized.includes("cancel") ? "warn" : "info";
        pushEvent("approval:commandExecution", `decision=${decisionText}`, { threadId, level });
      } else if (prompt.method === "item/permissions/requestApproval") {
        const normalizedDecision = typeof decision === "string" ? decision.trim().toLowerCase() : "";
        if (normalizedDecision === "turn" || normalizedDecision === "session") {
          await respond({
            serverId: prompt.serverId,
            id: prompt.requestId,
            method: prompt.method,
            result: {
              permissions: toGrantedPermissionProfile(prompt.params.permissions),
              scope: normalizedDecision,
            },
          });
          pushEvent("approval:permissions", `scope=${normalizedDecision}`, { threadId, level: "info" });
        } else {
          const message =
            normalizedDecision === "cancel"
              ? "permissions request cancelled by user"
              : "permissions request declined by user";
          await respond({
            serverId: prompt.serverId,
            id: prompt.requestId,
            method: prompt.method,
            error: { code: 4001, message },
          });
          pushEvent("approval:permissions", `decision=${normalizedDecision || "decline"}`, { threadId, level: "warn" });
        }
      }

      approvalStore.remove(prompt.serverId, prompt.requestId);
      const decisionText = typeof decision === "string" ? decision : safeJsonStringify(decision, { space: 0 });
      showToast({
        kind: "success",
        title: "已提交审批",
        message: `decision=${decisionText}`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message || e.name : String(e ?? "");
      pushEvent("approval:error", msg, { threadId, level: "error" });
      showToast({ kind: "error", title: "审批提交失败", message: msg });
    }
  };

  return {
    submitUserInputPromptForThread,
    cancelUserInputPromptForThread,
    submitActiveUserInputPrompt,
    cancelActiveUserInputPrompt,
    submitActiveApprovalPrompt,
    dismissActiveApprovalPrompt,
  };
}
