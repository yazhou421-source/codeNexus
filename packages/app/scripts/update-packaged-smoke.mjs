// Launch an unmodified installed bundle with an empty, isolated profile.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.argv[2], "--run");
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp("/private/tmp/calmnova-update-installed-");
const installed = join(root, "installed", "Calmnova Code.app");
await mkdir(dirname(installed));
execFileSync("/usr/bin/ditto", [join(appRoot, "release/mac-arm64/Calmnova Code.app"), installed]);
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", installed]);
const child = spawn(
  join(installed, "Contents/MacOS/Calmnova Code"),
  ["--remote-debugging-port=0", `--user-data-dir=${join(root, "user-data")}`],
  {
    env: {
      PATH: process.env.PATH,
      HOME: root,
      CODEX_HOME: join(root, "codex-home"),
      XDG_CACHE_HOME: join(root, "cache"),
      TMPDIR: process.env.TMPDIR,
      LANG: "zh_CN.UTF-8",
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);
let output = "";
child.stderr.on("data", (data) => {
  output += data;
});
child.stdout.on("data", (data) => {
  output += data;
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let ws;
try {
  for (let i = 0; i < 100 && !output.includes("DevTools listening on"); i++) await delay(100);
  const endpoint = output.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
  assert.ok(endpoint, "Packaged app must expose the requested local diagnostics endpoint");
  const origin = endpoint.replace(/^ws:/, "http:").split("/devtools/")[0];
  let pages = [];
  for (let i = 0; i < 100; i++) {
    pages = await (await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    if (pages.some((p) => p.type === "page")) break;
    await delay(100);
  }
  const page = pages.find((p) => p.type === "page");
  assert.ok(page);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done) => ws.addEventListener("open", done, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const value = JSON.parse(event.data);
    if (value.id) pending.get(value.id)?.(value);
  });
  const rpc = async (method, params = {}) => {
    const messageId = ++id;
    let timer;
    try {
      return await Promise.race([
        new Promise((done) => {
          pending.set(messageId, done);
          ws.send(JSON.stringify({ id: messageId, method, params }));
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      pending.delete(messageId);
    }
  };
  const evaluate = async (expression) => {
    const result = await rpc("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.result?.exceptionDetails, undefined, JSON.stringify(result));
    return result.result.result.value;
  };
  for (let i = 0; i < 100 && !(await evaluate("Boolean(window.codexDesktop && document.querySelector('button'))")); i++)
    await delay(100);
  const initial = await evaluate("window.codexDesktop.app.getUpdateState()");
  assert.equal(initial.currentVersion, "1.0.5");
  assert.equal(initial.isPackaged, true);
  assert.equal(initial.installMode, "manual");
  assert.notEqual(initial.status, "unconfigured");
  // Open settings using the UI. Keep diagnostics limited to this empty profile.
  const buttons = await evaluate(
    "Array.from(document.querySelectorAll('button')).map(b=>({text:b.innerText,aria:b.getAttribute('aria-label'),title:b.title}))"
  );
  await evaluate(
    "(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>/^(设置|Settings)$/.test(b.title||b.getAttribute('aria-label')||b.innerText));b?.click();return Boolean(b)})()"
  );
  await delay(500);
  await evaluate(
    "(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>/^(更新|应用更新|App updates)$/.test(b.innerText.trim()));b?.click();return Boolean(b)})()"
  );
  await delay(500);
  const body = await evaluate("document.body.innerText");
  const screenshot = await rpc("Page.captureScreenshot", { format: "png" });
  const report = resolve(appRoot, "../../docs/update-v1/validation");
  await writeFile(join(report, "packaged-update.png"), Buffer.from(screenshot.result.data, "base64"));
  await delay(3500);
  const afterStartup = await evaluate("window.codexDesktop.app.getUpdateState()");
  assert.ok(afterStartup.checkedAt, "Delayed startup check must run");
  const result = { root, installed, initial, afterStartup, buttons, body };
  await writeFile(join(report, "packaged-smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ root, initial, afterStartup }, null, 2));
  // Browser.close follows Electron's normal app shutdown path.
  await rpc("Browser.close");
} finally {
  ws?.close();
  for (let i = 0; i < 100 && child.exitCode === null; i++) await delay(100);
  if (child.exitCode === null) child.kill("SIGTERM");
  await writeFile(join(root, "app.log"), output);
  console.log(`Isolated app exit: ${child.exitCode}`);
}
