import { mkdtemp, rm, symlink, mkdir, writeFile, link } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNotSharedCodexConfig, protectCodexConfigRpc } from "./codexConfigProtection";
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
describe("all Codex shared configuration writers", () => {
  it.each(["config/value/write", "config/batchWrite", " config/batchWrite "])(
    "P0-6 rejects %s with default/official paths before dispatch",
    async (method) => {
      for (const filePath of [undefined, null, "", join(homedir(), ".codex/config.toml")]) {
        await expect(
          protectCodexConfigRpc(method, { filePath, keyPath: "model_provider", value: "codenexus-router-codex" })
        ).rejects.toThrow("cannot write shared");
      }
    }
  );
  it("protects environment home, auth, symlink aliases, and permits private files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "calmnova-guard-"));
    dirs.push(dir);
    const home = join(dir, "official");
    await mkdir(home);
    vi.stubEnv("CODEX_HOME", home);
    await writeFile(join(home, "config.toml"), "# user\n");
    await symlink(home, join(dir, "alias"));
    await link(join(home, "config.toml"), join(dir, "hardlink.toml"));
    await expect(assertNotSharedCodexConfig(join(dir, "hardlink.toml"))).rejects.toThrow();
    await expect(assertNotSharedCodexConfig(join(dir, "alias/config.toml"))).rejects.toThrow();
    await expect(assertNotSharedCodexConfig(join(home, "auth.json"))).rejects.toThrow();
    await expect(assertNotSharedCodexConfig(join(dir, "private/config.toml"))).resolves.toBeUndefined();
    await expect(protectCodexConfigRpc("config/read", {})).resolves.toBeUndefined();
  });
});
