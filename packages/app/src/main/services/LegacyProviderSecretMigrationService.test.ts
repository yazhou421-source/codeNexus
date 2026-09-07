import { mkdtemp, readFile, rm } from "node:fs/promises";
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

import type { ProviderSecretEncryption } from "./ProviderSecretStore";
import { ProviderSecretStore } from "./ProviderSecretStore";
import {
  LEGACY_PROVIDER_SECRET_HELPER_ARG,
  isLegacyProviderSecretHelper,
  reencryptLegacyProviderSecrets,
} from "./LegacyProviderSecretMigrationService";

const roots: string[] = [];

const currentEncryption: ProviderSecretEncryption = {
  isAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(`new:${Buffer.from(plaintext).toString("base64")}`),
  decrypt: (ciphertext) => {
    const value = ciphertext.toString();
    if (!value.startsWith("new:")) throw new Error("wrong product identity");
    return Buffer.from(value.slice(4), "base64").toString();
  },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LegacyProviderSecretMigrationService", () => {
  it("recognizes only the dedicated helper argument", () => {
    expect(isLegacyProviderSecretHelper(["app", LEGACY_PROVIDER_SECRET_HELPER_ARG])).toBe(true);
    expect(isLegacyProviderSecretHelper(["app", "--user-data-dir=/tmp/CodeNexus"])).toBe(false);
  });

  it("re-encrypts legacy plaintext under the current identity without persisting plaintext", async () => {
    const root = await mkdtemp(join(tmpdir(), "calmnova-secret-reencrypt-"));
    roots.push(root);
    const path = join(root, "provider-secrets.json");

    const result = await reencryptLegacyProviderSecrets({
      currentFilePath: path,
      encryption: currentEncryption,
      decryptLegacySecrets: async () => ({
        version: 1,
        secrets: { deepseek: "synthetic-legacy-secret" },
        failedProviderIds: [],
      }),
    });

    expect(result).toEqual({ migratedProviderIds: ["deepseek"], retainedProviderIds: [] });
    expect(await readFile(path, "utf8")).not.toContain("synthetic-legacy-secret");
    const store = new ProviderSecretStore(path, currentEncryption);
    await store.load();
    expect(store.resolve("deepseek")).toBe("synthetic-legacy-secret");
  });

  it("keeps valid current credentials but replaces ciphertext left by a partial identity migration", async () => {
    const root = await mkdtemp(join(tmpdir(), "calmnova-secret-conflict-"));
    roots.push(root);
    const path = join(root, "provider-secrets.json");
    const store = new ProviderSecretStore(path, currentEncryption);
    await store.load();
    await store.save("deepseek", "current-wins");

    await reencryptLegacyProviderSecrets({
      currentFilePath: path,
      encryption: currentEncryption,
      decryptLegacySecrets: async () => ({
        version: 1,
        secrets: { deepseek: "legacy-loses", kimi: "legacy-recovers" },
        failedProviderIds: [],
      }),
    });
    const migrated = new ProviderSecretStore(path, currentEncryption);
    await migrated.load();
    expect(migrated.resolve("deepseek")).toBe("current-wins");
    expect(migrated.resolve("kimi")).toBe("legacy-recovers");
  });

  it("reports a partial helper failure only after saving providers that decrypted successfully", async () => {
    const root = await mkdtemp(join(tmpdir(), "calmnova-secret-partial-"));
    roots.push(root);
    const path = join(root, "provider-secrets.json");
    await expect(
      reencryptLegacyProviderSecrets({
        currentFilePath: path,
        encryption: currentEncryption,
        decryptLegacySecrets: async () => ({
          version: 1,
          secrets: { deepseek: "valid-legacy-secret" },
          failedProviderIds: ["kimi"],
        }),
      })
    ).rejects.toThrow("one or more legacy credentials could not be decrypted");
    const migrated = new ProviderSecretStore(path, currentEncryption);
    await migrated.load();
    expect(migrated.resolve("deepseek")).toBe("valid-legacy-secret");
  });
});
