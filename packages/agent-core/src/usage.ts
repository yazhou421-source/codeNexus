import type { TokenUsage } from "./types";

/**
 * 三家 provider 的真实 token 用量解析器（归一化到内核统一的 TokenUsage 口径）。
 *
 * 各家字段名/语义差异极大，集中在此一处避免散落到三个 client：
 * - OpenAI：usage.prompt_tokens / completion_tokens；缓存 cached_tokens 是 prompt 的子集。
 * - Anthropic：usage.input_tokens 不含缓存，真实输入需把 cache_read + cache_creation 加回。
 * - Gemini：usageMetadata.promptTokenCount 含缓存；零值字段会被整体省略（非 0）。
 *
 * 所有解析对缺失/异常输入都返回 undefined（让调用方回退到字符估算），不抛错。
 */

/** 安全取数：仅接受有限数字，其余（undefined/null/NaN/字符串）归 0。 */
export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** OpenAI Chat Completions：usage.{prompt_tokens,completion_tokens,...}。 */
export function parseOpenAiUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const input = num(u.prompt_tokens);
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const completionDetails = u.completion_tokens_details as
    | Record<string, unknown>
    | undefined;
  const cacheRead = num(details?.cached_tokens);
  const reasoning = num(completionDetails?.reasoning_tokens);
  return {
    inputTokens: input, // 缓存是 prompt_tokens 的子集，已含在内
    outputTokens: num(u.completion_tokens),
    totalInputTokens: input,
    cacheReadTokens: cacheRead || undefined,
    reasoningTokens: reasoning || undefined,
  };
}

/** Anthropic Messages：usage.{input_tokens,output_tokens,cache_*}。input_tokens 不含缓存。 */
export function parseAnthropicUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const input = num(u.input_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheCreate = num(u.cache_creation_input_tokens);
  return {
    inputTokens: input,
    outputTokens: num(u.output_tokens),
    totalInputTokens: input + cacheRead + cacheCreate, // input_tokens 不含缓存，加回
    cacheReadTokens: cacheRead || undefined,
    cacheCreationTokens: cacheCreate || undefined,
  };
}

/** Gemini generateContent：usageMetadata.{promptTokenCount,candidatesTokenCount,...}。 */
export function parseGeminiUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const prompt = num(u.promptTokenCount); // 含缓存
  const candidates = num(u.candidatesTokenCount);
  const thoughts = num(u.thoughtsTokenCount); // 0 时被省略
  const cached = num(u.cachedContentTokenCount);
  return {
    inputTokens: prompt,
    outputTokens: candidates + thoughts,
    totalInputTokens: prompt, // 缓存是 promptTokenCount 的子集
    cacheReadTokens: cached || undefined,
    reasoningTokens: thoughts || undefined,
  };
}
