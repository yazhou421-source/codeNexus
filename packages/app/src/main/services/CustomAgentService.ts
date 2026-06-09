import {
  runAgent,
  createChatCompletionsClient,
  createAnthropicClient,
  createGeminiClient,
  createFileTools,
  createCommandTools,
  ProcessRegistry,
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

function approvalKey(runId: string, approvalId: string): string {
  return `${runId}:${approvalId}`;
}

export class CustomAgentService {
  // 挂起中的审批：key=`${runId}:${approvalId}`，value 是等待用户决策的 Promise resolver。
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(private readonly localSettingsService: LocalSettingsService) {}

  async run(args: CustomAgentRunArgs, emit?: EmitFn): Promise<CustomAgentRunResult> {
    const runId = String(args?.runId ?? "").trim();
    // 每次 run 一个独立的进程登记簿；run 结束统一 killAll，避免后台进程泄漏。
    const registry = new ProcessRegistry();
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

      const options = { baseUrl, apiKey, model, thinking: provider.thinking };
      const client =
        provider.kind === "anthropic"
          ? createAnthropicClient(options)
          : provider.kind === "gemini"
            ? createGeminiClient(options)
            : createChatCompletionsClient(options);

      const toolRoot = await this.resolveToolRoot();
      const tools = this.buildTools(toolRoot, runId, registry, emit);

      const result = await runAgent({
        client,
        tools,
        messages,
        // 把内核事件映射成渲染层的 CustomAgentStreamEvent（带上 runId 以便按消息关联）。
        onEvent:
          emit && runId
            ? (event) => {
                if (event.type === "assistant_message_delta") {
                  emit({ type: "delta", runId, text: event.delta });
                } else if (event.type === "assistant_reasoning_delta") {
                  emit({ type: "reasoning", runId, text: event.delta });
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
                }
              }
            : undefined,
      });
      return { ok: true, finalText: result.finalText, steps: result.steps };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("custom-agent", "run failed", message);
      return { ok: false, error: message };
    } finally {
      registry.killAll();
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
   * 按工具根构建工具集；未选择 workspace 时也使用系统工具根，保持工具可用。
   * 写改文件 / 执行命令前调用 ask() 走审批回环；没有 runId/emit 无法回环时安全兜底为拒绝。
   */
  private buildTools(toolRoot: string, runId: string, registry: ProcessRegistry, emit?: EmitFn): ToolDefinition[] {
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

    const fileTools = createFileTools(toolRoot, {
      requireApproval: (op) => ask("file", `${op.tool} · ${op.path}`, op.preview),
    });
    const commandTools = createCommandTools({
      cwd: toolRoot,
      registry,
      requireConfirmation: (command) => ask("command", "执行命令", command),
    });
    return [...fileTools, ...commandTools];
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
