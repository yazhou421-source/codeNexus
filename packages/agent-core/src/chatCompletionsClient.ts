import type {
  AgentMessage,
  ChatClient,
  ChatRequestOptions,
  ChatStreamHandlers,
  ModelReply,
  TokenUsage,
  ToolDefinition,
  ToolCall,
} from "./types";
import { readSseBlocks } from "./sse";
import { postJson } from "./http";
import { parseOpenAiUsage } from "./usage";

/**
 * 真实的 ChatClient 实现：直连 OpenAI 兼容的 /v1/chat/completions 接口。
 *
 * 这是内核与「真实模型」之间唯一的接缝实现。只要某个 Provider 兼容
 * Chat Completions 协议（OpenAI、DeepSeek、Kimi、各类中转站、本地 ollama/vLLM…），
 * 填上 baseUrl + apiKey + model 即可驱动同一个 runAgent 内核。
 *
 * 同时实现 send（非流式，一次拿回完整回复）与 stream（SSE：stream:true，readSseBlocks 累积
 * content delta 与按 index 聚合的 tool_calls）；内核 runAgent 优先走 stream 以驱动逐字 UI。
 */

export type ChatCompletionsClientOptions = {
  /** 形如 https://host/v1，末尾不带斜杠。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** max_tokens（最大输出 tokens）；未设或 ≤0 时默认 65536。 */
  maxTokens?: number;
  /** 单次请求超时（毫秒），默认 120s。 */
  timeoutMs?: number;
  /** 透传给上游的可选采样参数。 */
  temperature?: number;
};

type WireMessage = Record<string, unknown>;

function resolveEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/g, "");
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

/** 把内核的 AgentMessage 转成 Chat Completions 线缆格式（camelCase → snake_case）。 */
function toWireMessage(message: AgentMessage): WireMessage {
  if (
    message.role === "assistant" &&
    message.toolCalls &&
    message.toolCalls.length > 0
  ) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content ?? "",
    };
  }
  return { role: message.role, content: message.content ?? "" };
}

/** 把工具定义转成 Chat Completions 的 tools 数组。 */
function toWireTool(tool: ToolDefinition): WireMessage {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/** 从上游返回的 message 中提取工具调用，归一成内核的 ToolCall。 */
function extractToolCalls(rawToolCalls: unknown): ToolCall[] {
  if (!Array.isArray(rawToolCalls)) return [];
  const calls: ToolCall[] = [];
  for (const raw of rawToolCalls) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const fn = record.function as Record<string, unknown> | undefined;
    const name = typeof fn?.name === "string" ? fn.name : "";
    if (!name) continue;
    calls.push({
      id:
        typeof record.id === "string" && record.id
          ? record.id
          : `call_${calls.length}`,
      name,
      arguments: typeof fn?.arguments === "string" ? fn.arguments : "",
    });
  }
  return calls;
}

export function createChatCompletionsClient(
  options: ChatCompletionsClientOptions,
): ChatClient {
  const endpoint = resolveEndpoint(options.baseUrl);
  const timeoutMs = options.timeoutMs ?? 120_000;
  // 默认输出上限 65536，足以一次写完较大的文件，避免工具参数 JSON 被中途截断成 {}。
  const maxTokens =
    options.maxTokens && options.maxTokens > 0 ? options.maxTokens : 65536;

  return {
    async send(
      messages: AgentMessage[],
      tools: ToolDefinition[],
      request?: ChatRequestOptions,
    ): Promise<ModelReply> {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: messages.map(toWireMessage),
      };
      if (tools.length > 0) body.tools = tools.map(toWireTool);
      if (typeof options.temperature === "number")
        body.temperature = options.temperature;
      if (maxTokens) body.max_tokens = maxTokens;

      const response = await postJson(endpoint, {
        headers: { authorization: `Bearer ${options.apiKey}` },
        body,
        timeoutMs,
        errorLabel: "chat/completions",
        signal: request?.signal,
      });

      const json = (await response.json()) as Record<string, unknown>;
      const choices = Array.isArray(json.choices) ? json.choices : [];
      const first = choices[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      const content =
        typeof message?.content === "string" ? message.content : null;
      const reasoning =
        typeof message?.reasoning_content === "string"
          ? message.reasoning_content
          : null;
      const toolCalls = extractToolCalls(message?.tool_calls);
      // finish_reason === "length" 表示被 max_tokens 截断（工具参数 JSON 可能不完整）。
      const truncated = first?.finish_reason === "length";

      return {
        content,
        toolCalls,
        reasoning,
        truncated,
        usage: parseOpenAiUsage(json.usage),
      };
    },

    async stream(
      messages: AgentMessage[],
      tools: ToolDefinition[],
      handlers: ChatStreamHandlers,
      request?: ChatRequestOptions,
    ): Promise<ModelReply> {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: messages.map(toWireMessage),
        stream: true,
        // 流式下 usage 默认不返回；必须显式开启才会在末尾追加一个 usage 帧。
        // 个别中转站可能忽略或拒绝此参数：拒绝时 usage 留空、UI 回退估算，不影响对话。
        stream_options: { include_usage: true },
      };
      if (tools.length > 0) body.tools = tools.map(toWireTool);
      if (typeof options.temperature === "number")
        body.temperature = options.temperature;
      if (maxTokens) body.max_tokens = maxTokens;

      const response = await postJson(endpoint, {
        headers: { authorization: `Bearer ${options.apiKey}` },
        body,
        timeoutMs,
        errorLabel: "chat/completions stream",
        stream: true,
        signal: request?.signal,
      });

      let content = "";
      let reasoning = "";
      let finishReason = "";
      let usage: TokenUsage | undefined;
      const toolAcc = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      for await (const { data } of readSseBlocks(response)) {
        if (data === "[DONE]") break;
        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        // 200 流中途的错误帧：上游开了 SSE 后才报错（限流/内容过滤/中转故障）。
        // 不抛出的话会被当成正常完成（truncated=false），run 在残缺回复上继续。
        const streamError = chunk.error;
        if (streamError) {
          const detail =
            typeof streamError === "object" && streamError
              ? ((streamError as Record<string, unknown>).message ??
                JSON.stringify(streamError))
              : String(streamError);
          throw new Error(`chat/completions stream error: ${detail}`);
        }
        // usage 在末尾一个独立帧（choices 为空数组）；不能依赖 choices[0]。
        if (chunk.usage) usage = parseOpenAiUsage(chunk.usage) ?? usage;
        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        const choice = choices[0] as Record<string, unknown> | undefined;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
        const delta = choice?.delta as Record<string, unknown> | undefined;
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
          handlers.onTextDelta(delta.content);
        }
        if (
          typeof delta.reasoning_content === "string" &&
          delta.reasoning_content
        ) {
          reasoning += delta.reasoning_content;
          handlers.onReasoningDelta?.(delta.reasoning_content);
        }
        const rawToolCalls = Array.isArray(delta.tool_calls)
          ? delta.tool_calls
          : [];
        for (const rawToolCall of rawToolCalls) {
          if (!rawToolCall || typeof rawToolCall !== "object") continue;
          const record = rawToolCall as Record<string, unknown>;
          const index = typeof record.index === "number" ? record.index : 0;
          const state = toolAcc.get(index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          if (typeof record.id === "string" && record.id) state.id = record.id;
          const fn = record.function as Record<string, unknown> | undefined;
          if (typeof fn?.name === "string" && fn.name) state.name = fn.name;
          const argsFragment =
            typeof fn?.arguments === "string" ? fn.arguments : "";
          if (argsFragment) state.arguments += argsFragment;
          toolAcc.set(index, state);
          // 回吐参数增量：name 在首个片段里通常已确定，后续片段只带增量。
          if (argsFragment || (typeof fn?.name === "string" && fn.name)) {
            handlers.onToolCallDelta?.({
              index,
              callId: state.id || undefined,
              name: state.name || undefined,
              argsTextDelta: argsFragment,
            });
          }
        }
      }

      const toolCalls: ToolCall[] = [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([index, state]) => ({
          id: state.id || `call_${index}`,
          name: state.name,
          arguments: state.arguments,
        }))
        .filter((call) => call.name);

      return {
        content: content || null,
        toolCalls,
        reasoning: reasoning || null,
        truncated: finishReason === "length",
        usage,
      };
    },
  };
}
