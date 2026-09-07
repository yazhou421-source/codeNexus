/*! Test scenarios adapted in part from CodexBridge server tests.
 * Copyright (c) 2026 wangzhezbz. Licensed under the MIT License.
 */
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as zlib from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactSensitiveText } from "./redaction.js";
import { createRouterServer } from "./server.js";
import type { RouterConfig } from "./types";

const servers: http.Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("Router secret redaction", () => {
  it("redacts header, JSON, bearer, URL, and known provider secrets", () => {
    const providerSecret = "sk-provider-secret-123";
    const input = [
      `Authorization: Bearer abc123`,
      `Bearer loose-token`,
      `x-api-key: key-value`,
      `api_key=another-key`,
      `access_token: access-value`,
      `secret=secret-value`,
      `token=token-value`,
      `https://user:password@example.com/v1`,
      `{"api_key":"sk-xxxx","authorization":"Bearer json-token","token":"json-token"}`,
      providerSecret,
    ].join("\n");

    const output = redactSensitiveText(input, [providerSecret]);
    for (const secret of [
      "abc123",
      "loose-token",
      "key-value",
      "another-key",
      "access-value",
      "secret-value",
      "token-value",
      "user",
      "password",
      "sk-xxxx",
      "json-token",
      providerSecret,
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[REDACTED]");
  });

  it("redacts provider environment secrets from logs and client errors", async () => {
    const envName = "CODENEXUS_ROUTER_REDACTION_TEST_KEY";
    const providerSecret = "sk-provider-env-secret";
    const previous = process.env[envName];
    process.env[envName] = providerSecret;
    const upstream = track(
      http.createServer((_request, response) => {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              message: `Authorization: Bearer abc123 x-api-key=${providerSecret} https://user:password@example.com/v1`,
            },
          }),
        );
      }),
    );
    const upstreamOrigin = await listen(upstream);
    const router = track(
      createRouterServer(
        testConfig(upstreamOrigin, {
          apiKey: undefined,
          apiKeyEnv: envName,
        }),
      ),
    );
    const routerOrigin = await listen(router);
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args.map(String).join(" "));
    });

    try {
      await fetch(`${routerOrigin}/${providerSecret}`);
      const response = await postJson(routerOrigin, "router-token", {
        model: "test-model",
        input: "hello",
        previous_response_id: providerSecret,
      });
      const body = JSON.stringify(await response.json());
      const logText = logged.join("\n");
      for (const secret of [providerSecret, "abc123", "user", "password"]) {
        expect(body).not.toContain(secret);
        expect(logText).not.toContain(secret);
      }
      expect(body).toContain("INVALID_RESPONSE");
      expect(logText).toContain("[REDACTED]");
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
    }
  });
});

describe("Router request limits", () => {
  it("rejects a wrong token before reading a declared large body", async () => {
    const router = track(createRouterServer(testConfig("http://127.0.0.1:9")));
    const origin = await listen(router);
    const response = await requestHeadersOnly(origin, {
      authorization: "Bearer wrong-token",
      "content-length": String(100 * 1024 * 1024),
      "content-type": "application/json",
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const router = track(createRouterServer(testConfig("http://127.0.0.1:9")));
    const origin = await listen(router);
    const response = await requestHeadersOnly(origin, {
      authorization: "Bearer router-token",
      "content-length": String(100 * 1024 * 1024),
      "content-type": "application/json",
    });
    expect(response.statusCode).toBe(413);
  });

  it("accepts a normal gzip-compressed request", async () => {
    const { routerOrigin } = await successStack();
    const response = await postCompressed(
      routerOrigin,
      "gzip",
      zlib.gzipSync(JSON.stringify({ model: "test-model", input: "hello" })),
    );
    expect(response.status).toBe(200);
  });

  it("rejects gzip content whose decompressed output exceeds the limit", async () => {
    const router = track(
      createRouterServer({
        ...testConfig("http://127.0.0.1:9"),
        requestLimits: { compressedBytes: 1024, decompressedBytes: 128 },
      }),
    );
    const origin = await listen(router);
    const compressed = zlib.gzipSync(
      JSON.stringify({ model: "test-model", input: "x".repeat(1024) }),
    );
    const response = await postCompressed(origin, "gzip", compressed);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("request_too_large");
  });

  it("returns 400 for malformed gzip without crashing", async () => {
    const router = track(createRouterServer(testConfig("http://127.0.0.1:9")));
    const origin = await listen(router);
    const response = await postCompressed(
      origin,
      "gzip",
      Buffer.from("not-gzip"),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_compressed_body");
  });

  it("accepts a normal brotli-compressed request", async () => {
    const { routerOrigin } = await successStack();
    const response = await postCompressed(
      routerOrigin,
      "br",
      zlib.brotliCompressSync(
        JSON.stringify({ model: "test-model", input: "hello" }),
      ),
    );
    expect(response.status).toBe(200);
  });

  it.skipIf(typeof zlib.zstdCompressSync !== "function")(
    "accepts zstd when the runtime supports it",
    async () => {
      const { routerOrigin } = await successStack();
      const response = await postCompressed(
        routerOrigin,
        "zstd",
        zlib.zstdCompressSync!(
          JSON.stringify({ model: "test-model", input: "hello" }),
        ),
      );
      expect(response.status).toBe(200);
    },
  );
});

async function successStack(): Promise<{ routerOrigin: string }> {
  const upstream = track(
    http.createServer(async (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "chatcmpl_compressed",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
      );
    }),
  );
  const upstreamOrigin = await listen(upstream);
  const router = track(createRouterServer(testConfig(upstreamOrigin)));
  return { routerOrigin: await listen(router) };
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

async function postJson(
  origin: string,
  token: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`${origin}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function postCompressed(
  origin: string,
  encoding: string,
  body: Buffer,
): Promise<Response> {
  return await fetch(`${origin}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: "Bearer router-token",
      "content-encoding": encoding,
      "content-type": "application/json",
    },
    body: new Uint8Array(body),
  });
}

async function requestHeadersOnly(
  origin: string,
  headers: Record<string, string>,
): Promise<http.IncomingMessage> {
  return await new Promise((resolve, reject) => {
    const request = http.request(`${origin}/v1/responses`, {
      method: "POST",
      headers,
    });
    request.once("response", (response) => {
      response.resume();
      resolve(response);
    });
    request.once("error", reject);
    request.flushHeaders();
  });
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
