#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { buildModelCatalog } from "../../router/src/model-catalog.js";
import { analyzePromptPair } from "../../router/src/prompt-diagnostics.js";
import { createRouterServer } from "../../router/src/server.js";
import { loadRuntimeManifest, runtimeKeyForNode, verifyRuntime } from "./codex-runtime-lib.mjs";

const MODEL_ID = "deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 60_000;
const PROFILE_INSTRUCTIONS = [
  "For every user request to create, draw, render, or generate an image, call the codenexus.image_generate dynamic tool.",
  "If the user's current message includes image attachments, codenexus.image_generate automatically uses those attachments as reference images for image editing.",
  "Do not call image_gen, image_generation, or any official built-in image generation tool.",
  "If codenexus.image_generate is unavailable, explain that image generation is unavailable instead of using another image tool.",
].join("\n");
const IMAGE_DYNAMIC_TOOL = {
  namespace: "codenexus",
  name: "image_generate",
  description:
    `${PROFILE_INSTRUCTIONS} Rewrite the user's request into a complete visual prompt before calling. ` +
    "When image attachments are present in the current user message, they are supplied automatically as reference images; " +
    "do not include image bytes or paths in the tool arguments.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: { type: "string", minLength: 1, description: "A complete image prompt." },
      size: { type: "string", description: "Optional output size." },
      quality: { type: "string", description: "Optional quality hint." },
      output_format: { type: "string", description: "Optional output format." },
      n: { type: "integer", minimum: 1, maximum: 4, description: "Number of images to generate." },
    },
    required: ["prompt"],
  },
  deferLoading: false,
};

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Diagnostic server did not expose a TCP address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

function quoteToml(value) {
  if (value.includes("'") || /[\r\n]/.test(value)) {
    throw new Error("Diagnostic path cannot be represented as a literal TOML string");
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
        if (message.method === "currentTime/read") {
          this.write({ id: message.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } });
          return;
        }
        this.write({
          id: message.id,
          error: { code: -32601, message: `Unsupported diagnostic client request: ${message.method}` },
        });
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

const temporaryRoot = await mkdtemp(join(tmpdir(), "calmnova-prompt-diagnostics-"));
const codexHome = join(temporaryRoot, "codex-home");
const workspace = join(temporaryRoot, "workspace");
const modelCatalogPath = join(temporaryRoot, "model-catalog.json");
const syntheticMcpServerPath = join(temporaryRoot, "synthetic-mcp-server.mjs");
const routerToken = randomUUID();
const providerKey = randomUUID();
const responsesRequests = [];
const chatRequests = [];
const requestScenarios = [];
let activeScenario = "setup";
let activeScenarioRequest = 0;
let scenarioAToolIssued = false;
let upstream;
let router;
let captureProxy;
let client;
let isolatedInventory;

try {
  await Promise.all([
    mkdir(codexHome),
    mkdir(workspace),
    mkdir(join(codexHome, "skills", "synthetic-diagnostic"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(workspace, "README.md"), "# Synthetic prompt diagnostics workspace\n"),
    writeFile(join(workspace, "hello.py"), 'def greet(name):\n    return f"Hello, {name}!"\n'),
    writeFile(
      join(codexHome, "skills", "synthetic-diagnostic", "SKILL.md"),
      [
        "---",
        "name: synthetic-diagnostic",
        "description: Safe isolated skill used only to measure prompt overhead.",
        "---",
        "# Synthetic diagnostic skill",
        "Use this skill only when the synthetic diagnostic request explicitly asks for it.",
        "Never access user files, credentials, networks, or persistent configuration.",
        "",
      ].join("\n")
    ),
    writeFile(
      syntheticMcpServerPath,
      [
        'import { createInterface } from "node:readline";',
        "const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });",
        "const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\\n`);",
        "lines.on('line', (line) => {",
        "  const message = JSON.parse(line);",
        "  if (!Object.hasOwn(message, 'id')) return;",
        "  if (message.method === 'initialize') {",
        "    send(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-diagnostic', version: '0.1.0' } });",
        "  } else if (message.method === 'tools/list') {",
        "    send(message.id, { tools: [{ name: 'lookup', description: 'Look up a synthetic diagnostic value without external access.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Synthetic query text.' } }, required: ['query'], additionalProperties: false } }] });",
        "  } else if (message.method === 'resources/list' || message.method === 'resources/templates/list' || message.method === 'prompts/list') {",
        "    send(message.id, { resources: [], resourceTemplates: [], prompts: [] });",
        "  } else {",
        "    send(message.id, {});",
        "  }",
        "});",
        "",
      ].join("\n")
    ),
  ]);

  upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    chatRequests.push(body);
    response.writeHead(200, { "content-type": "application/json" });
    if (activeScenario === "scenario-a" && !scenarioAToolIssued) {
      scenarioAToolIssued = true;
      response.end(
        JSON.stringify({
          id: "chatcmpl_diagnostic_tool",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: MODEL_ID,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_read_synthetic_hello",
                    type: "function",
                    function: {
                      name: "exec_command",
                      arguments: JSON.stringify({
                        cmd: "sed -n '1,120p' hello.py",
                        workdir: workspace,
                      }),
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        })
      );
      return;
    }
    response.end(
      JSON.stringify({
        id: `chatcmpl_diagnostic_${chatRequests.length}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: MODEL_ID,
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
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
        displayName: "Prompt Diagnostics Model",
        description: "Local synthetic prompt diagnostics model",
        provider: "deepseek",
        api: "chat_completions",
        baseUrl: `${upstreamOrigin}/v1`,
        model: MODEL_ID,
        authMode: "api_key",
        apiKey: providerKey,
        contextWindow: 1_000_000,
      },
    ],
  };
  await writeFile(modelCatalogPath, `${JSON.stringify(buildModelCatalog(routerConfig), null, 2)}\n`);
  router = createRouterServer(routerConfig);
  const routerOrigin = await listen(router);

  captureProxy = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks);
    if (request.method === "POST" && request.url?.endsWith("/responses")) {
      responsesRequests.push(JSON.parse(rawBody.toString("utf8")));
      activeScenarioRequest += 1;
      requestScenarios.push(`${activeScenario}-${activeScenarioRequest}`);
    }
    const forwarded = await fetch(`${routerOrigin}${request.url}`, {
      method: request.method,
      headers: {
        authorization: request.headers.authorization || "",
        "content-type": request.headers["content-type"] || "application/json",
      },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : rawBody,
    });
    response.writeHead(forwarded.status, Object.fromEntries(forwarded.headers.entries()));
    response.end(Buffer.from(await forwarded.arrayBuffer()));
  });
  const captureOrigin = await listen(captureProxy);

  const manifest = await loadRuntimeManifest();
  const runtimeKey = runtimeKeyForNode();
  if (!runtimeKey) throw new Error(`No bundled runtime for ${process.platform}-${process.arch}`);
  const runtime = await verifyRuntime(runtimeKey, { manifest });
  const executable = join(runtime.root, ...runtime.definition.entrypoint.split("/"));
  const localBaseUrl = `${captureOrigin}/v1`;
  const configOverrides = [
    `model_provider=${quoteToml("codenexus-router")}`,
    `model_catalog_json=${quoteToml(modelCatalogPath)}`,
    `model_providers.codenexus-router.name=${quoteToml("CodeNexusPromptDiagnostics")}`,
    `model_providers.codenexus-router.base_url=${quoteToml(localBaseUrl)}`,
    `model_providers.codenexus-router.wire_api=${quoteToml("responses")}`,
    `model_providers.codenexus-router.env_key=${quoteToml("CODENEXUS_ROUTER_TOKEN")}`,
    "model_providers.codenexus-router.requires_openai_auth=false",
    `mcp_servers.synthetic.command=${quoteToml(process.execPath)}`,
    `mcp_servers.synthetic.args=[${quoteToml(syntheticMcpServerPath)}]`,
    "mcp_servers.synthetic.startup_timeout_sec=5",
  ];
  const appServerArgs = configOverrides.flatMap((value) => ["-c", value]);
  appServerArgs.push("app-server", "--listen", "stdio://");
  client = new JsonRpcClient(executable, appServerArgs, {
    cwd: workspace,
    env: { ...process.env, CODEX_HOME: codexHome, CODENEXUS_ROUTER_TOKEN: routerToken },
  });

  await client.request("initialize", {
    clientInfo: { name: "calmnova-prompt-diagnostics", title: "Calmnova Prompt Diagnostics", version: "0.1.0" },
    capabilities: { experimentalApi: true, requestAttestation: false },
  });
  client.notify("initialized");
  const [mcpStatus, skills] = await Promise.all([
    client.request("mcpServerStatus/list", {
      cursor: null,
      limit: 100,
      detail: "toolsAndAuthOnly",
      threadId: null,
    }),
    client.request("skills/list", { cwds: [workspace], forceReload: true }),
  ]);
  isolatedInventory = {
    mcpServers: Array.isArray(mcpStatus?.data) ? mcpStatus.data.length : 0,
    mcpTools: countNestedArraysByKey(mcpStatus, "tools"),
    mcpResources: 0,
    mcpPrompts: 0,
    skills: countNestedArraysByKey(skills, "skills"),
  };
  const startThread = async () => {
    const started = await client.request("thread/start", {
      model: MODEL_ID,
      modelProvider: "codenexus-router",
      cwd: workspace,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      experimentalRawEvents: false,
      config: { "features.image_generation": false },
      dynamicTools: [IMAGE_DYNAMIC_TOOL],
    });
    const threadId = started?.thread?.id;
    if (!threadId) throw new Error("thread/start did not return a thread id");
    return threadId;
  };
  const runTurn = async (threadId, text, scenario) => {
    activeScenario = scenario;
    activeScenarioRequest = 0;
    const turn = await client.request("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      model: MODEL_ID,
      approvalPolicy: "never",
      collaborationMode: {
        mode: "default",
        settings: {
          model: MODEL_ID,
          reasoning_effort: "medium",
          developer_instructions: PROFILE_INSTRUCTIONS,
        },
      },
    });
    await client.waitForNotification(
      "turn/completed",
      (params) => params?.threadId === threadId && params?.turn?.id === turn?.turn?.id
    );
  };

  const scenarioThread = await startThread();
  await runTurn(scenarioThread, "Read hello.py and tell me what it does. Do not modify files.", "scenario-a");
  await runTurn(scenarioThread, "Now tell me the function name.", "scenario-b");
  const noToolThread = await startThread();
  await runTurn(noToolThread, "Reply OK. Do not call tools.", "scenario-c");

  const requests = responsesRequests.map((responsesBody, index) => ({
    scenario: requestScenarios[index] || `request-${index + 1}`,
    ...analyzePromptPair(responsesBody, chatRequests[index]),
  }));
  const firstChatTools = requests[0]?.chat.tools.definitions || [];
  isolatedInventory = {
    ...isolatedInventory,
    mcpTools: firstChatTools.filter((tool) => tool.name.startsWith("mcp__")).length,
    mcpRelatedToolSchemas: firstChatTools.filter((tool) => tool.category === "mcp_tool_schemas").length,
    skills: countAdvertisedSkills(responsesRequests[0]),
  };
  const scenarioTotals = Object.values(
    requests.reduce((totals, request) => {
      const scenario = request.scenario.replace(/-\d+$/, "");
      const total = totals[scenario] || {
        scenario,
        requestCount: 0,
        responsesEstimatedTokens: 0,
        chatEstimatedTokens: 0,
        responsesUtf8Bytes: 0,
        chatUtf8Bytes: 0,
      };
      total.requestCount += 1;
      total.responsesEstimatedTokens += request.responses.total.estimatedTokens;
      total.chatEstimatedTokens += request.chat.total.estimatedTokens;
      total.responsesUtf8Bytes += request.responses.total.utf8Bytes;
      total.chatUtf8Bytes += request.chat.total.utf8Bytes;
      totals[scenario] = total;
      return totals;
    }, {})
  );
  console.info(
    JSON.stringify(
      {
        runtimeVersion: manifest.version,
        synthetic: true,
        estimate: "UTF-8 bytes / 4; not a provider tokenizer count",
        isolatedInventory,
        scenarioTotals,
        requests,
      },
      null,
      2
    )
  );
} finally {
  await client?.stop().catch(() => undefined);
  await Promise.all([close(captureProxy), close(router), close(upstream)]);
  await rm(temporaryRoot, { recursive: true, force: true });
}

function countNestedArraysByKey(value, key) {
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countNestedArraysByKey(item, key), 0);
  }
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (sum, [entryKey, item]) =>
      sum + (entryKey === key && Array.isArray(item) ? item.length : countNestedArraysByKey(item, key)),
    0
  );
}

function countAdvertisedSkills(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countAdvertisedSkills(item), 0);
  if (typeof value === "string" && value.includes("<skills_instructions>")) {
    return value.match(/^- [^:\n]+:/gm)?.length || 0;
  }
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((sum, item) => sum + countAdvertisedSkills(item), 0);
}
