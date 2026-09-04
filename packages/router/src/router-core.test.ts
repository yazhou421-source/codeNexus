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
      expect(body.error.code).toBe("missing_provider_api_key");
      expect(body.error.message).toContain(envName);
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

  it("returns a local cooldown response after a provider 429", async () => {
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
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.text()).toMatch(/rate limited|token waste/i);
    expect(await second.text()).toMatch(/rate limited|token waste/i);
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
