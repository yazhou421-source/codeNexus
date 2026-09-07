import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
