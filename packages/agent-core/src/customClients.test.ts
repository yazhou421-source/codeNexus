import { describe, it, expect, vi, afterEach } from "vitest";
import { createAnthropicClient } from "./anthropicClient";
import { createGeminiClient } from "./geminiClient";
import type { AgentMessage } from "./types";

function stubFetch(responseJson: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(responseJson), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastRequest(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url,
    init,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAnthropicClient", () => {
  it("hits /v1/messages with x-api-key, lifts system to top level, and excludes it from messages", async () => {
    const fetchMock = stubFetch({ content: [{ type: "text", text: "hi" }] });
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-test",
      model: "claude-x",
    });
    const messages: AgentMessage[] = [
      { role: "system", content: "be terse" },
      { role: "user", content: "hello" },
    ];

    await client.send(messages, []);
    const { url, init, body } = lastRequest(fetchMock);

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(
      "sk-test",
    );
    expect(
      (init.headers as Record<string, string>)["anthropic-version"],
    ).toBeTruthy();
    expect(body.system).toBe("be terse");
    expect(body.max_tokens).toBeTypeOf("number");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("parses text + tool_use blocks from the response", async () => {
    stubFetch({
      content: [
        { type: "text", text: "done" },
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "tool_use", id: "t1", name: "foo", input: { a: 1 } },
      ],
    });
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
    });
    const reply = await client.send([{ role: "user", content: "go" }], []);
    expect(reply.content).toBe("done");
    expect(reply.toolCalls).toEqual([
      { id: "t1", name: "foo", arguments: '{"a":1}' },
    ]);
    expect(reply.providerMetadata).toEqual({
      contentBlocks: [
        { type: "text", text: "done" },
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "tool_use", id: "t1", name: "foo", input: { a: 1 } },
      ],
    });
  });

  it("maps a tool result message into a user tool_result block", async () => {
    const fetchMock = stubFetch({ content: [{ type: "text", text: "ok" }] });
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
    });
    await client.send([{ role: "tool", toolCallId: "t1", content: "42" }], []);
    const { body } = lastRequest(fetchMock);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "42" }],
      },
    ]);
  });

  it("round-trips Anthropic provider content blocks when present", async () => {
    const fetchMock = stubFetch({ content: [{ type: "text", text: "ok" }] });
    const client = createAnthropicClient({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
    });
    await client.send(
      [
        {
          role: "assistant",
          content: "done",
          toolCalls: [{ id: "t1", name: "foo", arguments: '{"a":1}' }],
          providerMetadata: {
            contentBlocks: [
              { type: "thinking", thinking: "hmm", signature: "sig" },
              { type: "text", text: "done" },
              { type: "tool_use", id: "t1", name: "foo", input: { a: 1 } },
            ],
          },
        },
        { role: "tool", toolCallId: "t1", content: "42" },
      ],
      [],
    );
    const { body } = lastRequest(fetchMock);
    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hmm", signature: "sig" },
          { type: "text", text: "done" },
          { type: "tool_use", id: "t1", name: "foo", input: { a: 1 } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "42" }],
      },
    ]);
  });
});

describe("createGeminiClient", () => {
  it("hits :generateContent with x-goog-api-key, lifts system, and maps roles (assistant→model)", async () => {
    const fetchMock = stubFetch({
      candidates: [{ content: { parts: [{ text: "hello" }] } }],
    });
    const client = createGeminiClient({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "g-key",
      model: "gemini-x",
    });
    const messages: AgentMessage[] = [
      { role: "system", content: "rules" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "yo" },
    ];

    await client.send(messages, []);
    const { url, init, body } = lastRequest(fetchMock);

    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent",
    );
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(
      "g-key",
    );
    expect(body.systemInstruction).toEqual({ parts: [{ text: "rules" }] });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "yo" }] },
    ]);
  });

  it("parses text + functionCall parts from the response", async () => {
    stubFetch({
      candidates: [
        {
          content: {
            parts: [
              { text: "sure" },
              {
                functionCall: {
                  id: "fc_1",
                  name: "foo",
                  args: { b: 2 },
                  thoughtSignature: "sig-1",
                },
              },
            ],
          },
        },
      ],
    });
    const client = createGeminiClient({
      baseUrl: "https://gl.example.com",
      apiKey: "k",
      model: "m",
    });
    const reply = await client.send([{ role: "user", content: "go" }], []);
    expect(reply.content).toBe("sure");
    expect(reply.toolCalls).toEqual([
      {
        id: "fc_1",
        name: "foo",
        arguments: '{"b":2}',
        providerMetadata: { thoughtSignature: "sig-1" },
      },
    ]);
  });

  it("round-trips Gemini functionCall ids and thought signatures in history", async () => {
    const fetchMock = stubFetch({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
    });
    const client = createGeminiClient({
      baseUrl: "https://gl.example.com",
      apiKey: "k",
      model: "m",
    });
    await client.send(
      [
        {
          role: "assistant",
          content: null,
          toolCalls: [
            {
              id: "fc_1",
              name: "foo",
              arguments: '{"b":2}',
              providerMetadata: { thoughtSignature: "sig-1" },
            },
          ],
        },
        { role: "tool", toolCallId: "fc_1", content: '{"result":"ok"}' },
      ],
      [],
    );
    const { body } = lastRequest(fetchMock);
    expect(body.contents).toEqual([
      {
        role: "model",
        parts: [
          {
            functionCall: {
              id: "fc_1",
              name: "foo",
              args: { b: 2 },
              thoughtSignature: "sig-1",
            },
          },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              id: "fc_1",
              name: "foo",
              response: { result: "ok" },
            },
          },
        ],
      },
    ]);
  });
});
