import { describe, it, expect } from "vitest";
import {
  num,
  parseOpenAiUsage,
  parseAnthropicUsage,
  parseGeminiUsage,
} from "./usage";

describe("num", () => {
  it("accepts finite numbers, rejects everything else", () => {
    expect(num(5)).toBe(5);
    expect(num(0)).toBe(0);
    expect(num(NaN)).toBe(0);
    expect(num(Infinity)).toBe(0);
    expect(num("7")).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num(null)).toBe(0);
  });
});

describe("parseOpenAiUsage", () => {
  it("maps prompt/completion tokens; cached is a subset of input (not added)", () => {
    const usage = parseOpenAiUsage({
      prompt_tokens: 1000,
      completion_tokens: 200,
      total_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 800 },
      completion_tokens_details: { reasoning_tokens: 50 },
    });
    expect(usage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      totalInputTokens: 1000, // cached NOT added — it's already in prompt_tokens
      cacheReadTokens: 800,
      reasoningTokens: 50,
    });
  });

  it("omits optional fields when absent/zero and returns undefined for non-objects", () => {
    expect(parseOpenAiUsage({ prompt_tokens: 10, completion_tokens: 5 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalInputTokens: 10,
      cacheReadTokens: undefined,
      reasoningTokens: undefined,
    });
    expect(parseOpenAiUsage(null)).toBeUndefined();
    expect(parseOpenAiUsage(undefined)).toBeUndefined();
    expect(parseOpenAiUsage("nope")).toBeUndefined();
  });
});

describe("parseAnthropicUsage", () => {
  it("adds cache read+creation onto input_tokens (Anthropic excludes them)", () => {
    const usage = parseAnthropicUsage({
      input_tokens: 25,
      output_tokens: 50,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 1024,
    });
    expect(usage).toEqual({
      inputTokens: 25,
      outputTokens: 50,
      totalInputTokens: 25 + 100 + 1024, // CRITICAL: cache added back
      cacheReadTokens: 100,
      cacheCreationTokens: 1024,
    });
  });

  it("handles missing cache fields", () => {
    expect(parseAnthropicUsage({ input_tokens: 25, output_tokens: 50 })).toEqual({
      inputTokens: 25,
      outputTokens: 50,
      totalInputTokens: 25,
      cacheReadTokens: undefined,
      cacheCreationTokens: undefined,
    });
  });
});

describe("parseGeminiUsage", () => {
  it("sums candidates + thoughts for output; cached is a subset of prompt", () => {
    const usage = parseGeminiUsage({
      promptTokenCount: 11,
      candidatesTokenCount: 73,
      thoughtsTokenCount: 120,
      totalTokenCount: 204,
      cachedContentTokenCount: 8,
    });
    expect(usage).toEqual({
      inputTokens: 11,
      outputTokens: 73 + 120, // thinking folded into output
      totalInputTokens: 11, // cached already inside promptTokenCount
      cacheReadTokens: 8,
      reasoningTokens: 120,
    });
  });

  it("treats omitted zero fields as absent", () => {
    expect(parseGeminiUsage({ promptTokenCount: 11, candidatesTokenCount: 73 })).toEqual({
      inputTokens: 11,
      outputTokens: 73,
      totalInputTokens: 11,
      cacheReadTokens: undefined,
      reasoningTokens: undefined,
    });
  });
});
