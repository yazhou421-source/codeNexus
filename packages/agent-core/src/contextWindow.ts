import type { AgentMessage } from "./types";

/**
 * 协议无关的历史上下文裁剪。
 *
 * 三家 provider（OpenAI / Anthropic / Gemini）的 tokenizer 各不相同，且都没有
 * 可离线精确计数的轻量库；这里刻意不引 tokenizer 依赖，改用字符启发式估算，
 * 并按「保守高估」取值——宁可早一点裁剪，也不要真正超出上游窗口被拒。
 *
 * 估算规则（业界常用近似）：
 * - CJK（中日韩等表意文字）约 1.5 字符/token
 * - 其余字符（拉丁、数字、标点、空白）约 4 字符/token
 * - 每条消息再加固定开销（role 包装、分隔符等），约 4 tokens/条
 *
 * 裁剪规则（防御性，避免破坏协议结构）：
 * - system 消息恒保留（置于最前）
 * - assistant(含 toolCalls) 与其后的 tool 结果黏成一个不可拆分的「组」，
 *   保留就整组保留、丢弃就整组丢弃——杜绝「孤立 tool_result 找不到对应 tool_use」导致上游报错
 * - 从最旧的组开始丢，保留最近的连续窗口
 * - 至少保留最新一组，绝不发空历史
 */

const CJK_CHARS_PER_TOKEN = 1.5;
const OTHER_CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD_TOKENS = 4;

/** 是否为 CJK 表意文字（含扩展区、假名、谚文、全角符号等高密度区段）。 */
function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0x3040 && code <= 0x30ff) || // 平假名 + 片假名
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
    (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意
    (code >= 0xff00 && code <= 0xffef) || // 全角/半角
    (code >= 0xac00 && code <= 0xd7af) || // 谚文音节
    (code >= 0x20000 && code <= 0x2ebef) // CJK 扩展 B–F（星平面）
  );
}

/** 估算一段文本的 token 数（保守高估）。 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(code)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk / CJK_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN);
}

/** 估算单条消息的 token 数：正文 + 工具调用参数 + 固定开销。 */
export function estimateMessageTokens(message: AgentMessage): number {
  let tokens = PER_MESSAGE_OVERHEAD_TOKENS;
  tokens += estimateTokens(message.content);
  for (const call of message.toolCalls ?? []) {
    tokens += estimateTokens(call.name);
    tokens += estimateTokens(call.arguments);
  }
  return tokens;
}

/** 估算整段历史的 token 总数（与裁剪同口径，供 UI 展示「上下文已用大小」）。 */
export function estimateHistoryTokens(messages: AgentMessage[]): number {
  return messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );
}

type MessageGroup = {
  messages: AgentMessage[];
  /** 这组是否仍在等待 tool 结果（由 assistant(toolCalls) 开启）。 */
  expectsTools: boolean;
};

/**
 * 把非 system 消息切成不可拆分的组：
 * - assistant(含 toolCalls) 开启一个组，吸收紧随其后的 tool 结果
 * - user / assistant(无 toolCalls) 各自成组，并关闭上一个等待中的组
 * - 孤立的 tool 结果（前面没有对应 assistant）黏到上一组，避免它成为窗口起点
 */
function buildGroups(messages: AgentMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;
  for (const message of messages) {
    if (
      message.role === "assistant" &&
      message.toolCalls &&
      message.toolCalls.length > 0
    ) {
      current = { messages: [message], expectsTools: true };
      groups.push(current);
    } else if (message.role === "tool") {
      if (current && current.expectsTools) {
        current.messages.push(message);
      } else if (groups.length > 0) {
        groups[groups.length - 1]!.messages.push(message);
      } else {
        groups.push({ messages: [message], expectsTools: false });
      }
    } else {
      current = { messages: [message], expectsTools: false };
      groups.push(current);
    }
  }
  return groups;
}

/**
 * 按 token 预算裁剪历史，返回应当发给模型的消息子集（保持原序、原引用）。
 *
 * contextLimit 为「输入侧最大估算 tokens」。≤0 或未提供时不裁剪，原样返回。
 * 不就地修改入参——返回的是过滤后的新数组，元素仍是原消息对象（保留 providerMetadata）。
 */
export function trimMessageHistory(
  messages: AgentMessage[],
  contextLimit: number | null | undefined,
): AgentMessage[] {
  if (!contextLimit || contextLimit <= 0) return messages;

  const system = messages.filter((message) => message.role === "system");
  const rest = messages.filter((message) => message.role !== "system");
  const groups = buildGroups(rest);
  if (groups.length === 0) return messages;

  const systemTokens = system.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0,
  );
  const groupTokens = groups.map((group) =>
    group.messages.reduce(
      (sum, message) => sum + estimateMessageTokens(message),
      0,
    ),
  );

  let used = systemTokens;
  const keptGroups: MessageGroup[] = [];
  // 从最新一组往回保留连续窗口；至少保留最新一组（即便它本身已超预算）。
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const tokens = groupTokens[i]!;
    if (keptGroups.length === 0 || used + tokens <= contextLimit) {
      keptGroups.unshift(groups[i]!);
      used += tokens;
    } else {
      break;
    }
  }

  return [...system, ...keptGroups.flatMap((group) => group.messages)];
}
