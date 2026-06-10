import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateHistoryTokens,
  trimMessageHistory,
} from "./contextWindow";
import type { AgentMessage } from "./types";

describe("estimateTokens", () => {
  it("returns 0 for empty / nullish text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("estimates latin text at ~4 chars/token", () => {
    // 8 ascii chars / 4 = 2
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("estimates CJK denser than latin (~1.5 chars/token)", () => {
    // 3 CJK / 1.5 = 2
    expect(estimateTokens("你好吗")).toBe(2);
    // CJK is more tokens-per-char than the same count of latin chars
    expect(estimateTokens("你好吗你好吗")).toBeGreaterThan(
      estimateTokens("abcdef"),
    );
  });
});

describe("estimateMessageTokens", () => {
  it("counts content + tool-call args + per-message overhead", () => {
    const message: AgentMessage = {
      role: "assistant",
      content: "abcd", // 1 token
      toolCalls: [{ id: "t1", name: "foo", arguments: '{"a":1}' }],
    };
    // overhead(4) + content(1) + name "foo"(1) + args(2) = 8
    expect(estimateMessageTokens(message)).toBe(
      4 + estimateTokens("abcd") + estimateTokens("foo") + estimateTokens('{"a":1}'),
    );
  });
});

describe("estimateHistoryTokens", () => {
  it("returns 0 for an empty history", () => {
    expect(estimateHistoryTokens([])).toBe(0);
  });

  it("sums per-message estimates across the whole history", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "rules" },
      { role: "user", content: "hello there" },
      { role: "assistant", content: "hi" },
    ];
    const expected =
      estimateMessageTokens(messages[0]!) +
      estimateMessageTokens(messages[1]!) +
      estimateMessageTokens(messages[2]!);
    expect(estimateHistoryTokens(messages)).toBe(expected);
  });
});

describe("trimMessageHistory", () => {
  it("returns the input untouched when limit is missing or <= 0", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
    ];
    expect(trimMessageHistory(messages, null)).toBe(messages);
    expect(trimMessageHistory(messages, undefined)).toBe(messages);
    expect(trimMessageHistory(messages, 0)).toBe(messages);
    expect(trimMessageHistory(messages, -5)).toBe(messages);
  });

  it("always keeps system messages and drops oldest non-system first", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "rules" },
      { role: "user", content: "oldest oldest oldest oldest" },
      { role: "assistant", content: "mid mid mid mid" },
      { role: "user", content: "newest" },
    ];
    // Tight budget: only system + newest group survive.
    const trimmed = trimMessageHistory(messages, 12);
    expect(trimmed[0]).toEqual({ role: "system", content: "rules" });
    expect(trimmed.some((m) => m.content === "oldest oldest oldest oldest")).toBe(
      false,
    );
    expect(trimmed[trimmed.length - 1]).toEqual({
      role: "user",
      content: "newest",
    });
  });

  it("never drops the newest group even if it alone exceeds the budget", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "a".repeat(400) },
    ];
    const trimmed = trimMessageHistory(messages, 1);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0]!.content).toBe("a".repeat(400));
  });

  it("keeps assistant(tool_calls) glued to its tool results as one atomic group", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "padding padding padding padding padding" },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "t1", name: "foo", arguments: "{}" }],
      },
      { role: "tool", toolCallId: "t1", content: "result" },
      { role: "assistant", content: "final answer" },
    ];
    // Budget large enough for the tool group + final, but not the oldest user padding.
    const trimmed = trimMessageHistory(messages, 30);
    // The padding user turn should be dropped.
    expect(trimmed.some((m) => m.content?.startsWith("padding"))).toBe(false);
    // If the assistant(tool_calls) survives, its tool result must survive too.
    const hasToolCall = trimmed.some(
      (m) => m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0,
    );
    const hasToolResult = trimmed.some((m) => m.role === "tool");
    expect(hasToolCall).toBe(hasToolResult);
  });

  it("never leaves an orphaned tool result as the first non-system message", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "t1", name: "foo", arguments: "{}" }],
      },
      { role: "tool", toolCallId: "t1", content: "r".repeat(200) },
      { role: "assistant", content: "done" },
    ];
    const trimmed = trimMessageHistory(messages, 5);
    // First surviving message must not be a bare tool result.
    expect(trimmed[0]!.role).not.toBe("tool");
  });
});
