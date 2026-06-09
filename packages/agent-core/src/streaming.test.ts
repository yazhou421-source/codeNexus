import { describe, it, expect, vi, afterEach } from "vitest";
import { createChatCompletionsClient } from "./chatCompletionsClient";
import { createAnthropicClient } from "./anthropicClient";
import { createGeminiClient } from "./geminiClient";

function stubSse(body: string) {
  const fetchMock = vi.fn(
    async (_input?: unknown, _init?: unknown) =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streaming clients", () => {
  it("openai-compatible: accumulates content deltas, fires onTextDelta, stops at [DONE]", async () => {
    stubSse(
      [
        'data: {"choices":[{"delta":{"content":"Hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        "data: [DONE]",
        'data: {"choices":[{"delta":{"content":"IGNORED"}}]}',
      ].join("\n\n") + "\n\n",
    );
    const client = createChatCompletionsClient({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    const deltas: string[] = [];
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(reply.content).toBe("Hello");
  });

  it("openai-compatible: accumulates streamed tool_call fragments by index", async () => {
    stubSse(
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"foo","arguments":"{\\"a\\":"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
        "data: [DONE]",
      ].join("\n\n") + "\n\n",
    );
    const client = createChatCompletionsClient({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
    });
    expect(reply.toolCalls).toEqual([
      { id: "t1", name: "foo", arguments: '{"a":1}' },
    ]);
  });

  it("openai-compatible: fires onToolCallDelta for each streamed arg fragment", async () => {
    stubSse(
      [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"t1","function":{"name":"foo","arguments":"{\\"a\\":"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}',
        "data: [DONE]",
      ].join("\n\n") + "\n\n",
    );
    const client = createChatCompletionsClient({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    const toolDeltas: unknown[] = [];
    await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
      onToolCallDelta: (d) => toolDeltas.push(d),
    });
    expect(toolDeltas).toEqual([
      { index: 0, callId: "t1", name: "foo", argsTextDelta: '{"a":' },
      { index: 0, callId: "t1", name: "foo", argsTextDelta: "1}" },
    ]);
  });

  it("openai-compatible: forwards abort signals to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_input?: unknown, init?: unknown) =>
          await new Promise<Response>((_resolve, reject) => {
            capturedSignal = (init as RequestInit).signal as AbortSignal;
            capturedSignal.addEventListener("abort", () => {
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              );
            });
          }),
      ),
    );
    const client = createChatCompletionsClient({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    const controller = new AbortController();
    const promise = client.stream!(
      [{ role: "user", content: "hi" }],
      [],
      {
        onTextDelta: () => {},
      },
      { signal: controller.signal },
    );

    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("anthropic: accumulates text_delta events", async () => {
    stubSse(
      [
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}',
        'event: message_stop\ndata: {"type":"message_stop"}',
      ].join("\n\n") + "\n\n",
    );
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
    });
    const deltas: string[] = [];
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["Hi", " there"]);
    expect(reply.content).toBe("Hi there");
  });

  it("anthropic: assembles a tool_use block from input_json_delta fragments", async () => {
    stubSse(
      [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu1","name":"foo"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}',
      ].join("\n\n") + "\n\n",
    );
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
    });
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
    });
    expect(reply.toolCalls).toEqual([
      { id: "tu1", name: "foo", arguments: '{"a":1}' },
    ]);
  });

  it("anthropic: fires onToolCallDelta with the tool_use id/name for each input_json fragment", async () => {
    stubSse(
      [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu1","name":"foo"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"1}"}}',
      ].join("\n\n") + "\n\n",
    );
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
    });
    const toolDeltas: unknown[] = [];
    await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
      onToolCallDelta: (d) => toolDeltas.push(d),
    });
    expect(toolDeltas).toEqual([
      { index: 0, callId: "tu1", name: "foo", argsTextDelta: '{"a":' },
      { index: 0, callId: "tu1", name: "foo", argsTextDelta: "1}" },
    ]);
  });

  it("gemini: accumulates part text across SSE chunks", async () => {
    stubSse(
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"Be"}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"ep"}]}}]}',
      ].join("\n\n") + "\n\n",
    );
    const client = createGeminiClient({
      baseUrl: "https://gl.example.com",
      apiKey: "k",
      model: "m",
    });
    const deltas: string[] = [];
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: (d) => deltas.push(d),
    });
    expect(deltas).toEqual(["Be", "ep"]);
    expect(reply.content).toBe("Beep");
  });

  it("openai-compatible: accumulates reasoning_content + fires onReasoningDelta", async () => {
    stubSse(
      [
        'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}',
        'data: {"choices":[{"delta":{"reasoning_content":"more"}}]}',
        'data: {"choices":[{"delta":{"content":"answer"}}]}',
        "data: [DONE]",
      ].join("\n\n") + "\n\n",
    );
    const client = createChatCompletionsClient({
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
    });
    const reasoning: string[] = [];
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
      onReasoningDelta: (d) => reasoning.push(d),
    });
    expect(reasoning).toEqual(["think ", "more"]);
    expect(reply.reasoning).toBe("think more");
    expect(reply.content).toBe("answer");
  });

  it("anthropic: accumulates thinking_delta + sends thinking param when enabled", async () => {
    const fetchMock = stubSse(
      [
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}',
      ].join("\n\n") + "\n\n",
    );
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
      thinking: true,
    });
    const reasoning: string[] = [];
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
      onReasoningDelta: (d) => reasoning.push(d),
    });
    expect(reasoning).toEqual(["hmm"]);
    expect(reply.reasoning).toBe("hmm");
    expect(reply.content).toBe("ok");
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(body.max_tokens).toBeGreaterThan(2048);
  });

  it("anthropic: preserves streamed thinking signature and tool_use content blocks", async () => {
    stubSse(
      [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu1","name":"foo","input":{}}}',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}',
      ].join("\n\n") + "\n\n",
    );
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
      thinking: true,
    });
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
    });
    expect(reply.reasoning).toBe("hmm");
    expect(reply.toolCalls).toEqual([
      { id: "tu1", name: "foo", arguments: '{"a":1}' },
    ]);
    expect(reply.providerMetadata).toEqual({
      contentBlocks: [
        { type: "thinking", thinking: "hmm", signature: "sig-1" },
        { type: "tool_use", id: "tu1", name: "foo", input: { a: 1 } },
      ],
    });
  });

  it("anthropic: omits thinking param when not enabled", async () => {
    const fetchMock = stubSse(
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
    });
    await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.thinking).toBeUndefined();
  });

  it("gemini: routes thought parts to reasoning + sends thinkingConfig when enabled", async () => {
    const fetchMock = stubSse(
      [
        'data: {"candidates":[{"content":{"parts":[{"text":"reason","thought":true}]}}]}',
        'data: {"candidates":[{"content":{"parts":[{"text":"final"}]}}]}',
      ].join("\n\n") + "\n\n",
    );
    const client = createGeminiClient({
      baseUrl: "https://gl.example.com",
      apiKey: "k",
      model: "m",
      thinking: true,
    });
    const text: string[] = [];
    const reasoning: string[] = [];
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: (d) => text.push(d),
      onReasoningDelta: (d) => reasoning.push(d),
    });
    expect(reasoning).toEqual(["reason"]);
    expect(text).toEqual(["final"]);
    expect(reply.reasoning).toBe("reason");
    expect(reply.content).toBe("final");
    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.generationConfig.thinkingConfig).toEqual({
      includeThoughts: true,
    });
  });

  it("gemini: preserves streamed functionCall id and thoughtSignature", async () => {
    stubSse(
      [
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"fc_stream","name":"foo","args":{"a":1},"thoughtSignature":"sig-stream"}}]}}]}',
      ].join("\n\n") + "\n\n",
    );
    const client = createGeminiClient({
      baseUrl: "https://gl.example.com",
      apiKey: "k",
      model: "m",
    });
    const reply = await client.stream!([{ role: "user", content: "hi" }], [], {
      onTextDelta: () => {},
    });
    expect(reply.toolCalls).toEqual([
      {
        id: "fc_stream",
        name: "foo",
        arguments: '{"a":1}',
        providerMetadata: { thoughtSignature: "sig-stream" },
      },
    ]);
  });
});
