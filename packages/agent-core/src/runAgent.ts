import type {
  AgentMessage,
  ChatClient,
  ModelReply,
  RunAgentOptions,
  RunAgentResult,
  ToolCall,
  ToolDefinition,
} from "./types";
import { trimMessageHistory } from "./contextWindow";

const DEFAULT_MAX_STEPS = 16;

/**
 * 把模型生成的 JSON 字符串参数安全地解析成对象。
 *
 * 模型偶尔会吐出空串、非法 JSON 或非对象（如数组/数字），这里统一兜底为 {}，
 * 把「参数到底合不合法」的判断交给工具自身，避免内核因解析失败直接崩溃。
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  const text = raw?.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** 从工具的 JSON Schema 里取出 required 参数名列表（无则空数组）。 */
function requiredParamNames(tool: ToolDefinition): string[] {
  const params = tool.parameters as Record<string, unknown> | undefined;
  const required = params?.required;
  return Array.isArray(required)
    ? required.filter((key): key is string => typeof key === "string")
    : [];
}

/** 解析后的参数里缺失了哪些 required 字段（用于截断检测）。 */
function missingRequiredArgs(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): string[] {
  return requiredParamNames(tool).filter((key) => !(key in args));
}

function isAbortError(_error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function cancelledResult(
  finalText: string,
  messages: AgentMessage[],
  steps: number,
  onEvent: RunAgentOptions["onEvent"],
): RunAgentResult {
  onEvent?.({ type: "cancelled", steps });
  return {
    finalText,
    messages,
    steps,
    stoppedByMaxSteps: false,
    cancelled: true,
  };
}

/** 执行单个工具调用，把成功结果或错误信息都转成喂回模型的字符串。 */
async function executeToolCall(
  call: ToolCall,
  toolsByName: Map<string, ToolDefinition>,
  onEvent: RunAgentOptions["onEvent"],
  signal?: AbortSignal,
  truncated?: boolean,
): Promise<AgentMessage> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : Object.assign(new Error("Operation was aborted"), {
          name: "AbortError",
        });
  }

  const tool = toolsByName.get(call.name);
  if (!tool) {
    const error = `Unknown tool: ${call.name}`;
    onEvent?.({
      type: "tool_error",
      toolCallId: call.id,
      name: call.name,
      error,
    });
    return { role: "tool", toolCallId: call.id, content: error };
  }

  onEvent?.({ type: "tool_call", call });
  try {
    const args = parseToolArguments(call.arguments);
    // 模型被 max_tokens 截断时，工具参数 JSON 可能根本没写完（残缺串退化成 {}）。
    // 此时若仍带着空/残缺参数去执行，会报与真因无关的错（如 "path is required"）。
    // 改为直接回灌明确错误，让模型知道是输出被截断、应提高 max_tokens 或拆分调用后重试。
    if (truncated) {
      const missing = missingRequiredArgs(tool, args);
      if (missing.length > 0) {
        const error =
          `Tool arguments were truncated because the model hit its max output token limit; ` +
          `required parameter(s) missing: ${missing.join(", ")}. ` +
          `Increase the model's max output tokens or split the call into smaller steps, then retry.`;
        onEvent?.({
          type: "tool_error",
          toolCallId: call.id,
          name: call.name,
          error,
        });
        return {
          role: "tool",
          toolCallId: call.id,
          content: `Error: ${error}`,
        };
      }
    }
    const result = await tool.execute(args, { signal });
    const text = typeof result === "string" ? result : JSON.stringify(result);
    onEvent?.({
      type: "tool_result",
      toolCallId: call.id,
      name: call.name,
      result: text,
    });
    return { role: "tool", toolCallId: call.id, content: text };
  } catch (error: unknown) {
    if (isAbortError(error, signal)) throw error;

    const message = error instanceof Error ? error.message : String(error);
    onEvent?.({
      type: "tool_error",
      toolCallId: call.id,
      name: call.name,
      error: message,
    });
    // 工具失败不应中断整个 agent：把错误回灌给模型，让它自己决定重试或换路。
    return { role: "tool", toolCallId: call.id, content: `Error: ${message}` };
  }
}

/**
 * 调度执行单轮的全部工具调用，返回与输入同序的 tool 消息。
 *
 * - 只读工具并行执行（互不影响）。
 * - mutating（写/删/改/移动/命令）工具按模型给出的先后顺序串行执行，
 *   且每个 mutating 工具在执行前等待此前已派发的所有调用完成，
 *   从而避免同轮重叠路径的并发读-改-写交错导致后写覆盖、静默丢改。
 */
async function executeToolCalls(
  calls: ToolCall[],
  toolsByName: Map<string, ToolDefinition>,
  onEvent: RunAgentOptions["onEvent"],
  signal?: AbortSignal,
  truncated?: boolean,
): Promise<AgentMessage[]> {
  const results: Promise<AgentMessage>[] = new Array(calls.length);
  const pending: Promise<unknown>[] = [];
  // 串行链：让每个 mutating 工具排在前一个 mutating 工具之后，保证写写有序。
  let mutatingChain: Promise<unknown> = Promise.resolve();

  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]!;
    const isMutating = toolsByName.get(call.name)?.mutating === true;

    if (isMutating) {
      // 等待此前已派发的所有调用（读+写）完成，再执行本次写，确保读到最新状态。
      const inFlight = [...pending];
      const run = mutatingChain
        .then(() => Promise.allSettled(inFlight))
        .then(() =>
          executeToolCall(call, toolsByName, onEvent, signal, truncated),
        );
      mutatingChain = run.catch(() => {});
      results[i] = run;
      pending.push(run);
    } else {
      const run = executeToolCall(call, toolsByName, onEvent, signal, truncated);
      results[i] = run;
      pending.push(run);
    }
  }

  return Promise.all(results);
}

/**
 * Agent 内核：协议无关的「思考-行动」循环。
 *
 * 每一轮：把对话发给模型 → 模型要么给文字（结束）、要么要求调用工具。
 * 若调用工具，就执行并把结果塞回对话，继续下一轮，直到模型不再调用工具
 * 或达到 maxSteps 安全上限。
 *
 * 这里不含任何 HTTP / Provider 细节——换模型、换协议只需替换传入的 ChatClient。
 *
 * 支持通过 options.signal 外部取消：每轮开始前检查 signal.aborted，
 * 若已取消则立即返回，触发 cancelled 事件。
 */
export async function runAgent(
  options: RunAgentOptions,
): Promise<RunAgentResult> {
  const { client, tools, onEvent, signal } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const contextLimit = options.contextLimit;
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  // 复制一份，避免就地修改调用方传入的数组。
  const messages: AgentMessage[] = [...options.messages];

  let steps = 0;
  let finalText = "";

  while (steps < maxSteps) {
    // 每轮开始前检查取消信号
    if (signal?.aborted) {
      return cancelledResult(finalText, messages, steps, onEvent);
    }

    steps += 1;
    // 发送前按预算裁剪历史（只裁发出去的副本，完整 messages 照常累积/持久化）。
    const outbound = trimMessageHistory(messages, contextLimit);
    // 优先走流式（边产出边回吐文本/思考增量）；client 未实现 stream 时回退到非流式 send。
    let reply: ModelReply;
    try {
      reply = client.stream
        ? await client.stream(
            outbound,
            tools,
            {
              onTextDelta: (delta) =>
                onEvent?.({ type: "assistant_message_delta", delta }),
              onReasoningDelta: (delta) =>
                onEvent?.({ type: "assistant_reasoning_delta", delta }),
              onToolCallDelta: (delta) =>
                onEvent?.({
                  type: "tool_call_delta",
                  index: delta.index,
                  callId: delta.callId,
                  name: delta.name,
                  argsTextDelta: delta.argsTextDelta,
                }),
            },
            { signal },
          )
        : await client.send(outbound, tools, { signal });
    } catch (error: unknown) {
      if (isAbortError(error, signal)) {
        return cancelledResult(finalText, messages, steps, onEvent);
      }
      throw error;
    }

    if (signal?.aborted) {
      return cancelledResult(finalText, messages, steps, onEvent);
    }

    if (reply.content) {
      onEvent?.({ type: "assistant_message", content: reply.content });
    }

    // 把模型这一轮的发言（文字 + 工具调用）作为一条 assistant 消息入历史。
    messages.push({
      role: "assistant",
      content: reply.content,
      toolCalls: reply.toolCalls.length > 0 ? reply.toolCalls : undefined,
      providerMetadata: reply.providerMetadata,
    });

    // 没有工具调用 = 模型认为任务完成，循环结束。
    if (reply.toolCalls.length === 0) {
      finalText = reply.content ?? "";
      return {
        finalText,
        messages,
        steps,
        stoppedByMaxSteps: false,
        cancelled: false,
      };
    }

    // 执行本轮所有工具调用：只读工具并行；会改动状态的 mutating 工具按模型给出的
    // 顺序串行，避免同轮多次编辑同一文件时并发读-改-写交错、后写覆盖丢改。
    let toolMessages: AgentMessage[];
    try {
      toolMessages = await executeToolCalls(
        reply.toolCalls,
        toolsByName,
        onEvent,
        signal,
        reply.truncated,
      );
    } catch (error: unknown) {
      if (isAbortError(error, signal)) {
        return cancelledResult(finalText, messages, steps, onEvent);
      }
      throw error;
    }

    if (signal?.aborted) {
      return cancelledResult(finalText, messages, steps, onEvent);
    }

    messages.push(...toolMessages);
  }

  onEvent?.({ type: "max_steps_reached", steps });
  return {
    finalText,
    messages,
    steps,
    stoppedByMaxSteps: true,
    cancelled: false,
  };
}

export type { ChatClient };
