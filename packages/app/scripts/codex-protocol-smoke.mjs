#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { buildModelCatalog } from "../../router/src/model-catalog.js";
import { createRouterServer } from "../../router/src/server.js";
import { loadRuntimeManifest, runtimeKeyForNode, verifyRuntime } from "./codex-runtime-lib.mjs";

const REQUEST_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 60_000;
const MODEL_ID = "codenexus-protocol-smoke";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Smoke server did not expose a TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

function quoteToml(value) {
  if (value.includes("'") || /[\r\n]/.test(value)) {
    throw new Error("Smoke path cannot be represented as a literal TOML string");
  }
  return `'${value}'`;
}

class JsonRpcClient {
  constructor(executable, args, options) {
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.notificationWaiters = new Set();
    this.stderr = "";
    this.process = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-32_000);
    });
    this.process.once("error", (error) => this.failAll(error));
    this.process.once("exit", (code, signal) => {
      this.failAll(new Error(`Codex app-server exited (code=${code}, signal=${signal})\n${this.stderr}`));
    });
    this.lines = createInterface({ input: this.process.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.handleLine(line));
  }

  request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = this.nextId++;
    this.write({ id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}\n${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
    });
  }

  notify(method, params) {
    this.write(params === undefined ? { method } : { method, params });
  }

  waitForNotification(method, predicate = () => true, timeoutMs = TURN_TIMEOUT_MS) {
    const existing = this.notifications.find((message) => message.method === method && predicate(message.params));
    if (existing) return Promise.resolve(existing.params);
    return new Promise((resolve, reject) => {
      const waiter = { method, predicate, resolve, reject, timeout: undefined };
      waiter.timeout = setTimeout(() => {
        this.notificationWaiters.delete(waiter);
        reject(new Error(`Timed out waiting for notification ${method}\n${this.stderr}`));
      }, timeoutMs);
      this.notificationWaiters.add(waiter);
    });
  }

  async stop() {
    this.lines.close();
    this.process.stdin.destroy();
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    const exited = new Promise((resolve) => this.process.once("exit", resolve));
    this.process.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill("SIGKILL");
  }

  write(message) {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message && Object.hasOwn(message, "method")) {
      if (Object.hasOwn(message, "id")) {
        this.handleServerRequest(message);
      } else {
        this.notifications.push(message);
        for (const waiter of this.notificationWaiters) {
          if (waiter.method !== message.method || !waiter.predicate(message.params)) continue;
          clearTimeout(waiter.timeout);
          this.notificationWaiters.delete(waiter);
          waiter.resolve(message.params);
        }
      }
      return;
    }
    if (!message || !Object.hasOwn(message, "id")) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (Object.hasOwn(message, "error")) {
      pending.reject(new Error(`${pending.method} failed: ${JSON.stringify(message.error)}`));
    } else {
      pending.resolve(message.result);
    }
  }

  handleServerRequest(message) {
    if (message.method === "currentTime/read") {
      this.write({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } });
      return;
    }
    this.write({
      id: message.id,
      error: { code: -32601, message: `Unsupported smoke client request: ${message.method}` },
    });
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.notificationWaiters.clear();
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "codenexus-codex-protocol-smoke-"));
const codexHome = join(temporaryRoot, "codex-home");
const workspace = join(temporaryRoot, "workspace");
const modelCatalogPath = join(temporaryRoot, "model-catalog.json");
const routerToken = randomUUID();
const providerKey = randomUUID();
let upstream;
let router;
let client;

try {
  await Promise.all([mkdir(codexHome), mkdir(workspace)]);
  const upstreamRequests = [];
  upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    upstreamRequests.push({
      authorization: request.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl_protocol_smoke",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: MODEL_ID,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "bundled protocol smoke ok" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      })
    );
  });
  const upstreamOrigin = await listen(upstream);

  const routerConfig = {
    host: "127.0.0.1",
    port: 0,
    authToken: routerToken,
    defaultModel: MODEL_ID,
    models: [
      {
        id: MODEL_ID,
        displayName: "Protocol Smoke Model",
        description: "Local synthetic protocol smoke model",
        provider: "protocol-smoke",
        api: "chat_completions",
        baseUrl: `${upstreamOrigin}/v1`,
        model: MODEL_ID,
        authMode: "api_key",
        apiKey: providerKey,
      },
    ],
  };
  await writeFile(modelCatalogPath, `${JSON.stringify(buildModelCatalog(routerConfig), null, 2)}\n`);
  router = createRouterServer(routerConfig);
  const routerOrigin = await listen(router);

  const manifest = await loadRuntimeManifest();
  const runtimeKey = runtimeKeyForNode();
  assert(runtimeKey, `No bundled protocol smoke runtime for ${process.platform}-${process.arch}`);
  const runtime = await verifyRuntime(runtimeKey, { manifest });
  const executable = join(runtime.root, ...runtime.definition.entrypoint.split("/"));
  const localBaseUrl = `${routerOrigin}/v1`;
  const codexAuthBaseUrl = `${routerOrigin}/codex-auth/v1`;
  const configOverrides = [
    `model_provider=${quoteToml("codenexus-router-codex")}`,
    `openai_base_url=${quoteToml(codexAuthBaseUrl)}`,
    `model_catalog_json=${quoteToml(modelCatalogPath)}`,
    `model_providers.codenexus-router-codex.name=${quoteToml("CodeNexusRouterCodexAuth")}`,
    `model_providers.codenexus-router-codex.base_url=${quoteToml(codexAuthBaseUrl)}`,
    `model_providers.codenexus-router-codex.wire_api=${quoteToml("responses")}`,
    "model_providers.codenexus-router-codex.requires_openai_auth=true",
    `model_providers.codenexus-router.name=${quoteToml("CodeNexusProtocolSmoke")}`,
    `model_providers.codenexus-router.base_url=${quoteToml(localBaseUrl)}`,
    `model_providers.codenexus-router.wire_api=${quoteToml("responses")}`,
    `model_providers.codenexus-router.env_key=${quoteToml("CODENEXUS_ROUTER_TOKEN")}`,
    "model_providers.codenexus-router.requires_openai_auth=false",
  ];
  const appServerArgs = configOverrides.flatMap((value) => ["-c", value]);
  appServerArgs.push("app-server", "--listen", "stdio://");
  client = new JsonRpcClient(executable, appServerArgs, {
    cwd: workspace,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODENEXUS_ROUTER_TOKEN: routerToken,
    },
  });

  const initialize = await client.request("initialize", {
    clientInfo: { name: "codenexus-protocol-smoke", title: "CodeNexus Protocol Smoke", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  assert(
    (await realpath(initialize?.codexHome ?? "").catch(() => "")) === (await realpath(codexHome)),
    "initialize did not use the isolated CODEX_HOME"
  );
  assert(String(initialize?.userAgent ?? "").includes(manifest.version), "initialize userAgent version mismatch");
  client.notify("initialized");

  const models = await client.request("model/list", { cursor: null, limit: 200, includeHidden: true });
  const smokeModel = models?.data?.find((model) => model.id === MODEL_ID);
  assert(smokeModel?.displayName === "Protocol Smoke Model", "model/list did not load the private model catalog");
  assert(Array.isArray(smokeModel?.supportedReasoningEfforts), "model/list reasoning metadata is malformed");
  assert(Object.hasOwn(models, "nextCursor"), "model/list pagination field is missing");

  const config = await client.request("config/read", { includeLayers: true, cwd: workspace });
  assert(config?.config?.model_provider === "codenexus-router-codex", "config/read did not preserve model_provider");
  assert(config?.config?.openai_base_url === codexAuthBaseUrl, "config/read did not preserve openai_base_url");
  assert(config?.config?.model_catalog_json === modelCatalogPath, "config/read did not preserve model_catalog_json");
  assert(
    config?.config?.model_providers?.["codenexus-router"]?.base_url === localBaseUrl &&
      config?.config?.model_providers?.["codenexus-router"]?.wire_api === "responses" &&
      config?.config?.model_providers?.["codenexus-router"]?.env_key === "CODENEXUS_ROUTER_TOKEN" &&
      config?.config?.model_providers?.["codenexus-router-codex"]?.base_url === codexAuthBaseUrl &&
      config?.config?.model_providers?.["codenexus-router-codex"]?.requires_openai_auth === true,
    "config/read did not preserve model_providers.* overrides"
  );
  assert(Array.isArray(config?.layers), "config/read did not return requested config layers");

  const mcp = await client.request("mcpServerStatus/list", {
    cursor: null,
    limit: 100,
    detail: "toolsAndAuthOnly",
    threadId: null,
  });
  assert(Array.isArray(mcp?.data) && Object.hasOwn(mcp, "nextCursor"), "MCP status response is malformed");

  const skills = await client.request("skills/list", { cwds: [workspace], forceReload: true });
  assert(Array.isArray(skills?.data), "skills/list response is malformed");

  const started = await client.request("thread/start", {
    model: MODEL_ID,
    modelProvider: "codenexus-router",
    cwd: workspace,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: false,
    experimentalRawEvents: false,
  });
  const threadId = started?.thread?.id;
  assert(typeof threadId === "string" && threadId.length > 0, "thread/start did not return a thread id");
  assert(started?.modelProvider === "codenexus-router", "thread/start model provider mismatch");

  const firstTurn = await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: "Reply briefly to initialize the protocol smoke thread.", text_elements: [] }],
    model: MODEL_ID,
    approvalPolicy: "never",
  });
  const firstTurnId = firstTurn?.turn?.id;
  assert(typeof firstTurnId === "string" && firstTurnId.length > 0, "turn/start did not return a turn id");
  const firstCompleted = await client.waitForNotification(
    "turn/completed",
    (params) => params?.threadId === threadId && params?.turn?.id === firstTurnId
  );
  assert(firstCompleted?.turn?.status === "completed", `turn completed with status ${firstCompleted?.turn?.status}`);

  const resumed = await client.request("thread/resume", {
    threadId,
    model: MODEL_ID,
    modelProvider: "codenexus-router",
    cwd: workspace,
    approvalPolicy: "never",
    sandbox: "read-only",
    excludeTurns: true,
  });
  assert(resumed?.thread?.id === threadId, "thread/resume returned a different thread");
  assert(Object.hasOwn(resumed, "itemsBackwardsCursor"), "thread/resume pagination metadata is missing");

  const resumedTurn = await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: "Reply briefly to confirm the resumed protocol smoke.", text_elements: [] }],
    model: MODEL_ID,
    approvalPolicy: "never",
  });
  const resumedTurnId = resumedTurn?.turn?.id;
  assert(typeof resumedTurnId === "string" && resumedTurnId.length > 0, "resumed turn/start did not return a turn id");
  const resumedCompleted = await client.waitForNotification(
    "turn/completed",
    (params) => params?.threadId === threadId && params?.turn?.id === resumedTurnId
  );
  assert(
    resumedCompleted?.turn?.status === "completed",
    `resumed turn completed with status ${resumedCompleted?.turn?.status}`
  );
  assert(upstreamRequests.length === 2, `Expected two Router upstream requests, got ${upstreamRequests.length}`);
  assert(
    upstreamRequests.every((request) => request.authorization === `Bearer ${providerKey}`),
    "Router provider authorization mismatch"
  );
  assert(
    upstreamRequests.every((request) => request.body?.model === MODEL_ID),
    "Router did not preserve the configured upstream model"
  );

  console.info(
    `[codex-protocol-smoke] Codex ${manifest.version} passed initialize, model/list, config/read, ` +
      "MCP status, skills/list, thread/start, thread/resume, and Router-backed turn/start"
  );
} finally {
  await client?.stop().catch(() => undefined);
  await Promise.all([router ? close(router) : undefined, upstream ? close(upstream) : undefined]);
  await rm(temporaryRoot, { recursive: true, force: true });
}
