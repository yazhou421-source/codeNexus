import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeKeyForBuilder, runtimeKeyForNode, verifyRuntimeFile } from "./codex-runtime-lib.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryFile(contents) {
  const directory = await mkdtemp(join(tmpdir(), "codenexus-codex-runtime-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "runtime.bin");
  await writeFile(path, contents);
  return path;
}

describe("Codex runtime build verification", () => {
  it("accepts a file only when both size and SHA-256 match", async () => {
    const contents = Buffer.from("pinned official asset");
    const path = await temporaryFile(contents);
    await expect(
      verifyRuntimeFile(
        path,
        { size: contents.length, sha256: createHash("sha256").update(contents).digest("hex") },
        "test/runtime.bin"
      )
    ).resolves.toBeUndefined();
  });

  it("rejects checksum and size mismatches", async () => {
    const path = await temporaryFile(Buffer.from("actual"));
    await expect(verifyRuntimeFile(path, { size: 6, sha256: "0".repeat(64) }, "test/runtime.bin")).rejects.toThrow(
      "checksum mismatch"
    );
    await expect(verifyRuntimeFile(path, { size: 999, sha256: "0".repeat(64) }, "test/runtime.bin")).rejects.toThrow(
      "size mismatch"
    );
  });

  it("maps only the two V0.1 supported targets", () => {
    expect(runtimeKeyForNode("darwin", "arm64")).toBe("mac-arm64");
    expect(runtimeKeyForBuilder("win32", 1)).toBe("win-x64");
    expect(runtimeKeyForNode("linux", "x64")).toBeNull();
    expect(runtimeKeyForNode("darwin", "x64")).toBeNull();
  });
});
