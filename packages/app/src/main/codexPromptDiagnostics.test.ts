import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(appRoot, "../..");

describe("Codex prompt diagnostics safety", () => {
  it("uses isolated synthetic state and always removes its temporary directory", async () => {
    const script = await readFile(resolve(appRoot, "scripts/codex-prompt-diagnostics.mjs"), "utf8");

    expect(script).toContain('mkdtemp(join(tmpdir(), "calmnova-prompt-diagnostics-")');
    expect(script).toContain("CODEX_HOME: codexHome");
    expect(script).toContain("apiKey: providerKey");
    expect(script).toContain("const providerKey = randomUUID()");
    expect(script).toContain("await rm(temporaryRoot, { recursive: true, force: true })");
    expect(script).not.toContain("ProviderSecretStore");
    expect(script).not.toContain('app.getPath("userData")');
    expect(script).not.toContain("DEEPSEEK_API_KEY");
  });

  it("does not persist captured payloads and exposes an explicit package command", async () => {
    const [script, rootPackage, appPackage] = await Promise.all([
      readFile(resolve(appRoot, "scripts/codex-prompt-diagnostics.mjs"), "utf8"),
      readFile(resolve(repositoryRoot, "package.json"), "utf8"),
      readFile(resolve(appRoot, "package.json"), "utf8"),
    ]);

    expect(script).not.toContain('writeFile(join(temporaryRoot, "responses.json")');
    expect(script).not.toContain('writeFile(join(temporaryRoot, "chat.json")');
    expect(rootPackage).toContain('"codex:prompt:diagnostics"');
    expect(appPackage).toContain('"codex:prompt:diagnostics"');
  });
});
