import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { EmbeddedRouterManager } from "./EmbeddedRouterManager";
import { createRouterServer } from "./server.js";
import type { RouterConfig } from "./types";

const managers: EmbeddedRouterManager[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stop()));
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("EmbeddedRouterManager", () => {
  it("starts once, serves health, and stops", async () => {
    const manager = track(new EmbeddedRouterManager());
    const started = await manager.start(testConfig(0));
    expect(started.status).toBe("started");

    const response = await fetch(`${started.origin}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: "codenexus-embedded-router",
      protocolVersion: 1,
    });
    expect(manager.ownedOrigin).toBe(started.origin);
    expect(manager.ownedConnection).toEqual({
      origin: started.origin,
      authToken: "router-token",
      routes: [{ modelId: "test-model", authMode: "api_key" }],
    });

    const duplicate = await manager.start(testConfig(0));
    expect(duplicate).toEqual({ ...started, status: "already-running" });

    await manager.stop();
    expect(manager.running).toBe(false);
  });

  it("identifies a compatible Router without treating it as owned", async () => {
    const first = track(new EmbeddedRouterManager());
    const firstResult = await first.start(testConfig(0));
    expect(firstResult.status).toBe("started");

    const second = track(new EmbeddedRouterManager());
    const secondResult = await second.start(testConfig(firstResult.port));
    expect(secondResult).toMatchObject({
      status: "compatible-router-present",
      port: firstResult.port,
    });
    expect(second.ownedOrigin).toBeNull();
    expect(second.ownedConnection).toBeNull();

    const response = await fetch(`${firstResult.origin}/health`);
    expect(response.ok).toBe(true);
  });

  it("distinguishes a foreign HTTP service from a compatible Router", async () => {
    const foreign = trackServer(
      createServer((_request, response) => {
        response.writeHead(404);
        response.end("not a router");
      }),
    );
    const origin = await listen(foreign);
    const port = Number(new URL(origin).port);

    const manager = track(new EmbeddedRouterManager());
    await expect(manager.start(testConfig(port))).resolves.toMatchObject({
      status: "foreign-port-in-use",
      port,
    });
    expect(manager.ownedOrigin).toBeNull();
    expect(manager.ownedConnection).toBeNull();
  });

  it("rejects a fake successful health response", async () => {
    const fake = trackServer(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, service: "not-codenexus" }));
      }),
    );
    const origin = await listen(fake);
    const port = Number(new URL(origin).port);

    const manager = track(new EmbeddedRouterManager());
    await expect(manager.start(testConfig(port))).resolves.toMatchObject({
      status: "invalid-health-response",
      port,
    });
  });

  it("rejects an oversized health response from an occupied port", async () => {
    const fake = trackServer(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, padding: "x".repeat(8_192) }));
      }),
    );
    const origin = await listen(fake);
    const port = Number(new URL(origin).port);

    const manager = track(new EmbeddedRouterManager());
    await expect(manager.start(testConfig(port))).resolves.toMatchObject({
      status: "invalid-health-response",
      port,
    });
  });

  it("reports a health timeout separately", async () => {
    const hanging = trackServer(createServer(() => undefined));
    const origin = await listen(hanging);
    const port = Number(new URL(origin).port);

    const manager = track(
      new EmbeddedRouterManager(undefined, { healthProbeTimeoutMs: 30 }),
    );
    await expect(manager.start(testConfig(port))).resolves.toMatchObject({
      status: "health-unreachable",
      port,
    });
  });

  it("releases its port so another server can bind after stop", async () => {
    const manager = track(new EmbeddedRouterManager());
    const started = await manager.start(testConfig(0));
    await manager.stop();
    await manager.stop();
    expect(manager.ownedConnection).toBeNull();

    const rebound = trackServer(createServer());
    await listenOnPort(rebound, started.port);
    expect(rebound.listening).toBe(true);
  });

  it("closes active connections and releases the listener on stop", async () => {
    let markUpstreamStarted: (() => void) | undefined;
    const upstreamStarted = new Promise<void>((resolve) => {
      markUpstreamStarted = resolve;
    });
    const upstream = trackServer(
      createServer((_request, response) => {
        markUpstreamStarted?.();
        response.once("close", () => undefined);
      }),
    );
    const upstreamOrigin = await listen(upstream);
    const manager = track(new EmbeddedRouterManager());
    const started = await manager.start({
      ...testConfig(0),
      authToken: "router-token",
      models: [
        {
          id: "test-model",
          displayName: "Test Model",
          api: "chat_completions",
          baseUrl: `${upstreamOrigin}/v1`,
          model: "test-upstream",
          apiKey: "provider-key",
        },
      ],
    });
    const pending = fetch(`${started.origin}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer router-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "test-model", input: "wait" }),
    }).then(
      () => "resolved",
      () => "rejected",
    );
    await upstreamStarted;

    await manager.stop();
    await expect(pending).resolves.toBe("rejected");
    expect(manager.running).toBe(false);

    const rebound = trackServer(createServer());
    await listenOnPort(rebound, started.port);
    expect(rebound.listening).toBe(true);
  });

  it("deduplicates concurrent starts", async () => {
    const manager = track(new EmbeddedRouterManager());
    const [first, second] = await Promise.all([
      manager.start(testConfig(0)),
      manager.start(testConfig(0)),
    ]);
    expect(first.status).toBe("started");
    expect(second).toEqual(first);
  });

  it("reloads an owned Router config without restarting the listener", async () => {
    const manager = track(new EmbeddedRouterManager());
    const initial = testConfig(0);
    const started = await manager.start(initial);
    const firstModels = await fetch(`${started.origin}/v1/models`).then(
      (response) => response.json(),
    );
    expect(firstModels.data.map((model: { id: string }) => model.id)).toEqual([
      "test-model",
    ]);

    manager.updateConfig({
      ...initial,
      models: [
        ...initial.models,
        {
          id: "second-model",
          displayName: "Second Model",
          api: "responses",
          baseUrl: "https://api.example.test/v1",
          model: "second-model",
        },
      ],
    });

    const secondModels = await fetch(`${started.origin}/v1/models`).then(
      (response) => response.json(),
    );
    expect(secondModels.data.map((model: { id: string }) => model.id)).toEqual([
      "test-model",
      "second-model",
    ]);
    expect(manager.ownedConnection?.origin).toBe(started.origin);
    expect(
      manager.ownedConnection?.routes.map((route) => route.modelId),
    ).toEqual(["test-model", "second-model"]);
  });

  it("isolates Codex bearer and local-token Router endpoints", async () => {
    const upstreamAuthorizations: string[] = [];
    const upstream = trackServer(
      createServer(async (request, response) => {
        upstreamAuthorizations.push(
          String(request.headers.authorization ?? ""),
        );
        for await (const _chunk of request) {
          // Drain the controlled request body.
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "resp_test", output: [] }));
      }),
    );
    const upstreamOrigin = await listen(upstream);
    const router = trackServer(
      createRouterServer({
        host: "127.0.0.1",
        port: 0,
        authToken: "router-token",
        defaultModel: "codex-model",
        models: [
          {
            id: "codex-model",
            displayName: "Codex Model",
            api: "responses",
            baseUrl: `${upstreamOrigin}/v1`,
            model: "codex-upstream",
            authMode: "codex_openai",
          },
          {
            id: "api-model",
            displayName: "API Model",
            api: "responses",
            baseUrl: `${upstreamOrigin}/v1`,
            model: "api-upstream",
            authMode: "api_key",
            apiKey: "provider-key",
          },
        ],
      }),
    );
    const origin = await listen(router);

    const codexResponse = await fetch(`${origin}/codex-auth/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer user-codex-auth",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "codex-model", input: "hello" }),
    });
    expect(codexResponse.status).toBe(200);
    expect(upstreamAuthorizations).toEqual(["Bearer user-codex-auth"]);

    const forbiddenApiRoute = await fetch(`${origin}/codex-auth/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer user-codex-auth",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "api-model", input: "hello" }),
    });
    expect(forbiddenApiRoute.status).toBe(403);
    expect(upstreamAuthorizations).toHaveLength(1);

    const wrongLocalToken = await fetch(`${origin}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer user-codex-auth",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "api-model", input: "hello" }),
    });
    expect(wrongLocalToken.status).toBe(401);

    const localResponse = await fetch(`${origin}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer router-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "api-model", input: "hello" }),
    });
    expect(localResponse.status).toBe(200);
    expect(upstreamAuthorizations).toEqual([
      "Bearer user-codex-auth",
      "Bearer provider-key",
    ]);
  });

  it("cannot start listening after stop wins a startup race", async () => {
    const manager = track(new EmbeddedRouterManager());
    const start = manager.start(testConfig(0));
    const stop = manager.stop();
    const result = await start;
    await stop;

    expect(["started", "start-cancelled"]).toContain(result.status);
    expect(manager.running).toBe(false);
    expect(manager.ownedOrigin).toBeNull();
    if (result.port > 0) {
      const rebound = trackServer(createServer());
      await listenOnPort(rebound, result.port);
    }
  });

  it("converts a Responses request to Chat Completions and maps the result back", async () => {
    let upstreamAuthorization = "";
    let upstreamBody: Record<string, unknown> = {};
    const upstream = trackServer(
      createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        upstreamAuthorization = String(request.headers.authorization ?? "");
        upstreamBody = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as Record<string, unknown>;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "chatcmpl_test",
            object: "chat.completion",
            choices: [
              {
                message: { role: "assistant", content: "hello from upstream" },
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          }),
        );
      }),
    );
    const upstreamOrigin = await listen(upstream);

    const router = trackServer(
      createRouterServer({
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
            model: "test-upstream",
            apiKey: "upstream-key",
          },
        ],
      }),
    );
    const routerOrigin = await listen(router);

    const response = await fetch(`${routerOrigin}/v1/responses`, {
      method: "POST",
      headers: {
        authorization: "Bearer router-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "test-model", input: "hello" }),
    });
    const body = (await response.json()) as {
      object?: string;
      output_text?: string;
      usage?: { total_tokens?: number };
    };

    expect(response.status).toBe(200);
    expect(upstreamAuthorization).toBe("Bearer upstream-key");
    expect(upstreamBody).toMatchObject({
      model: "test-upstream",
      stream: false,
    });
    expect(body).toMatchObject({
      object: "response",
      output_text: "hello from upstream",
    });
    expect(body.usage?.total_tokens).toBe(7);
  });
});

function track(manager: EmbeddedRouterManager): EmbeddedRouterManager {
  managers.push(manager);
  return manager;
}

function trackServer(server: Server): Server {
  servers.push(server);
  return server;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function listenOnPort(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}

function testConfig(port: number): RouterConfig {
  return {
    host: "127.0.0.1",
    port,
    authToken: "router-token",
    defaultModel: "test-model",
    models: [
      {
        id: "test-model",
        displayName: "Test Model",
        api: "responses",
        baseUrl: "http://127.0.0.1:9/v1",
        model: "test-upstream",
        authMode: "api_key",
        apiKeyEnv: "CODENEXUS_ROUTER_TEST_API_KEY",
      },
    ],
  };
}
