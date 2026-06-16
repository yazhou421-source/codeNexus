/**
 * Agent 内核的协议无关类型定义。
 *
 * 这里刻意只描述「内核」需要的最小概念：一段对话、一组可调用的工具、
 * 一个能把对话发给模型并拿回「文字或工具调用」的客户端。
 * 具体走 Chat Completions / Anthropic / Responses 哪种线路，由 ChatClient 的实现决定，
 * 内核本身不关心。
 */

/** 对话中的一条消息。role=tool 时必须带 toolCallId，用于把工具结果对应回某次调用。 */
export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  /** 文本内容；assistant 在「只发起工具调用、没有文字」时可为 null。 */
  content: string | null;
  /** assistant 发起的工具调用（可并行多个）。仅 role=assistant 时出现。 */
  toolCalls?: ToolCall[];
  /** 工具结果对应的调用 id。仅 role=tool 时出现。 */
  toolCallId?: string;
  /**
   * Provider-specific metadata that must survive a conversation round-trip.
   * This is intentionally opaque to the core loop and interpreted only by adapters.
   */
  providerMetadata?: Record<string, unknown>;
};

/** 模型决定调用某个工具的请求。arguments 是模型生成的 JSON 字符串。 */
export type ToolCall = {
  id: string;
  name: string;
  /** 原始 JSON 字符串参数（可能是不完整/非法 JSON，执行方负责解析与校验）。 */
  arguments: string;
  /**
   * Provider-specific metadata that must survive a tool round-trip.
   * Adapters may use this to preserve protocol-only fields such as Gemini thought signatures.
   */
  providerMetadata?: Record<string, unknown>;
};

/** 一个可被模型调用的工具：名字、给模型看的描述、JSON Schema 参数、以及真正的执行逻辑。 */
export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema，描述参数形状，原样转发给模型。 */
  parameters: Record<string, unknown>;
  /**
   * 该工具是否会改动文件系统/工作区状态（写、删、改、移动、执行命令等）。
   * 内核据此在单轮多调用时把 mutating 工具串行执行，避免重叠路径的读-改-写竞态丢写；
   * 只读工具仍并行。缺省（undefined/false）视为只读。
   */
  mutating?: boolean;
  /** 执行工具。入参是已解析的参数对象，返回喂回模型的文本结果。 */
  execute: (
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ) => Promise<string> | string;
};

/** 工具执行上下文。 */
export type ToolExecutionContext = {
  /** 外部取消信号：长耗时工具应监听它并尽快中止。 */
  signal?: AbortSignal;
};

/** 模型一轮回复：要么是最终文字，要么是一批工具调用（也可能两者都有）。 */
export type ModelReply = {
  content: string | null;
  toolCalls: ToolCall[];
  /** 思考/推理文本（若 provider 返回）。仅用于展示，不回灌进对话历史。 */
  reasoning?: string | null;
  /**
   * Provider-specific metadata from the model response.
   * runAgent stores this on the assistant message so the same adapter can round-trip it.
   */
  providerMetadata?: Record<string, unknown>;
  /**
   * 模型因长度上限（max_tokens / finish_reason="length" / stop_reason="max_tokens"）被截断。
   * 截断意味着工具调用参数 JSON 可能残缺：内核据此对 parse 失败的参数回灌明确错误，
   * 而不是静默退化成 {} 去执行、报一个与真因无关的错。
   */
  truncated?: boolean;
};

/** 工具调用参数的流式增量：同一调用的多次增量按 index 聚合。 */
export type ToolCallDelta = {
  /** provider 内按 index 聚合工具调用；同一调用的多次增量 index 相同。 */
  index: number;
  /** 工具调用 id（provider 已确定时带上，便于与最终 tool_call 关联）。 */
  callId?: string;
  /** 工具名（首个增量里通常已确定）。 */
  name?: string;
  /** 参数 JSON 字符串的增量片段（按 index 拼接得到完整 arguments）。 */
  argsTextDelta: string;
};

/** 流式回调：回吐文本增量、（可选）思考/推理增量、（可选）工具调用参数增量。 */
export type ChatStreamHandlers = {
  onTextDelta: (delta: string) => void;
  /** 思考/推理增量（provider 支持且开启时）；不关心思考的调用方可不传。 */
  onReasoningDelta?: (delta: string) => void;
  /** 工具调用参数增量（provider 支持时）；不关心的调用方可不传。 */
  onToolCallDelta?: (delta: ToolCallDelta) => void;
};

/** 一次模型请求的运行上下文。 */
export type ChatRequestOptions = {
  /** 外部取消信号：provider client 应传给 fetch / stream reader。 */
  signal?: AbortSignal;
};

/**
 * 把当前对话 + 工具清单发给模型、拿回一轮回复。
 *
 * 这是内核与「具体协议/Provider」之间唯一的接缝。
 * 真实实现内部会做 fetch + 流式解析（可复用 DeepSeekResponsesProxyService 的范式）；
 * 测试里则用一个脚本化的假实现，不触网。
 */
export type ChatClient = {
  send: (
    messages: AgentMessage[],
    tools: ToolDefinition[],
    options?: ChatRequestOptions,
  ) => Promise<ModelReply>;
  /**
   * 可选的流式实现：边产出边通过 handlers.onTextDelta 回吐文本增量，最终仍返回完整 ModelReply。
   * 内核 runAgent 会优先用它（若存在）以驱动流式 UI；未实现则回退到非流式 send。
   */
  stream?: (
    messages: AgentMessage[],
    tools: ToolDefinition[],
    handlers: ChatStreamHandlers,
    options?: ChatRequestOptions,
  ) => Promise<ModelReply>;
};

/** 运行一次 agent 的输入。 */
export type RunAgentOptions = {
  client: ChatClient;
  tools: ToolDefinition[];
  messages: AgentMessage[];
  /** 安全阀：最多循环多少轮，防止模型/工具卡在死循环里。默认 16。 */
  maxSteps?: number;
  /** 可选的观测回调，用于 UI 实时展示「模型说了什么、调了什么工具」。 */
  onEvent?: (event: AgentEvent) => void;
  /** 可选的取消信号：外部可通过 abort() 中止正在运行的 agent。 */
  signal?: AbortSignal;
  /**
   * 可选的输入侧上下文预算（估算 tokens）。设置后，每轮发给模型前按此预算裁剪历史，
   * system 恒保留、tool 调用与结果成组不拆；完整历史仍照常累积与持久化，只裁发出去的副本。
   * 未设或 ≤0 时不裁剪。
   */
  contextLimit?: number | null;
};

/** 内核运行过程中对外广播的事件，供 UI / 日志消费。 */
export type AgentEvent =
  | { type: "assistant_message"; content: string }
  | { type: "assistant_message_delta"; delta: string }
  | { type: "assistant_reasoning_delta"; delta: string }
  | {
      type: "tool_call_delta";
      index: number;
      callId?: string;
      name?: string;
      argsTextDelta: string;
    }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; toolCallId: string; name: string; result: string }
  | { type: "tool_error"; toolCallId: string; name: string; error: string }
  | { type: "max_steps_reached"; steps: number }
  | { type: "cancelled"; steps: number };

/** 运行结束后的结果。 */
export type RunAgentResult = {
  /** 模型给出的最终文字答复（没有则为空串）。 */
  finalText: string;
  /** 完整的对话历史（含中间的工具调用与结果），可用于持久化或继续对话。 */
  messages: AgentMessage[];
  /** 实际循环了几轮。 */
  steps: number;
  /** 是否因为达到 maxSteps 而被强制中止。 */
  stoppedByMaxSteps: boolean;
  /** 是否因为外部 AbortSignal 而被取消。 */
  cancelled: boolean;
};
