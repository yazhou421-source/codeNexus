import {
  runAgent,
  createChatCompletionsClient,
  createAnthropicClient,
  createGeminiClient,
  createWorkspaceTools,
  createCommandTools,
  type AgentMessage,
  type ToolDefinition,
} from "@codenexus/agent-core";
import type {
  CustomAgentApproveArgs,
  CustomAgentRunArgs,
  CustomAgentRunResult,
  CustomAgentStreamEvent,
} from "@codenexus/shared/ipc/contracts";
import type { LocalCustomProvider } from "@codenexus/shared/localSettings";
import type { LocalSettingsService } from "./LocalSettingsService";
import { logger } from "../utils/logger";

/**
 * 自定义运行时服务：脱离 codex-app-server，直接用 agent-core 内核驱动用户配置的 provider。
 *
 * 支持三种协议（按 provider.kind 选择对应 ChatClient，内核 runAgent 无感知）：
 * - openai-compatible → createChatCompletionsClient
 * - anthropic → createAnthropicClient（Messages API）
 * - gemini → createGeminiClient（generateContent）
 *
 * 流式：runAgent 优先走 ChatClient.stream，经 emit 把文本增量 / 工具活动回吐到渲染层。
 * 工具：始终挂上 agent-core 的文件 + 命令工具；配了 workspaceRoot 时沙箱在工作区，
 *   未选择工作区时走系统工具根。写改文件 / 执行命令前经 requireApproval/requireConfirmation 弹审批——
 *   emit 一条 approval_request 并挂起 Promise，等 renderer 经 resolveApproval 回传决策再继续。
 * provider 连接信息（含 apiKey）从 LocalSettingsService 读取，apiKey 在该服务内已解密为明文。
 */
type EmitFn = (event: CustomAgentStreamEvent) => void;

// 未配置 contextLimit 时的默认输入侧上下文窗口（估算 tokens）。
const DEFAULT_CONTEXT_LIMIT = 200_000;

function approvalKey(runId: string, approvalId: string): string {
  return `${runId}:${approvalId}`;
}

export class CustomAgentService {
  // 挂起中的审批：key=`${runId}:${approvalId}`，value 是等待用户决策的 Promise resolver。
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();

  // 当前活跃的运行：runId -> AbortController，用于支持外部取消。
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(private readonly localSettingsService: LocalSettingsService) {}

  async run(args: CustomAgentRunArgs, emit?: EmitFn): Promise<CustomAgentRunResult> {
    const runId = String(args?.runId ?? "").trim();
    const controller = new AbortController();

    if (runId) {
      this.activeRuns.set(runId, controller);
    }

    try {
      const provider = await this.resolveProvider(args?.providerId);
      if (!provider) {
        return { ok: false, error: "未配置可用的自定义 provider，请先在自定义模式里添加并选择一个 provider。" };
      }
      const baseUrl = provider.baseUrl;
      if (!baseUrl) return { ok: false, error: "provider 的 Base URL 未配置。" };
      const apiKey = provider.apiKey;
      if (!apiKey) return { ok: false, error: "provider 的 API Key 未配置。" };
      const model = provider.model;
      if (!model) return { ok: false, error: "provider 的模型名未配置。" };

      const messages = this.toAgentMessages(args?.messages);
      if (messages.length === 0) return { ok: false, error: "对话内容为空。" };

      // maxOutputTokens 是统一的「最大输出 tokens」语义：OpenAI/Anthropic 读 maxTokens、
      // Gemini 读 maxOutputTokens，这里同时给两个键，各 client 只取自己认识的那个。
      const maxOutputTokens = provider.maxOutputTokens ?? undefined;
      const options = {
        baseUrl,
        apiKey,
        model,
        thinking: provider.thinking,
        maxTokens: maxOutputTokens,
        maxOutputTokens,
      };
      const client =
        provider.kind === "anthropic"
          ? createAnthropicClient(options)
          : provider.kind === "gemini"
            ? createGeminiClient(options)
            : createChatCompletionsClient(options);

      const toolRoot = await this.resolveToolRoot();
      const tools = this.buildTools(toolRoot, runId, emit);

      const result = await runAgent({
        client,
        tools,
        messages,
        // 未配置上下文上限时回退到默认窗口（200000），避免历史无限增长后超出模型上限。
        contextLimit: provider.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
        signal: controller.signal,
        // 把内核事件映射成渲染层的 CustomAgentStreamEvent（带上 runId 以便按消息关联）。
        onEvent:
          emit && runId
            ? (event) => {
                if (event.type === "assistant_message_delta") {
                  emit({ type: "delta", runId, text: event.delta });
                } else if (event.type === "assistant_reasoning_delta") {
                  emit({ type: "reasoning", runId, text: event.delta });
                } else if (event.type === "tool_call_delta") {
                  emit({
                    type: "tool_call_delta",
                    runId,
                    index: event.index,
                    callId: event.callId,
                    name: event.name,
                    argsTextDelta: event.argsTextDelta,
                  });
                } else if (event.type === "tool_call") {
                  emit({
                    type: "tool_call",
                    runId,
                    callId: event.call.id,
                    name: event.call.name,
                    argsText: event.call.arguments,
                  });
                } else if (event.type === "tool_result") {
                  emit({
                    type: "tool_result",
                    runId,
                    callId: event.toolCallId,
                    name: event.name,
                    resultText: event.result,
                  });
                } else if (event.type === "tool_error") {
                  emit({ type: "tool_error", runId, callId: event.toolCallId, name: event.name, error: event.error });
                } else if (event.type === "usage") {
                  emit({ type: "usage", runId, usage: event.usage });
                }
              }
            : undefined,
      });
      return {
        ok: true,
        finalText: result.finalText,
        steps: result.steps,
        cancelled: result.cancelled,
        lastUsage: result.lastUsage,
        totalOutputTokens: result.totalOutputTokens,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("custom-agent", "run failed", message);
      return { ok: false, error: message };
    } finally {
      // 清理活跃运行记录
      if (runId) {
        this.activeRuns.delete(runId);
      }
      // run 结束仍未决的审批一律解为「拒绝」，避免内核里 await 的工具永久挂起。
      this.rejectPendingApprovals(runId);
    }
  }

  /** renderer 经 agent:approve 回传一次决策：解开对应挂起的审批 Promise。 */
  resolveApproval(args: CustomAgentApproveArgs): { ok: boolean } {
    const runId = String(args?.runId ?? "").trim();
    const approvalId = String(args?.approvalId ?? "").trim();
    const key = approvalKey(runId, approvalId);
    const resolver = this.pendingApprovals.get(key);
    if (!resolver) return { ok: false };
    this.pendingApprovals.delete(key);
    resolver(Boolean(args?.approved));
    return { ok: true };
  }

  /**
   * 取消正在运行的 agent：触发对应的 AbortController，中止 runAgent 循环。
   * 同时清理该 runId 的所有挂起审批。
   */
  cancel(runId: string): { ok: boolean } {
    const id = String(runId ?? "").trim();
    if (!id) return { ok: false };

    const controller = this.activeRuns.get(id);
    if (!controller) return { ok: false };

    controller.abort();
    this.activeRuns.delete(id);
    this.rejectPendingApprovals(id);

    return { ok: true };
  }

  /**
   * Build tool set for workspace. Tools are sandboxed to toolRoot.
   * Write operations require approval via ask() callback; if runId/emit missing, safely defaults to rejection.
   */
  private buildTools(toolRoot: string, runId: string, emit?: EmitFn): ToolDefinition[] {
    const canApprove = Boolean(emit && runId);
    let approvalSeq = 0;
    const ask = (kind: "command" | "file", title: string, detail: string): Promise<boolean> => {
      if (!canApprove || !emit) return Promise.resolve(false);
      approvalSeq += 1;
      const approvalId = `ap-${approvalSeq}`;
      return new Promise<boolean>((resolvePromise) => {
        this.pendingApprovals.set(approvalKey(runId, approvalId), resolvePromise);
        emit({ type: "approval_request", runId, approvalId, kind, title, detail });
      });
    };

    const workspaceTools = createWorkspaceTools(toolRoot, {
      requireApproval: (op) => ask("file", op.tool, op.details),
    });
    const commandTools = createCommandTools({
      cwd: toolRoot,
      requireConfirmation: (command) => ask("command", "run_command", command),
    });
    return [...workspaceTools, ...commandTools];
  }

  private rejectPendingApprovals(runId: string): void {
    if (!runId) return;
    const prefix = `${runId}:`;
    for (const [key, resolver] of this.pendingApprovals.entries()) {
      if (key.startsWith(prefix)) {
        this.pendingApprovals.delete(key);
        resolver(false);
      }
    }
  }

  private async resolveToolRoot(): Promise<string> {
    const { settings } = await this.localSettingsService.read();
    const root = String(settings.customProviders.workspaceRoot ?? "").trim();
    return root || process.cwd();
  }

  private async resolveProvider(providerId?: string): Promise<LocalCustomProvider | null> {
    const { settings } = await this.localSettingsService.read();
    const { providers, activeProviderId } = settings.customProviders;
    const targetId = String(providerId ?? activeProviderId ?? "").trim();
    if (!targetId) return null;
    return providers.find((item) => item.id === targetId) ?? null;
  }

  private toAgentMessages(messages: CustomAgentRunArgs["messages"]): AgentMessage[] {
    if (!Array.isArray(messages)) return [];
    return messages
      .filter((message) => message && typeof message.content === "string")
      .map((message) => ({ role: message.role, content: message.content }));
  }
}
