import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";
import { verifyAssets, verifyTag } from "./verify-update-release.mjs";

it.each(["v1.0.4", "1.0.5", "v1.0.5-beta.1"])("rejects mismatched release tag %s", (tag) => {
  expect(() => verifyTag("1.0.5", tag)).toThrow();
});
it("checks artifact names, hashes, sizes and excludes secret/path-bearing metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "calmnova-release-check-"));
  try {
    const bytes = Buffer.from("fixture artifact");
    const sha512 = createHash("sha512").update(bytes).digest("base64");
    const names = ["zip", "dmg"].map((ext) => `Calmnova-Code-1.0.5-arm64.${ext}`);
    for (const name of names) {
      await writeFile(join(dir, name), bytes);
      await writeFile(join(dir, `${name}.blockmap`), "map");
    }
    const info = {
      version: "1.0.5",
      files: names.map((url) => ({ url, sha512, size: bytes.length })),
      path: names[0],
      sha512,
      releaseDate: "2026-09-07T00:00:00Z",
    };
    const save = async (value) => writeFile(join(dir, "latest-mac.yml"), stringify(value));
    await save(info);
    expect((await verifyAssets(dir, "1.0.5")).sha512).toBe("verified");
    for (const mutate of [
      (v) => {
        v.version = "1.0.6";
      },
      (v) => {
        v.files[0].url = "/Users/name/private.zip";
      },
      (v) => {
        v.files[0].sha512 = "bad";
      },
      (v) => {
        v.files[0].size = 1;
      },
      (v) => {
        v.token = "secret";
      },
      (v) => {
        v.files.pop();
      },
    ]) {
      const bad = structuredClone(info);
      mutate(bad);
      await save(bad);
      await expect(verifyAssets(dir, "1.0.5")).rejects.toThrow();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("keeps release publishing gated behind all checks, draft-only and tag-only", () => {
  const workflow = parse(readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8"));
  expect(workflow.on).toEqual({ push: { tags: ["v*"] } });
  expect(workflow.permissions.contents).toBe("write");
  const job = workflow.jobs["macos-arm64"];
  expect(job.if).toContain("github.repository == 'yazhou421-source/codeNexus'");
  const steps = job.steps;
  expect(steps.find((s) => s.name === "Full verification")?.run).toBe("pnpm run ci");
  expect(steps.findIndex((s) => s.run === "pnpm run ci")).toBeLessThan(
    steps.findIndex((s) => s.name?.startsWith("Create draft"))
  );
  expect(steps.find((s) => s.name?.startsWith("Create draft")).with.script).toContain("draft: true");
  expect(steps.find((s) => s.name?.startsWith("Upload without")).run).not.toContain("--clobber");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  expect(pkg.scripts.dist).toContain("--publish never");
});

const credentialNames = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const signingCredentials = { CSC_LINK: "fixture-certificate.p12", CSC_KEY_PASSWORD: "fixture-password" };
const notarizationCredentials = {
  APPLE_ID: "fixture@example.invalid",
  APPLE_APP_SPECIFIC_PASSWORD: "fixture-app-password",
  APPLE_TEAM_ID: "FIXTURETEAM",
};

async function runPackageStep(credentials, failCommand = "") {
  const workflow = parse(readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8"));
  const step = workflow.jobs["macos-arm64"].steps.find((s) => s.name?.startsWith("Package ("));
  expect(step.shell).toBe("bash");
  expect(step.env).toEqual(Object.fromEntries(credentialNames.map((name) => [name, `\${{ secrets.${name} }}`])));
  const dir = await mkdtemp(join(tmpdir(), "calmnova-package-env-"));
  const trace = join(dir, "trace.jsonl");
  try {
    // Real child processes capture only fixture credentials, never the host environment.
    const mock = `#!${process.execPath}
const fs = require("node:fs");
const command = require("node:path").basename(process.argv[1]);
const names = ${JSON.stringify([...credentialNames, "CSC_IDENTITY_AUTO_DISCOVERY"])};
fs.appendFileSync(process.env.TRACE, JSON.stringify({
  command, args: process.argv.slice(2),
  env: Object.fromEntries(names.filter(name => Object.hasOwn(process.env, name)).map(name => [name, process.env[name]]))
}) + "\\n");
if (command === process.env.FAIL_COMMAND) process.exit(42);
`;
    for (const command of ["pnpm", "codesign", "xcrun"]) {
      await writeFile(join(dir, command), mock, { mode: 0o755 });
    }
    const result = spawnSync("/bin/bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", step.run], {
      cwd: dir,
      encoding: "utf8",
      env: {
        PATH: dir,
        TRACE: trace,
        FAIL_COMMAND: failCommand,
        ...Object.fromEntries(credentialNames.map((name) => [name, ""])),
        ...credentials,
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    const calls = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse);
    return { status: result.status, calls };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

it.each([
  ["empty secrets", {}, false, false],
  ["signing credentials", signingCredentials, true, false],
  ["certificate without password", { CSC_LINK: signingCredentials.CSC_LINK }, true, false],
  ["complete notarization credentials", { ...signingCredentials, ...notarizationCredentials }, true, true],
  ["notarization credentials without certificate", notarizationCredentials, false, false],
  ...Object.keys(notarizationCredentials).map((missing) => [
    `notarization missing ${missing}`,
    { ...signingCredentials, ...notarizationCredentials, [missing]: "" },
    true,
    false,
  ]),
])("packages with %s without leaking empty credential variables", async (_label, credentials, signed, notarize) => {
  const { status, calls } = await runPackageStep(credentials);
  expect(status).toBe(0);
  expect(calls.map((call) => call.command)).toEqual([
    "pnpm",
    ...(signed ? ["codesign"] : []),
    ...(notarize ? ["xcrun"] : []),
  ]);
  const builder = calls[0];
  expect(builder.env).toEqual({
    ...Object.fromEntries(Object.entries(credentials).filter(([, value]) => value !== "")),
    CSC_IDENTITY_AUTO_DISCOVERY: String(signed),
  });
  expect(builder.args).toEqual([
    "--filter",
    "@codenexus/app",
    "exec",
    "electron-builder",
    "--config",
    "electron-builder.yml",
    "--mac",
    "dmg",
    "zip",
    "--arm64",
    "--publish",
    "never",
    ...(signed ? ["-c.forceCodeSigning=true"] : []),
    `-c.mac.notarize=${notarize}`,
  ]);
  const app = "packages/app/release/mac-arm64/Calmnova Code.app";
  if (signed) expect(calls[1].args).toEqual(["--verify", "--deep", "--strict", app]);
  if (notarize) expect(calls[2].args).toEqual(["stapler", "validate", app]);
});

it.each(["pnpm", "codesign", "xcrun"])("fails the Package step when %s fails", async (command) => {
  const { status, calls } = await runPackageStep({ ...signingCredentials, ...notarizationCredentials }, command);
  expect(status).toBe(42);
  const order = ["pnpm", "codesign", "xcrun"];
  expect(calls.map((call) => call.command)).toEqual(order.slice(0, order.indexOf(command) + 1));
});
