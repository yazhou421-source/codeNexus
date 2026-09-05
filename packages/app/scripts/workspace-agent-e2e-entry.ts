// Test-only entry: synthetic localhost upstream, no credential persistence.
import { app, dialog } from "electron";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdirSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { CodexAppServer } from "../src/main/codexAppServer";
import { userDataPathFromArgv } from "../src/main/productIdentity";
import { buildModelCatalog } from "../../router/src/model-catalog.js";
declare const __TEST_APP_ROOT__: string;

const root = realpathSync(dirname(process.argv[1]));
if (
  !/^\/private\/tmp\/calmnova-workspace-fix\.[A-Za-z0-9]+$/.test(root) ||
  process.env.CODEX_HOME !== resolve(root, "codex-home") ||
  userDataPathFromArgv(process.argv) !== resolve(root, "user-data")
) {
  throw new Error("Isolated userData and CODEX_HOME required");
}
mkdirSync(resolve(root, "codex-home"), { recursive: true });
app.setAppPath(__TEST_APP_ROOT__);
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
for (const method of ["log", "info", "warn", "error", "debug"] as const) console[method] = () => {};
const calls: { method: string; model?: unknown; threadId?: unknown }[] = [];
const originalRequest = CodexAppServer.prototype.request;
CodexAppServer.prototype.request = function (method, params, ...rest) {
  if (["thread/start", "thread/resume", "turn/start"].includes(method)) {
    calls.push({ method, model: params?.model, threadId: params?.threadId });
  }
  return originalRequest.call(this, method, params, ...rest);
};
const { getTestContext } = require("../src/main/main") as { getTestContext: () => any };
let command = "";
let requests = 0;
let toolResultSeen = false;
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
const upstream = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests += 1;
    if (!command || requests > 2) {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({
          choices: [{ index: 0, delta, finish_reason }],
          ...(finish_reason === "stop" ? { usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } } : {}),
        })}\n\n`
      );
    if (requests === 1) {
      const tool = body.tools?.find((t: any) => /(?:exec|shell)_command/i.test(t?.function?.name || ""));
      if (!tool) throw new Error("MISSING_SHELL_TOOL");
      const name = tool.function.name;
      const args = JSON.stringify(/exec_command/i.test(name) ? { cmd: command } : { command });
      const split = Math.floor(args.length / 2);
      send({
        tool_calls: [
          {
            index: 0,
            id: `call_${randomUUID()}`,
            type: "function",
            function: { name, arguments: args.slice(0, split) },
          },
        ],
      });
      await delay(100);
      send({ tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] }, "tool_calls");
    } else {
      toolResultSeen = body.messages?.some(
        (m: any) => m.role === "tool" && /(?:30|50|fixture-ok)/.test(String(m.content))
      );
      send({ content: "Controlled " });
      await delay(300);
      send({ content: "fixture complete." }, "stop");
    }
    res.end("data: [DONE]\n\n");
  } catch {
    res.destroy();
    emit({ errorCode: "MOCK_UPSTREAM_FAILED" });
  }
});
app.on("before-quit", () => {
  upstream.closeAllConnections();
  upstream.close();
});
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let queue = Promise.resolve();
createInterface({ input: process.stdin, terminal: false }).on("line", (line) => {
  queue = queue.then(async () => {
    let input: any;
    try {
      input = JSON.parse(line);
      const context = getTestContext();
      const window = context.mainWindow;
      if (!window || !context.providerRuntimeService) throw new Error("NOT_READY");
      let result: unknown;
      switch (input.op) {
        case "setup": {
          await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
          const config = context.providerRuntimeService.routerConfig;
          const port = (upstream.address() as { port: number }).port;
          const route = {
            id: "deepseek-v4-flash",
            displayName: "Controlled Flash",
            provider: "deepseek",
            model: "deepseek-v4-flash",
            api: "chat_completions",
            baseUrl: `http://127.0.0.1:${port}/v1`,
            authMode: "api_key",
            apiKey: randomUUID(),
          };
          const syntheticConfig = {
            ...config,
            models: [...config.models.filter((r: any) => r.authMode === "codex_openai"), route],
          };
          context.embeddedRouterManager.updateConfig(syntheticConfig);
          await writeFile(
            context.providerRuntimeService.modelCatalogPath,
            JSON.stringify(buildModelCatalog(syntheticConfig))
          );
          const originalList = context.providerRuntimeService.list.bind(context.providerRuntimeService);
          context.providerRuntimeService.list = () => {
            const snapshot = originalList();
            return {
              ...snapshot,
              providers: snapshot.providers.map((p: any) =>
                p.id !== "deepseek"
                  ? p
                  : {
                      ...p,
                      configured: true,
                      enabled: true,
                      models: p.models.map((m: any) => ({ ...m, selected: m.id === route.id })),
                    }
              ),
            };
          };
          const workspace = resolve(root, "workspace");
          await mkdir(workspace, { recursive: true });
          await writeFile(resolve(workspace, "tracked.txt"), "baseline\n");
          execFileSync("git", ["init", "-q", workspace]);
          execFileSync("git", ["-C", workspace, "add", "tracked.txt"]);
          execFileSync("git", [
            "-C",
            workspace,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "fixture baseline",
          ]);
          // Native picker result is mocked only in this isolated main harness.
          // Production authorization still validates the actual IPC sender.
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] });
          result = { workspace, synthetic: true };
          break;
        }
        case "phase":
          // Only generated fixture commands, never user-provided shell text.
          command =
            (
              {
                create: "printf 'print(10 + 20)\\n' > test_file.py && python3 test_file.py",
                modify:
                  "printf 'print(20 + 30)\\n' > test_file.py && printf 'updated\\n' > tracked.txt && python3 test_file.py",
                rename: "mv test_file.py renamed.py && mkdir fixture_dir && printf fixture-ok",
                delete: "rm renamed.py && rmdir fixture_dir && printf fixture-ok",
                empty: "printf fixture-ok",
              } as Record<string, string>
            )[input.name] || "";
          if (!command) throw new Error("UNKNOWN_PHASE");
          requests = 0;
          toolResultSeen = false;
          calls.length = 0;
          result = { phase: input.name };
          break;
        case "ui":
          result = await window.webContents.executeJavaScript(input.code, true);
          break;
        case "status":
          result = { calls, requests, toolResultSeen };
          break;
        case "screenshot":
          await writeFile(resolve(root, "gui-smoke.png"), (await window.webContents.capturePage()).toPNG());
          result = { captured: true };
          break;
        case "quit":
          app.quit();
          result = { quitting: true };
          break;
        default:
          throw new Error("UNSUPPORTED_COMMAND");
      }
      emit({ id: input.id, ok: true, result });
    } catch {
      emit({ id: input?.id, ok: false, errorCode: "CONTROLLED_E2E_FAILED" });
    }
  });
});
app.whenReady().then(() => emit({ ready: true }));
