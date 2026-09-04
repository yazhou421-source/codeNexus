import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  },
}));

import type { EmbeddedRouterManager } from "@codenexus/router";
import { reencryptLegacyProviderSecrets } from "./LegacyProviderSecretMigrationService";
import { migrateProductUserData } from "./ProductUserDataMigrationService";
import { ProviderPreferencesStore } from "./ProviderPreferencesStore";
import { ProviderRuntimeService } from "./ProviderRuntimeService";
import { ProviderSecretStore, type ProviderSecretEncryption } from "./ProviderSecretStore";

const roots: string[] = [];
const syntheticSecret = "synthetic-migration-e2e-secret";

function encryption(identity: string): ProviderSecretEncryption {
  const prefix = `${identity}:`;
  return {
    isAvailable: () => true,
    encrypt: (plaintext) => Buffer.from(`${prefix}${Buffer.from(plaintext).toString("base64")}`),
    decrypt: (ciphertext) => {
      const value = ciphertext.toString();
      if (!value.startsWith(prefix)) throw new Error("different product identity");
      return Buffer.from(value.slice(prefix.length), "base64").toString();
    },
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("CodeNexus to Calmnova Code migration E2E", () => {
  it("keeps onboarding, workspace, history, draft, provider configuration, and model selection usable", async () => {
    const root = await mkdtemp(join(tmpdir(), "calmnova-migration-e2e-"));
    roots.push(root);
    const legacyPath = join(root, "CodeNexus");
    const currentPath = join(root, "Calmnova Code");
    const oldProviderPath = join(legacyPath, "embedded-router");
    const newProviderPath = join(currentPath, "embedded-router");
    const legacyEncryption = encryption("legacy-CodeNexus");
    const currentEncryption = encryption("current-Calmnova-Code");

    const oldSecrets = new ProviderSecretStore(join(oldProviderPath, "provider-secrets.json"), legacyEncryption);
    await oldSecrets.load();
    await oldSecrets.save("deepseek", syntheticSecret);
    const oldPreferences = new ProviderPreferencesStore(join(oldProviderPath, "provider-preferences.json"));
    await oldPreferences.load();
    await oldPreferences.set("deepseek", { enabled: true, modelIds: ["deepseek-v4-flash"] });
    await writeJson(join(legacyPath, "user-settings.json"), {
      runtimeMode: "codex",
      onboarding: { version: 1, status: "completed", selectedService: "deepseek" },
      customProviders: { workspaceRoot: "/tmp/synthetic-workspace" },
    });
    await writeJson(join(legacyPath, "thread-history-cache.json"), {
      version: 2,
      items: [{ id: "thread-1", title: "Migrated thread" }],
    });
    await writeJson(join(legacyPath, "draft-state.json"), {
      version: 1,
      updatedAt: 1,
      threads: { "thread-1": { text: "Migrated draft" } },
    });

    const first = await migrateProductUserData({
      legacyPath,
      currentPath,
      migrateProviderSecrets: async (legacyFilePath, currentFilePath) => {
        await reencryptLegacyProviderSecrets({
          currentFilePath,
          encryption: currentEncryption,
          decryptLegacySecrets: async () => {
            expect(legacyFilePath).toBe(join(oldProviderPath, "provider-secrets.json"));
            const legacy = new ProviderSecretStore(legacyFilePath, legacyEncryption);
            await legacy.load();
            return {
              version: 1,
              secrets: { deepseek: legacy.resolve("deepseek")! },
              failedProviderIds: [],
            };
          },
        });
      },
    });
    expect(first.status).toBe("complete");

    const runtime = new ProviderRuntimeService(
      new ProviderSecretStore(join(newProviderPath, "provider-secrets.json"), currentEncryption),
      new ProviderPreferencesStore(join(newProviderPath, "provider-preferences.json")),
      { updateConfig: vi.fn(), running: true } as unknown as EmbeddedRouterManager,
      join(newProviderPath, "model-catalog.json")
    );
    await runtime.initialize();
    const provider = runtime.list().providers.find((item) => item.id === "deepseek");
    expect(provider).toMatchObject({ configured: true, enabled: true });
    expect(provider?.models.find((model) => model.id === "deepseek-v4-flash")?.selected).toBe(true);
    expect(runtime.resolveSecret("deepseek")).toBe(syntheticSecret);

    const settings = JSON.parse(await readFile(join(currentPath, "user-settings.json"), "utf8"));
    expect(settings.onboarding.status).toBe("completed");
    expect(settings.customProviders.workspaceRoot).toBe("/tmp/synthetic-workspace");
    expect(JSON.parse(await readFile(join(currentPath, "thread-history-cache.json"), "utf8")).items).toHaveLength(1);
    expect(JSON.parse(await readFile(join(currentPath, "draft-state.json"), "utf8")).threads["thread-1"].text).toBe(
      "Migrated draft"
    );
    expect(await readFile(join(newProviderPath, "provider-secrets.json"), "utf8")).not.toContain(syntheticSecret);
    expect(await migrateProductUserData({ legacyPath, currentPath })).toMatchObject({ status: "already-complete" });
    expect(await readFile(join(legacyPath, "user-settings.json"), "utf8")).toContain("completed");
  });
});
