import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { safeProductError } from "./product-errors.js";
import { testProviderConnection } from "./provider-connection.js";
import type { RouterModelRoute } from "./types";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe("provider connection test", () => {
  it("uses the Router conversion and secret resolver with a minimal localhost request", async () => {
    const requests: Array<{
      authorization: string;
      body: Record<string, unknown>;
    }> = [];
    const origin = await localProvider(async (request, response) => {
      requests.push({
        authorization: String(request.headers.authorization || ""),
        body: await readJson(request),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "OK" } }],
        }),
      );
    });
    const secret = "synthetic-local-connection-secret";

    const result = await testProviderConnection(route(origin), {
      resolveSecret: () => secret,
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: "synthetic",
      modelId: "synthetic-model",
    });
    expect(requests).toEqual([
      {
        authorization: `Bearer ${secret}`,
        body: expect.objectContaining({ stream: false, max_tokens: 1 }),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each([
    [401, "INVALID_API_KEY"],
    [429, "RATE_LIMITED"],
    [503, "PROVIDER_UNAVAILABLE"],
  ])("maps a localhost HTTP %i response to %s", async (status, code) => {
    const origin = await localProvider((_request, response) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { code: "controlled_error", message: "controlled" },
        }),
      );
    });

    let caught: unknown;
    try {
      await testProviderConnection(route(origin), {
        resolveSecret: () => "synthetic-key",
      });
    } catch (error) {
      caught = error;
    }

    expect(safeProductError(caught, route(origin)).code).toBe(code);
  });

  it("times out a stalled localhost provider and closes its connection", async () => {
    let observeClose: (() => void) | undefined;
    const closed = new Promise<void>((resolve) => (observeClose = resolve));
    const origin = await localProvider((request) => {
      request.once("close", () => observeClose?.());
    });

    let caught: unknown;
    try {
      await testProviderConnection(route(origin), {
        resolveSecret: () => "synthetic-key",
        timeoutMs: 20,
      });
    } catch (error) {
      caught = error;
    }

    expect(safeProductError(caught, route(origin)).code).toBe("TIMEOUT");
    await expect(
      Promise.race([
        closed.then(() => "closed"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 1_000)),
      ]),
    ).resolves.toBe("closed");
  });
});

function route(origin: string): RouterModelRoute {
  return {
    id: "synthetic-model",
    displayName: "Synthetic",
    provider: "synthetic",
    api: "chat_completions",
    baseUrl: `${origin}/v1`,
    model: "synthetic-upstream-model",
    apiKeyRef: "synthetic",
  };
}

async function localProvider(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function readJson(
  request: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}
