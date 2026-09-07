// Opt-in packaged macOS test, a separate app identity and loopback-only test feed.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { parse, stringify } from "yaml";

assert.equal(process.argv[2], "--run", "Explicit --run required");
assert.equal(process.platform, "darwin");
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reuse = process.argv[3];
const root = reuse ? resolve(reuse) : join(appRoot, "release", `update-v1-fixture-${Date.now()}`);
assert.ok(root.startsWith(join(appRoot, "release", "update-v1-fixture-")));
await mkdir(root, { recursive: true });
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const builder = require.resolve("electron-builder/cli.js");
const project = join(root, "project");
await mkdir(project, { recursive: true });
await esbuild.build({
  entryPoints: [join(appRoot, "scripts/update-fixture-entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: join(project, "main.cjs"),
});
const config = {
  appId: "com.calmnova.updatefixture",
  productName: "Calmnova Update Fixture",
  executableName: "Calmnova Update Fixture",
  asar: true,
  files: ["main.cjs", "package.json"],
  publish: { provider: "generic", url: "http://127.0.0.1:1/" },
  electronVersion: JSON.parse(await readFile(require.resolve("electron/package.json"), "utf8")).version,
  mac: { identity: "-", target: ["zip"], artifactName: "Calmnova-Fixture-${version}-arm64.${ext}" },
};
for (const version of reuse ? [] : ["0.0.1", "0.0.2"]) {
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({
      name: "calmnova-update-fixture",
      version,
      main: "main.cjs",
      description: "Isolated updater verification",
      author: "Calmnova",
      private: true,
    })
  );
  const configPath = join(root, `builder-${version}.json`);
  await writeFile(
    configPath,
    JSON.stringify({ ...config, directories: { app: project, output: join(root, version) } })
  );
  execFileSync(process.execPath, [builder, "--config", configPath, "--mac", "zip", "--arm64", "--publish", "never"], {
    cwd: appRoot,
    stdio: "pipe",
  });
}
const feed = join(root, "0.0.2");
const original = parse(await readFile(join(feed, "latest-mac.yml"), "utf8"));
let mode = "valid";
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://127.0.0.1").pathname.slice(1);
    if (path === "latest-mac.yml") {
      if (mode === "404") {
        res.writeHead(404);
        res.end();
        return;
      }
      const info = structuredClone(original);
      if (mode === "checksum") {
        info.files[0].sha512 = Buffer.alloc(64).toString("base64");
        info.sha512 = info.files[0].sha512;
      }
      res.end(stringify(info));
      return;
    }
    assert.ok(original.files.some((f) => f.url === path) || path.endsWith(".blockmap"));
    assert.equal(path.includes("/"), false);
    res.writeHead(200, { "Content-Length": (await stat(join(feed, path))).size });
    createReadStream(join(feed, path)).pipe(res);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const results = { root, versions: ["0.0.1", "0.0.2"], phases: [] };
const run = async (native) => {
  const events = [];
  const phaseRoot = join(root, native ? "native" : "fallback");
  await mkdir(phaseRoot, { recursive: true });
  const binary = join(root, "0.0.1/mac-arm64/Calmnova Update Fixture.app/Contents/MacOS/Calmnova Update Fixture");
  // This minimal entry imports only UpdateService, never Provider/Codex modules.
  // HOME/cache/userData are isolated; retain the normal Chromium/macOS sandbox.
  const child = spawn(binary, [], {
    env: {
      PATH: process.env.PATH,
      HOME: phaseRoot,
      TMPDIR: process.env.TMPDIR,
      LANG: "en_US.UTF-8",
      XDG_CACHE_HOME: join(phaseRoot, "cache"),
      CODEX_HOME: join(phaseRoot, "codex-home"),
      CALMNOVA_FIXTURE_ROOT: phaseRoot,
      CALMNOVA_FIXTURE_FEED: `http://127.0.0.1:${server.address().port}/`,
      CALMNOVA_FIXTURE_NATIVE: native ? "1" : "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let requestId = 0;
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const event = JSON.parse(line);
      events.push(event);
      pending.get(event.id)?.(event);
    } catch {
      /* native diagnostics stay local */
    }
  });
  const delay = (ms) => new Promise((done) => setTimeout(done, ms));
  const request = async (op) => {
    const id = ++requestId;
    let timer;
    try {
      return await Promise.race([
        new Promise((done) => {
          pending.set(id, done);
          child.stdin.write(`${JSON.stringify({ id, op })}\n`);
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Fixture timeout: ${op}`)), 60_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  };
  try {
    for (let i = 0; i < 100 && !events.some((e) => e.event === "ready"); i++) await delay(100);
    assert.ok(
      events.some((e) => e.event === "ready" && e.packaged && e.version === "0.0.1"),
      stderr
    );
    if (!native) {
      mode = "404";
      assert.equal((await request("check")).result.status, "error");
      mode = "checksum";
      assert.equal((await request("check")).result.status, "available");
      assert.equal((await request("download")).result.status, "error");
      assert.equal((await request("state")).result.progress, null);
    }
    mode = "valid";
    assert.equal((await request("check")).result.status, "available");
    const download = await request("download");
    assert.equal(download.result.status, "downloaded", JSON.stringify(download));
    assert.ok(
      events.some((e) => e.state?.progress?.transferred > 0),
      "real progress required"
    );
    await request("busy");
    assert.equal((await request("install")).ok, false);
    await request("idle");
    if (!native) assert.equal((await request("install")).ok, true);
    if (native) {
      assert.equal((await request("install")).ok, true);
      for (let i = 0; i < 200 && !events.some((e) => e.event === "native-error" || e.event === "native-ready"); i++)
        await delay(100);
      assert.ok(
        events.some((e) => e.event === "native-error" || e.event === "native-ready"),
        "Native staging must produce a result"
      );
    }
    results.phases.push({
      mode: native ? "native-probe" : "fallback",
      ready: events.find((e) => e.event === "ready"),
      final: (await request("state")).result,
      native: events.filter((e) => e.event?.startsWith("native-")),
      progressEvents: events.filter((e) => e.state?.progress).length,
      checksum: !native ? "rejected; retry passed" : "verified",
    });
    await request("quit");
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await writeFile(join(phaseRoot, "events.json"), JSON.stringify(events, null, 2));
    await writeFile(join(phaseRoot, "stderr.log"), stderr);
  }
};
try {
  await run(false);
  await run(true);
} finally {
  server.close();
  await writeFile(join(root, "result.json"), JSON.stringify(results, null, 2));
}
const zip = await readFile(join(feed, original.files[0].url));
assert.equal(createHash("sha512").update(zip).digest("base64"), original.files[0].sha512);
console.log(JSON.stringify(results, null, 2));
