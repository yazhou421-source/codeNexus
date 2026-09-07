import { mkdtemp, readFile, writeFile, rm, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairCalmnovaCodexConfig, repairCalmnovaConfigText } from "./codexConfigRepair";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const owned =
  '[model_providers.codenexus-router-codex]\nname = "CodeNexusRouterCodexAuth"\nbase_url = "http://127.0.0.1:15722/codex-auth/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n';
const user =
  '# custom settings\nmodel = "my-model"\n[model_providers.mine]\nbase_url = "http://127.0.0.1:1234/v1"\n[projects."/a b"]\ntrust_level = "trusted"\n';
describe("legacy Router repair", () => {
  it("P0-5 backs up exact bytes, removes only owned settings and is idempotent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "calmnova-repair-"));
    dirs.push(dir);
    const path = join(dir, "config.toml");
    const original =
      'model_provider = "codenexus-router-codex"\nopenai_base_url = "http://localhost:15722/codex-auth/v1"\n' +
      user +
      owned;
    await writeFile(path, original);
    const result = await repairCalmnovaCodexConfig(path);
    expect(result.repaired).toBe(true);
    expect(await readFile(result.backupPath!, "utf8")).toBe(original);
    expect(await readFile(path, "utf8")).toBe(user);
    expect(await repairCalmnovaCodexConfig(path)).toEqual({ repaired: false });
    expect(await readdir(dir)).toHaveLength(2);
  });
  it("retains CRLF, comments, unknown sections and user localhost providers", () => {
    const text = (user + owned).replaceAll("\n", "\r\n");
    expect(repairCalmnovaConfigText(text)).toBe(user.replaceAll("\n", "\r\n"));
    expect(repairCalmnovaConfigText(user)).toBe(user);
  });
  it.each([
    owned.replace("127.0.0.1:15722", "example.com"),
    owned + 'custom_setting = "preserve"\n',
    owned + '[model_providers.codenexus-router-codex.http_headers]\nX = "user"\n',
    'instructions = """\n' + owned + '"""\n',
    'openai_base_url = "http://localhost:15722/codex-auth/v1"\n',
  ])("leaves ambiguous ownership unchanged", (text) => {
    expect(repairCalmnovaConfigText(text)).toBe(text);
  });
  it("does not follow symlinks or touch auth.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "calmnova-repair-"));
    dirs.push(dir);
    await writeFile(join(dir, "auth.json"), "synthetic-auth");
    await symlink(join(dir, "auth.json"), join(dir, "config.toml"));
    expect(await repairCalmnovaCodexConfig(join(dir, "config.toml"))).toEqual({ repaired: false });
    expect(await readFile(join(dir, "auth.json"), "utf8")).toBe("synthetic-auth");
  });
});
