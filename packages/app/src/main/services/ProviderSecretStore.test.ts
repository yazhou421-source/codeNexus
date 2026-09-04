import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plaintext: string) => Buffer.from(`electron:${plaintext}`)),
  decryptString: vi.fn((ciphertext: Buffer) => ciphertext.toString().replace(/^electron:/, "")),
}));

vi.mock("electron", () => ({
  safeStorage: safeStorageMock,
}));

import {
  ElectronSafeStorageEncryption,
  ProviderSecretStore,
  type ProviderSecretEncryption,
} from "./ProviderSecretStore";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function encryption(available = true): ProviderSecretEncryption {
  return {
    isAvailable: () => available,
    encrypt: (plaintext) => Buffer.from(`cipher:${Buffer.from(plaintext).toString("base64")}`),
    decrypt: (ciphertext) => {
      const encoded = ciphertext.toString().replace(/^cipher:/, "");
      return Buffer.from(encoded, "base64").toString();
    },
  };
}

async function store(secure = encryption()) {
  const directory = await mkdtemp(join(tmpdir(), "codenexus-provider-secrets-"));
  directories.push(directory);
  const path = join(directory, "provider-secrets.json");
  const value = new ProviderSecretStore(path, secure);
  await value.load();
  return { path, value };
}

describe("ProviderSecretStore", () => {
  it("adapts Electron safeStorage encrypt and decrypt operations", () => {
    const adapter = new ElectronSafeStorageEncryption();
    const encrypted = adapter.encrypt("adapter-secret");
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.decrypt(encrypted)).toBe("adapter-secret");
    expect(safeStorageMock.encryptString).toHaveBeenCalledWith("adapter-secret");
    expect(safeStorageMock.decryptString).toHaveBeenCalledWith(encrypted);
  });

  it("encrypts and decrypts through the safe-storage adapter without plaintext on disk", async () => {
    const { path, value } = await store();
    const secret = "synthetic-deepseek-secret";
    await value.save("deepseek", secret);

    expect(value.isConfigured("deepseek")).toBe(true);
    expect(value.resolve("deepseek")).toBe(secret);
    const disk = await readFile(path, "utf8");
    expect(disk).not.toContain(secret);
    expect(disk).toContain("encrypted");
  });

  it("fails closed when secure storage is unavailable", async () => {
    const { path, value } = await store(encryption(false));
    await expect(value.save("deepseek", "must-not-be-written")).rejects.toMatchObject({
      code: "secure_storage_unavailable",
    });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("supports rotation and keeps providers isolated", async () => {
    const { value } = await store();
    await value.save("deepseek", "deepseek-first");
    await value.save("kimi", "kimi-secret");
    await value.save("deepseek", "deepseek-second");

    expect(value.resolve("deepseek")).toBe("deepseek-second");
    expect(value.resolve("kimi")).toBe("kimi-secret");
  });

  it("deletes credentials without requiring decryption", async () => {
    const { value } = await store();
    await value.save("deepseek", "deepseek-secret");
    await value.delete("deepseek");
    expect(value.isConfigured("deepseek")).toBe(false);
    expect(value.resolve("deepseek")).toBeUndefined();
  });

  it("fails closed on a malformed encrypted store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codenexus-provider-secrets-malformed-"));
    directories.push(directory);
    const path = join(directory, "provider-secrets.json");
    await writeFile(path, '{"version":1,"secrets":{"deepseek":{"encrypted":"not base64"}}}');
    const value = new ProviderSecretStore(path, encryption());

    await expect(value.load()).rejects.toMatchObject({ code: "malformed_secret_store" });
    expect(value.isConfigured("deepseek")).toBe(false);
  });
});
