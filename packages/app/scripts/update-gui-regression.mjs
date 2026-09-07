// Run the existing synthetic Agent/workspace suite without a real OS credential store.
// The substitution exists only in the compiled temporary harness, never in app/dist.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
assert.equal(process.argv[2], "--run");
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let driver = await readFile(resolve(appRoot, "scripts/workspace-agent-e2e-run.mjs"), "utf8");
driver = 'import { build } from "esbuild";\nimport { readFile, writeFile } from "node:fs/promises";\n' + driver;
const start = driver.indexOf('execFileSync(process.execPath, [resolve(appRoot, "scripts/workspace-agent-e2e.mjs")');
const end = driver.indexOf("\nconst electron =", start);
assert.ok(start > 0 && end > start);
driver =
  driver.slice(0, start) +
  `await build({
  entryPoints: [resolve(appRoot, "scripts/workspace-agent-e2e-entry.ts")], bundle: true,
  platform: "node", format: "cjs", external: ["electron"], outfile: resolve(root, "main.cjs"),
  define: { __TEST_APP_ROOT__: JSON.stringify(appRoot) },
  plugins: [{ name: "isolated-update-regression", setup(plugin) {
    plugin.onLoad({filter: /router\\/src\\/defaultConfig\\.ts$/}, async ({path}) => ({loader: "ts", contents: (await readFile(path,"utf8")).replace("port: 15722", "port: 0")}));
    plugin.onLoad({filter: /src\\/main\\/main\\.ts$/}, async ({path}) => ({loader: "ts", contents: (await readFile(path,"utf8")) + "\\nexport function getTestContext() { return { providerRuntimeService, embeddedRouterManager, codexServerManager, mainWindow, updateService }; }"}));
    plugin.onLoad({filter: /workspace-agent-e2e-entry\\.ts$/}, async ({path}) => ({loader: "ts", contents:
      (await readFile(path,"utf8")).replace('} catch {\\n      emit', '} catch (error) {\\n      emit').replace('errorCode: "CONTROLLED_E2E_FAILED"', 'errorCode: String(error)').replace('case "setup": {', 'case "update-ui": { context.updateService.getState = () => input.state; window.webContents.send("app:update:state", input.state); result = {}; break; } case "setup": {').replace('const { getTestContext } = require',
        'const syntheticSecrets = new Map<string, string>();\\n' +
        'const { ElectronSafeStorageEncryption } = require("../src/main/services/ProviderSecretStore");\\n' +
        'ElectronSafeStorageEncryption.prototype.isAvailable = () => true;\\n' +
        'ElectronSafeStorageEncryption.prototype.encrypt = (text: string) => { const id = randomUUID(); syntheticSecrets.set(id,text); return Buffer.from(id); };\\n' +
        'ElectronSafeStorageEncryption.prototype.decrypt = (bytes: Buffer) => syntheticSecrets.get(bytes.toString()) ?? "";\\n' +
        'const { getTestContext } = require') }));
  }}]
});` +
  driver.slice(end);
const childStart = driver.indexOf("const child = spawn(");
const envStart = driver.indexOf("      PATH: process.env.PATH,", childStart);
assert.ok(childStart > 0 && envStart > childStart);
driver =
  driver.slice(0, childStart) +
  `const child = spawn(electron, [resolve(root, "main.cjs"), "--user-data-dir=" + resolve(root, "user-data")], {
  cwd: appRoot, env: {\n` +
  driver.slice(envStart);
driver = driver.replace("HOME: process.env.HOME,", "HOME: root,");
driver = driver.replace("`HARNESS_${op}_FAILED`", "`HARNESS_${op}_FAILED: ${response.errorCode}`");
driver = driver.replaceAll(".topbar-menu-shell--turn-diff", ".panel-dialog[open]");
driver = driver.replaceAll(
  "document.querySelector('#btn-topbar-turn-diff').click()",
  "(document.querySelector('.panel-dialog[open] .btn-icon') || document.querySelector('#btn-topbar-turn-diff')).click()"
);
driver = driver.replace(
  "  await ui(\n    \"s.get('runtime').model='gpt-5.5';",
  "  await ui(\"s.get('appShell').setLeftSidebarVisible(true);true\");\n  await delay(100);\n  await ui(\n    \"s.get('runtime').model='gpt-5.5';"
);
driver = driver.replace(
  "  passed = true;",
  `
  const snapshot = {status: "available", currentVersion: "1.0.5", latestVersion: "1.0.6", releaseName: "Fixture release", releaseNotes: "Synthetic update notes", releaseDate: "2026-09-07T00:00:00Z", installMode: "manual", updateAvailable: true, downloaded: false, progress: null, errorMessage: null, checkedAt: Date.now(), isPackaged: true};
  await request("update-ui", {state: snapshot});
  await ui("s.get('appShell').setLeftSidebarVisible(false);s.get('appShell').settingsOpen=false;true");
  await waitFor("!!document.querySelector('.topbar-update-notice')", "update_notice");
  await ui("document.querySelector('.topbar-update-notice').click();true");
  await waitFor("document.body.innerText.includes('Synthetic update notes')", "update_settings");
  await request("update-ui", {state: {...snapshot, status:"downloading", progress:{percent:50,transferred:1048576,total:2097152,bytesPerSecond:100}}});
  await waitFor("document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='50' && document.body.innerText.includes('1.0 / 2.0 MB')", "update_progress");
  await request("update-ui", {state: {...snapshot, status:"downloaded", downloaded:true}});
  await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.innerText==='打开下载的安装包') && !document.querySelector('[role=progressbar]')", "update_downloaded");
  await delay(450);
  await request("screenshot");
  await writeFile(resolve(appRoot, "../../docs/update-v1/validation/update-downloaded.png"), await readFile(resolve(root,"gui-smoke.png")));
  await request("update-ui", {state: {...snapshot, status:"error", errorMessage:"Fixture checksum verification failed"}});
  await waitFor("!document.querySelector('[role=progressbar]') && document.body.innerText.includes('Fixture checksum verification failed')", "update_error");
  await delay(450);
  await request("screenshot");
  await writeFile(resolve(appRoot, "../../docs/update-v1/validation/update-error.png"), await readFile(resolve(root,"gui-smoke.png")));
  passed = true;`
);
const temp = resolve(appRoot, ".tmp/update-regression-driver.mjs");
await mkdir(dirname(temp), { recursive: true });
await writeFile(temp, driver);
await writeFile(resolve(appRoot, "../../docs/update-v1/validation/gui-driver.mjs"), driver);
try {
  execFileSync(process.execPath, [temp, "--run"], { stdio: "inherit", timeout: 180_000 });
} finally {
  await rm(temp, { force: true });
}
