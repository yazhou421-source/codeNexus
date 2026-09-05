// Explicit opt-in macOS GUI test. No network Provider and no existing profile.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

assert.equal(process.argv[2], "--run", "Explicit --run opt-in required");
assert.equal(process.platform, "darwin", "This harness requires the macOS profile-protection sandbox");
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp("/private/tmp/calmnova-workspace-fix.");
execFileSync(process.execPath, [resolve(appRoot, "scripts/workspace-agent-e2e.mjs"), root], { stdio: "pipe" });
const electron = createRequire(import.meta.url)("electron");
const child = spawn(
  "/usr/bin/sandbox-exec",
  [
    "-p",
    `(version 1) (allow default) (deny file-read* file-write* (subpath ${JSON.stringify(resolve(process.env.HOME, ".codex"))}))`,
    electron,
    resolve(root, "main.cjs"),
    "--no-sandbox",
    `--user-data-dir=${resolve(root, "user-data")}`,
  ],
  {
    cwd: appRoot,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: "en_US.UTF-8",
      CODEX_HOME: resolve(root, "codex-home"),
    },
    stdio: ["pipe", "pipe", "ignore"],
  }
);
let id = 0;
const pending = new Map();
const exited = new Promise((done) => child.once("exit", done));
createInterface({ input: child.stdout }).on("line", (line) => {
  try {
    const value = JSON.parse(line);
    const item = pending.get(value.id);
    if (item) {
      pending.delete(value.id);
      item(value);
    }
  } catch {
    /* No raw app output is forwarded. */
  }
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function request(op, args = {}) {
  const requestId = ++id;
  let timer;
  const response = await Promise.race([
    new Promise((done) => {
      pending.set(requestId, done);
      child.stdin.write(`${JSON.stringify({ id: requestId, op, ...args })}\n`);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`HARNESS_TIMEOUT_${op}`)), 30000);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    pending.delete(requestId);
  });
  assert.equal(response.ok, true, `HARNESS_${op}_FAILED`);
  return response.result;
}
const ui = (code) => request("ui", { code });
async function waitFor(code, label) {
  for (let i = 0; i < 150; i++) {
    if (await ui(code)) return;
    await delay(200);
  }
  throw new Error(`GUI_TIMEOUT_${label}`);
}
async function send(phase) {
  await request("phase", { name: phase });
  await ui(
    `(async()=>{window.completed=false;const e=document.querySelector('[contenteditable=true]');e.focus();e.textContent=${JSON.stringify(`Run controlled ${phase} fixture.`)};e.dispatchEvent(new InputEvent('input',{bubbles:true}));await new Promise(r=>setTimeout(r,50));document.querySelector('[aria-label="发送消息"]').click();return true})()`
  );
  await waitFor("window.completed === true", phase);
  const status = await request("status");
  assert.equal(status.requests, 2);
  assert.equal(status.toolResultSeen, true);
  assert.equal(
    status.calls.some((c) => c.method === "thread/resume"),
    false
  );
  return status;
}
let passed = false;
try {
  await delay(2500);
  const { workspace } = await request("setup");
  assert.equal(
    await ui(
      `(async()=>{const selected=await window.codexDesktop.workspace.select();return selected===${JSON.stringify(workspace)} && (await window.codexDesktop.workspace.activate({cwd:selected})).ok})()`
    ),
    true
  );
  assert.equal(
    await ui(
      `(async()=>{try{await window.codexDesktop.workspace.readGitDiff({cwd:${JSON.stringify(root)}});return false}catch{return true}})()`
    ),
    true
  );
  assert.equal(
    await ui(
      `(async()=>{try{await window.codexDesktop.app.readDirectory({path:${JSON.stringify(root)},workspaceRoot:${JSON.stringify(root)}});return false}catch{return true}})()`
    ),
    true
  );
  await ui(
    `(async()=>{const p=document.querySelector('#app').__vue_app__._context.provides;window.s=Reflect.ownKeys(p).map(k=>p[k]).find(x=>x&&x._s)._s;s.get('onboarding').completedAt=new Date().toISOString();await s.get('providerRegistry').refresh();s.get('runtime').setWorkspace(${JSON.stringify(workspace)});await s.get('workspaceFiles').ensureReady();s.get('config').draft.model='gpt-5.5';s.get('runtime').model='gpt-5.5';window.deltaCount=0;window.codexDesktop.codexServer.onEvent(p=>{if(p.msg?.method==='turn/completed')window.completed=p.msg.params.turn.status==='completed';if(p.msg?.method==='item/agentMessage/delta')deltaCount++});document.querySelector('#btn-add-thread').click();return true})()`
  );
  await waitFor(
    "!!s.get('runtime').currentThreadId && !s.get('runtime').currentThreadId.startsWith('local-')",
    "eager"
  );
  await ui("window.emptyId=s.get('runtime').currentThreadId;s.get('runtime').model='deepseek-v4-flash';true");
  const first = await send("create");
  assert.equal(first.calls.filter((c) => c.method === "thread/start").length, 1);
  await waitFor(
    "!!document.querySelector('[data-tree-path$=\"/test_file.py\"]') && s.get('workspaceFiles').gitDiff.diffText.includes('+print(10 + 20)')",
    "create_refresh"
  );
  await ui(
    "window.firstId=s.get('runtime').currentThreadId;document.querySelector('#btn-topbar-turn-diff').click();true"
  );
  await waitFor(
    "document.body.innerText.includes('print(10 + 20)') && !!document.querySelector('.topbar-menu-shell--turn-diff')",
    "visible_diff"
  );
  assert.equal(await ui("s.get('thread').localThreads.length===1 && firstId!==emptyId && deltaCount>=2"), true);
  await ui(
    `(async()=>{document.querySelector('#btn-topbar-turn-diff').click();await s.get('workspaceFiles').openFile(${JSON.stringify(resolve(workspace, "tracked.txt"))});s.get('workspaceFiles').setDraftContent('unsaved editor fixture');return true})()`
  );
  await send("modify");
  await waitFor(
    "s.get('workspaceFiles').gitDiff.diffText.includes('-baseline') && s.get('workspaceFiles').gitDiff.diffText.includes('+updated') && s.get('workspaceFiles').gitDiff.diffText.includes('+print(20 + 30)')",
    "modify_diff"
  );
  assert.equal(
    await ui(
      "firstId===s.get('runtime').currentThreadId && s.get('workspaceFiles').activeTab.draftContent==='unsaved editor fixture' && s.get('workspaceFiles').activeEditorTabPath.endsWith('/tracked.txt')"
    ),
    true
  );
  await ui("document.querySelector('#btn-topbar-turn-diff').click();true");
  await waitFor(
    "document.querySelector('.topbar-menu-shell--turn-diff')?.innerText.includes('updated') && document.querySelector('.topbar-menu-shell--turn-diff')?.innerText.includes('baseline')",
    "before_after_visible"
  );
  await delay(400); // Wait for the real menu entrance animation before capture.
  assert.equal(
    await ui(
      "(()=>{const e=document.querySelector('.topbar-menu-shell--turn-diff');const r=e.getBoundingClientRect();return getComputedStyle(e).opacity==='1' && r.width>0 && r.top>=0 && r.right<=innerWidth})()"
    ),
    true
  );
  await request("screenshot");
  await ui("document.querySelector('#btn-topbar-turn-diff').click();true");
  await send("rename");
  await waitFor(
    "!document.querySelector('[data-tree-path$=\"/test_file.py\"]') && !!document.querySelector('[data-tree-path$=\"/renamed.py\"]') && !!document.querySelector('[data-tree-path$=\"/fixture_dir\"]')",
    "rename"
  );
  await send("delete");
  await waitFor(
    "!document.querySelector('[data-tree-path$=\"/renamed.py\"]') && !document.querySelector('[data-tree-path$=\"/fixture_dir\"]') && !s.get('workspaceFiles').gitDiff.diffText.includes('renamed.py')",
    "delete"
  );
  await ui(
    "s.get('runtime').model='gpt-5.5';s.get('config').draft.model='gpt-5.5';document.querySelector('#btn-add-thread').click();true"
  );
  await waitFor(
    "s.get('thread').localThreads.length===2 && s.get('runtime').currentThreadId!==firstId && !s.get('runtime').currentThreadId.startsWith('local-')",
    "second_eager"
  );
  await ui("for(const m of ['deepseek-v4-flash','gpt-5.5','deepseek-v4-flash'])s.get('runtime').model=m;true");
  const last = await send("empty");
  assert.equal(last.calls.filter((c) => c.method === "thread/start").length, 1);
  assert.equal(
    await ui(
      "s.get('thread').localThreads.length===2 && new Set(s.get('thread').localThreads.map(t=>t.id)).size===2 && s.get('timeline').eventsForThread(firstId).length>0"
    ),
    true
  );
  passed = true;
  console.log(
    JSON.stringify({
      passed: true,
      e2e: ["empty-switch-create", "same-thread-modify", "rapid-empty-switch"],
      gui: [
        "automatic-tree",
        "visible-git-head-diff",
        "rename",
        "delete",
        "directory-create-remove",
        "draft-selection-preserved",
        "streaming-deltas",
        "no-duplicate-thread",
      ],
      syntheticOnly: true,
      screenshot: resolve(root, "gui-smoke.png"),
    })
  );
} finally {
  try {
    await request("quit");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, delay(8000)]);
  if (child.exitCode === null) child.kill("SIGTERM");
  // Retain only a successful synthetic screenshot for visual inspection. All
  // profile/rollout/fixture files are removed, even on failure.
  for (const name of ["user-data", "codex-home", "workspace", "main.cjs"])
    await rm(resolve(root, name), { recursive: true, force: true });
  if (!passed) await rm(root, { recursive: true, force: true });
}
