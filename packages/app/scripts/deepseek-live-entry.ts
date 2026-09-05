// Test-only Electron entry. The production build does not include this file.
import { app } from "electron";
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fetchDeepSeekModels, reconcileDeepSeekModels } from "../../router/src/deepseek-evaluation.js";
import { providerDefinition } from "@codenexus/router";
import { userDataPathFromArgv } from "../src/main/productIdentity";
declare const __LIVE_APP_ROOT__: string;

// Refuse normal profiles. No test API is available in the production bundle.
const isolatedRoot = realpathSync(dirname(process.argv[1]));
if (
  !/^\/private\/tmp\/calmnova-deepseek-3-2c1\.[A-Za-z0-9]+$/.test(isolatedRoot) ||
  process.env.CODEX_HOME !== resolve(isolatedRoot, "codex-home") ||
  userDataPathFromArgv(process.argv) !== resolve(isolatedRoot, "user-data")
) {
  throw new Error("An isolated userData and CODEX_HOME are required");
}
app.setAppPath(__LIVE_APP_ROOT__);
// Capture only known-safe Router timing/count logs; never raw errors or chunks.
const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const metrics: string[] = [];
for (const method of ["log", "info", "warn", "error", "debug"] as const) {
  console[method] = (...args: unknown[]) => {
    if (typeof args[0] !== "string") return;
    const text = args[0];
    const safe =
      text.match(
        /stream route=deepseek-[a-z0-9-]+ ttfb_ms=\d+ first_upstream_delta_ms=-?\d+ first_downstream_delta_ms=-?\d+ complete_ms=\d+(?: reasoning_characters=\d+)?$/
      )?.[0] ?? text.match(/usage prompt=\d+ completion=\d+ total=\d+$/)?.[0];
    if (safe) metrics.push(safe);
  };
}
// require deliberately follows setAppPath and safe log setup.
// This export exists only in the opt-in esbuild output, not in production main.
const { getLiveContext } = require("../src/main/main") as {
  getLiveContext: () => any;
};

if (process.stdin.isTTY) process.stdin.setRawMode(true);
const commands = createInterface({ input: process.stdin, terminal: false });
let queue = Promise.resolve();
commands.on("line", (line) => {
  queue = queue.then(async () => {
    let command: any;
    try {
      command = JSON.parse(line);
      const context = getLiveContext();
      const window = context.mainWindow;
      if (!window || !context.providerRuntimeService) throw new Error("NOT_READY");
      let result: unknown;
      switch (command.op) {
        case "path": {
          if (!["chat_completions", "responses"].includes(command.path)) throw new Error("INVALID_PATH");
          const config = context.providerRuntimeService.routerConfig;
          context.embeddedRouterManager.updateConfig({
            ...config,
            models: config.models.map((r: any) => (r.provider === "deepseek" ? { ...r, api: command.path } : r)),
          });
          result = { path: command.path, productionDefaultUnchanged: true };
          break;
        }
        case "models": {
          const service = context.providerRuntimeService;
          const route = service.routerConfig.models.find((r: any) => r.id === "deepseek-v4-flash");
          const live = await fetchDeepSeekModels(route, { resolveSecret: service.resolveSecret });
          result = {
            ...live,
            reconciliation: live.ok
              ? reconcileDeepSeekModels(providerDefinition("deepseek").models, live.models)
              : null,
          };
          break;
        }
        case "status": {
          const snapshot = context.providerRuntimeService.list();
          result = {
            secureStorageAvailable: snapshot.secureStorageAvailable,
            deepseek: snapshot.providers.find((p: any) => p.id === "deepseek"),
          };
          break;
        }
        case "ui":
          // Evaluation stays in the sandboxed renderer and uses existing IPC.
          // Operator must never inspect password inputs, clipboard, or auth APIs.
          result = await window.webContents.executeJavaScript(command.code, true);
          break;
        case "metrics":
          result = metrics.splice(0);
          break;
        case "quit":
          app.quit();
          result = { quitting: true };
          break;
        default:
          throw new Error("UNSUPPORTED_COMMAND");
      }
      emit({ id: command.id, ok: true, result });
    } catch {
      emit({ id: command?.id, ok: false, errorCode: "EVALUATION_FAILED" });
    }
  });
});
app.whenReady().then(() => emit({ ready: true }));
