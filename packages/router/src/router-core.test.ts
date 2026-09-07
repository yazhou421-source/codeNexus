/*! Test scenarios adapted in part from CodexBridge server tests.
 * Copyright (c) 2026 wangzhezbz. Licensed under the MIT License.
 */
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { validateConfig } from "./config.js";
import { createRouterServer } from "./server.js";
import type { RouterConfig } from "./types";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("Embedded Router API", () => {
  it("exposes minimal health plus model and catalog endpoints", async () => {
    const config = testConfig("http://127.0.0.1:9");
    config.models[0].baseInstructions = "private model instructions";
    const router = track(createRouterServer(config));
    const origin = await listen(router);

    const health = await fetchJson(`${origin}/health`);
    expect(health).toEqual({
      ok: true,
      service: "codenexus-embedded-router",
      protocolVersion: 1,
    });
    expect(health).not.toHaveProperty("config");

    const models = await fetchJson(`${origin}/v1/models`);
    expect(models.data[0]).toMatchObject({
      id: "test-model",
      object: "model",
    });
    expect(JSON.stringify(models)).not.toContain("provider-key");

    const catalog = await fetchJson(`${origin}/model-catalog.json`);
    expect(catalog.models[0]).toMatchObject({
      slug: "test-model",
      apply_patch_tool_type: "freeform",
    });
    expect(JSON.stringify(catalog)).not.toContain("provider-key");
  });

  it("does not enable browser CORS", async () => {
    const router = track(createRouterServer(testConfig("http://127.0.0.1:9")));
    const origin = await listen(router);
    const response = await fetch(`${origin}/v1/responses`, {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it("returns a clear error when the provider key is missing", async () => {
    const envName = "CODENEXUS_ROUTER_MISSING_TEST_KEY";
    const previous = process.env[envName];
    delete process.env[envName];
    const config = testConfig("https://api.example.test", {
      apiKey: undefined,
      apiKeyEnv: envName,
    });
    const router = track(createRouterServer(config));
    const origin = await listen(router);
    try {
      const response = await postJson(origin, {
        model: "test-model",
        input: "hello",
      });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.error.code).toBe("PROVIDER_NOT_CONFIGURED");
      expect(body.error.message).toMatch(/save an api key/i);
      expect(JSON.stringify(body)).not.toContain(envName);
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });

  it("converts a basic streamed response", async () => {
    const { origin } = await stackWithUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl_stream",
          choices: [{ message: { role: "assistant", content: "streamed" } }],
        }),
      );
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "hello",
      stream: true,
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: response.completed");
    expect(body).toContain("streamed");
    expect(body).toContain("data: [DONE]");
  });

  it("forwards native SSE deltas before the upstream response completes", async () => {
    let upstreamRequestBody: Record<string, any> | undefined;
    let upstreamCompletedAt = 0;
    const { origin } = await stackWithUpstream(async (request, response) => {
      upstreamRequestBody = await readRequestJson(request);
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        chatSse({
          choices: [
            { index: 0, delta: { content: "Hel" }, finish_reason: null },
          ],
        }),
      );
      setTimeout(() => {
        response.write(
          chatSse({
            choices: [
              { index: 0, delta: { content: "lo" }, finish_reason: null },
            ],
          }),
        );
      }, 300);
      setTimeout(() => {
        upstreamCompletedAt = Date.now();
        response.write(
          chatSse({
            choices: [
              {
                index: 0,
                delta: { content: " world" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
          }),
        );
        response.end("data: [DONE]\n\n");
      }, 600);
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "hello",
      stream: true,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let partial = "";
    while (!partial.includes('"delta":"Hel"')) {
      const next = await reader.read();
      expect(next.done).toBe(false);
      partial += decoder.decode(next.value, { stream: true });
    }
    const firstDownstreamDeltaAt = Date.now();
    expect(partial).not.toContain("response.completed");
    let remainder = "";
    let reading = true;
    while (reading) {
      const next = await reader.read();
      if (next.done) {
        reading = false;
        continue;
      }
      remainder += decoder.decode(next.value, { stream: true });
    }
    expect(partial + remainder).toContain('"output_text":"Hello world"');
    expect(partial + remainder).toContain("response.completed");
    expect(partial + remainder).toContain('"total_tokens":6');
    expect(firstDownstreamDeltaAt).toBeLessThan(upstreamCompletedAt);
    expect(upstreamRequestBody).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("reassembles streamed tool-call arguments without exposing reasoning", async () => {
    const { origin } = await stackWithUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        chatSse({
          choices: [
            {
              index: 0,
              delta: {
                reasoning_content: "private chain of thought",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_stream",
                    type: "function",
                    function: { name: "read_file", arguments: '{"path":' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      response.write(
        chatSse({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '"README.md"}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      response.end("data: [DONE]\n\n");
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "read",
      stream: true,
      tools: [readFileTool()],
    });
    const body = await response.text();
    expect(body).toContain("response.function_call_arguments.delta");
    expect(body).toContain("README.md");
    expect(body).toContain("call_stream");
    expect(body).not.toContain("private chain of thought");
  });

  it("keeps multiple streamed tool calls ordered and independently assembled", async () => {
    const { origin } = await stackWithUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        chatSse({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_a",
                    function: { name: "read_file", arguments: '{"path":' },
                  },
                  {
                    index: 1,
                    id: "call_b",
                    function: { name: "read_file", arguments: '{"path":' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      response.write(
        chatSse({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: '"A.md"}' } },
                  { index: 1, function: { arguments: '"B.md"}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      );
      response.end("data: [DONE]\n\n");
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "read both",
      stream: true,
      tools: [readFileTool()],
    });
    const body = await response.text();
    expect(body).toContain("call_a");
    expect(body).toContain("call_b");
    expect(body).toContain("A.md");
    expect(body).toContain("B.md");
    expect(
      body.match(/event: response\.function_call_arguments\.done/g),
    ).toHaveLength(2);
  });

  it("turns malformed native SSE into a safe failed event", async () => {
    const { origin } = await stackWithUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end("data: {not-json-with-secret-value}\n\n");
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "hello",
      stream: true,
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain("response.failed");
    expect(body).toContain("INVALID_RESPONSE");
    expect(body).not.toContain("not-json-with-secret-value");
  });

  it("performs one buffered fallback only for a clearly unsupported stream error", async () => {
    const upstreamBodies: Array<Record<string, any>> = [];
    const { origin } = await stackWithUpstream(async (request, response) => {
      const body = await readRequestJson(request);
      upstreamBodies.push(body);
      if (body.stream) {
        response.writeHead(422, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              code: "unsupported_stream",
              message: "stream is unsupported",
            },
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "fallback ok" } }],
        }),
      );
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "hello",
      stream: true,
    });
    const body = await response.text();
    expect(upstreamBodies.map((item) => item.stream)).toEqual([true, false]);
    expect(body).toContain("fallback ok");
    expect(body).toContain("response.completed");
  });

  it("retries native streaming without usage options when only stream_options is rejected", async () => {
    const upstreamBodies: Array<Record<string, any>> = [];
    const { origin } = await stackWithUpstream(async (request, response) => {
      const body = await readRequestJson(request);
      upstreamBodies.push(body);
      if (body.stream_options) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              code: "invalid_parameter",
              message: "stream_options unsupported",
            },
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        chatSse({
          choices: [
            { index: 0, delta: { content: "native" }, finish_reason: "stop" },
          ],
        }) + "data: [DONE]\n\n",
      );
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "hello",
      stream: true,
    });
    const body = await response.text();
    expect(upstreamBodies).toHaveLength(2);
    expect(upstreamBodies[1]).toMatchObject({ stream: true });
    expect(upstreamBodies[1]).not.toHaveProperty("stream_options");
    expect(body).toContain('"delta":"native"');
  });

  it("reports an interrupted upstream stream without inventing a completion", async () => {
    const { origin } = await stackWithUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        chatSse({
          choices: [
            {
              index: 0,
              delta: { content: "partial" },
              finish_reason: null,
            },
          ],
        }),
      );
      response.end();
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "hello",
      stream: true,
    });
    const body = await response.text();
    expect(body).toContain("response.failed");
    expect(body).toContain("STREAM_INTERRUPTED");
    expect(body).not.toContain("response.completed");
  });

  it("aborts a native upstream stream when the downstream client cancels", async () => {
    let observeClose: (() => void) | undefined;
    const upstreamClosed = new Promise<void>((resolve) => {
      observeClose = resolve;
    });
    const { origin } = await stackWithUpstream((_request, response) => {
      response.once("close", () => observeClose?.());
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        chatSse({
          choices: [
            {
              index: 0,
              delta: { content: "first" },
              finish_reason: null,
            },
          ],
        }),
      );
    });
    const controller = new AbortController();
    const response = await fetch(`${origin}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer router-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "test-model",
        input: "hello",
        stream: true,
      }),
      signal: controller.signal,
    });
    await response.body!.getReader().read();
    controller.abort();
    await expect(
      Promise.race([
        upstreamClosed.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
      ]),
    ).resolves.toBe("closed");
  });

  it("maps a basic tool call back to Responses format", async () => {
    const { origin } = await stackWithUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl_tool",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_test",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"README.md"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    const response = await postJson(origin, {
      model: "test-model",
      input: "read",
      tools: [
        {
          type: "function",
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object" },
        },
      ],
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.output).toContainEqual(
      expect.objectContaining({
        type: "function_call",
        call_id: "call_test",
        name: "read_file",
      }),
    );
  });

  it("does not count tool outputs from earlier user turns toward the loop guard", async () => {
    const { origin } = await stackWithUpstream(toolCallUpstream);
    const response = await postJson(origin, {
      model: "test-model",
      input: [
        userMessage("old request"),
        toolCall("old_call_1"),
        toolOutput("old_call_1"),
        toolCall("old_call_2"),
        toolOutput("old_call_2"),
        toolCall("old_call_3"),
        toolOutput("old_call_3"),
        userMessage("new request"),
      ],
      tools: [readFileTool()],
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.output).toContainEqual(
      expect.objectContaining({
        type: "function_call",
        call_id: "call_test",
        name: "read_file",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("stopped repeated tool loop");
  });

  it("still stops repeated tool continuations within the latest user turn", async () => {
    const { origin } = await stackWithUpstream(toolCallUpstream);
    const response = await postJson(origin, {
      model: "test-model",
      input: [
        userMessage("current request"),
        toolCall("current_call_1"),
        toolOutput("current_call_1"),
        toolCall("current_call_2"),
        toolOutput("current_call_2"),
        toolCall("current_call_3"),
        toolOutput("current_call_3"),
      ],
      tools: [readFileTool()],
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).toContain("stopped repeated tool loop");
    expect(body.output).not.toContainEqual(
      expect.objectContaining({ type: "function_call" }),
    );
  });

  it("preserves the tool-loop guard for streaming requests", async () => {
    let upstreamRequestBody: Record<string, any> | undefined;
    const { origin } = await stackWithUpstream(async (request, response) => {
      upstreamRequestBody = await readRequestJson(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl_tool",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_test",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"README.md"}',
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    const response = await postJson(origin, {
      model: "test-model",
      stream: true,
      input: [
        userMessage("current request"),
        toolCall("current_call_1"),
        toolOutput("current_call_1"),
        toolCall("current_call_2"),
        toolOutput("current_call_2"),
        toolCall("current_call_3"),
        toolOutput("current_call_3"),
      ],
      tools: [readFileTool()],
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(upstreamRequestBody).toMatchObject({ stream: false });
    expect(body).toContain("stopped repeated tool loop");
    expect(body).not.toContain('"type":"function_call"');
    expect(body).toContain("response.completed");
  });

  it("returns a safe cached product error after a provider 429", async () => {
    let calls = 0;
    const { origin } = await stackWithUpstream((_request, response) => {
      calls += 1;
      response.writeHead(429, {
        "content-type": "application/json",
        "retry-after": "30",
      });
      response.end(JSON.stringify({ error: { message: "Too Many Requests" } }));
    });
    const first = await postJson(origin, {
      model: "test-model",
      input: "hello",
    });
    const second = await postJson(origin, {
      model: "test-model",
      input: "hello again",
    });
    expect(first.status).toBe(429);
    expect(second.status).toBe(429);
    expect(await first.text()).toContain("RATE_LIMITED");
    expect(await second.text()).toContain("RATE_LIMITED");
    expect(calls).toBe(1);
  });

  it("aborts an in-flight upstream request when the client disconnects", async () => {
    let observeUpstreamStart: (() => void) | undefined;
    const upstreamStarted = new Promise<void>((resolve) => {
      observeUpstreamStart = resolve;
    });
    let observeUpstreamClose: (() => void) | undefined;
    const upstreamClosed = new Promise<void>((resolve) => {
      observeUpstreamClose = resolve;
    });
    const { origin } = await stackWithUpstream((_request, response) => {
      observeUpstreamStart?.();
      response.once("close", () => observeUpstreamClose?.());
    });
    const controller = new AbortController();
    const pending = fetch(`${origin}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer router-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "test-model", input: "wait" }),
      signal: controller.signal,
    });
    await upstreamStarted;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(
      Promise.race([
        upstreamClosed.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
      ]),
    ).resolves.toBe("closed");
  });
});

describe("Router config safety", () => {
  it("rejects malformed config, non-loopback hosts, and unsafe protocols", () => {
    expect(() => validateConfig(null as unknown as RouterConfig)).toThrow(
      /must be an object/,
    );
    expect(() =>
      validateConfig({
        ...testConfig("https://api.example.test"),
        host: "0.0.0.0",
      }),
    ).toThrow(/must be loopback/);
    expect(() => validateConfig(testConfig("file:///tmp/provider"))).toThrow(
      /http or https/,
    );
    expect(() => validateConfig(testConfig("javascript:alert(1)"))).toThrow(
      /http or https/,
    );
    expect(() => validateConfig(testConfig("not a URL"))).toThrow(
      /invalid baseUrl/,
    );
  });
});

async function stackWithUpstream(
  handler: http.RequestListener,
): Promise<{ origin: string }> {
  const upstream = track(http.createServer(handler));
  const upstreamOrigin = await listen(upstream);
  const router = track(createRouterServer(testConfig(upstreamOrigin)));
  return { origin: await listen(router) };
}

function toolCallUpstream(
  _request: http.IncomingMessage,
  response: http.ServerResponse,
): void {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: "chatcmpl_tool",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_test",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: '{"path":"README.md"}',
                },
              },
            ],
          },
        },
      ],
    }),
  );
}

function userMessage(text: string): Record<string, unknown> {
  return { type: "message", role: "user", content: text };
}

function toolCall(callId: string): Record<string, unknown> {
  return {
    type: "function_call",
    call_id: callId,
    name: "read_file",
    arguments: '{"path":"README.md"}',
  };
}

function toolOutput(callId: string): Record<string, unknown> {
  return {
    type: "function_call_output",
    call_id: callId,
    output: "file contents",
  };
}

function readFileTool(): Record<string, unknown> {
  return {
    type: "function",
    name: "read_file",
    description: "Read a file",
    parameters: { type: "object" },
  };
}

function testConfig(
  upstreamOrigin: string,
  routeOverrides: Record<string, unknown> = {},
): RouterConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    authToken: "router-token",
    defaultModel: "test-model",
    models: [
      {
        id: "test-model",
        displayName: "Test Model",
        api: "chat_completions",
        baseUrl: `${upstreamOrigin}/v1`,
        model: "upstream-model",
        apiKey: "provider-key",
        ...routeOverrides,
      },
    ],
  };
}

async function postJson(origin: string, body: unknown): Promise<Response> {
  return await fetch(`${origin}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: "Bearer router-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function readRequestJson(
  request: http.IncomingMessage,
): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function chatSse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return await response.json();
}

function track(server: http.Server): http.Server {
  servers.push(server);
  return server;
}

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}
