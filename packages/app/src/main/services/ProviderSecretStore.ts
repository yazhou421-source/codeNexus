import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";

type EncryptedStoreFile = {
  version: 1;
  secrets: Record<string, { encrypted: string }>;
};

export type ProviderSecretEncryption = {
  isAvailable(): boolean;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
};

export class ElectronSafeStorageEncryption implements ProviderSecretEncryption {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  encrypt(plaintext: string): Buffer {
    return safeStorage.encryptString(plaintext);
  }

  decrypt(ciphertext: Buffer): string {
    return safeStorage.decryptString(ciphertext);
  }
}

export class ProviderSecretStore {
  private encryptedByProvider = new Map<string, string>();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly encryption: ProviderSecretEncryption
  ) {}

  get path(): string {
    return this.filePath;
  }

  get encryptionAvailable(): boolean {
    return this.encryption.isAvailable();
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.encryptedByProvider = parseEncryptedStore(parsed);
    } catch (error: any) {
      this.encryptedByProvider.clear();
      if (String(error?.code ?? "") !== "ENOENT") {
        this.loaded = true;
        throw providerSecretError("malformed_secret_store", "Provider credential store is unavailable.");
      }
    }
    this.loaded = true;
  }

  isConfigured(providerId: string): boolean {
    this.assertLoaded();
    return this.encryptedByProvider.has(normalizeProviderId(providerId));
  }

  resolve(providerId: string): string | undefined {
    this.assertLoaded();
    const encrypted = this.encryptedByProvider.get(normalizeProviderId(providerId));
    if (!encrypted) return undefined;
    if (!this.encryptionAvailable) {
      throw providerSecretError("secure_storage_unavailable", "Secure credential storage is unavailable.");
    }
    try {
      const plaintext = this.encryption.decrypt(decodeCiphertext(encrypted)).trim();
      return plaintext || undefined;
    } catch {
      throw providerSecretError("credential_decryption_failed", "Provider credential cannot be decrypted.");
    }
  }

  async save(providerId: string, apiKey: string): Promise<void> {
    this.assertLoaded();
    const normalizedId = normalizeProviderId(providerId);
    const plaintext = String(apiKey ?? "").trim();
    if (!plaintext) throw providerSecretError("invalid_api_key", "Provider API key is required.");
    if (!this.encryptionAvailable) {
      throw providerSecretError("secure_storage_unavailable", "Secure credential storage is unavailable.");
    }
    let encrypted: string;
    try {
      encrypted = this.encryption.encrypt(plaintext).toString("base64");
    } catch {
      throw providerSecretError("credential_encryption_failed", "Provider credential could not be encrypted.");
    }
    await this.enqueueWrite((next) => {
      next.set(normalizedId, encrypted);
    });
  }

  async delete(providerId: string): Promise<void> {
    this.assertLoaded();
    const normalizedId = normalizeProviderId(providerId);
    await this.enqueueWrite((next) => {
      next.delete(normalizedId);
    });
  }

  private assertLoaded(): void {
    if (!this.loaded) throw providerSecretError("secret_store_not_loaded", "Provider credential store is not ready.");
  }

  private async enqueueWrite(mutate: (next: Map<string, string>) => void): Promise<void> {
    const task = this.writeQueue.then(async () => {
      const next = new Map(this.encryptedByProvider);
      mutate(next);
      await writeEncryptedStore(this.filePath, next);
      this.encryptedByProvider = next;
    });
    this.writeQueue = task.catch(() => undefined);
    return await task;
  }
}

function parseEncryptedStore(value: unknown): Map<string, string> {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.secrets)) {
    throw new Error("invalid provider credential store");
  }
  const result = new Map<string, string>();
  for (const [providerId, entry] of Object.entries(value.secrets)) {
    if (!isRecord(entry) || typeof entry.encrypted !== "string") {
      throw new Error("invalid provider credential entry");
    }
    const normalizedId = normalizeProviderId(providerId);
    decodeCiphertext(entry.encrypted);
    result.set(normalizedId, entry.encrypted);
  }
  return result;
}

async function writeEncryptedStore(filePath: string, values: ReadonlyMap<string, string>): Promise<void> {
  const secrets = Object.create(null) as EncryptedStoreFile["secrets"];
  for (const [providerId, encrypted] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    secrets[providerId] = { encrypted };
  }
  const payload: EncryptedStoreFile = { version: 1, secrets };
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function decodeCiphertext(value: string): Buffer {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("invalid encrypted provider credential");
  }
  const decoded = Buffer.from(normalized, "base64");
  if (!decoded.length || decoded.toString("base64") !== normalized) {
    throw new Error("invalid encrypted provider credential");
  }
  return decoded;
}

function normalizeProviderId(value: unknown): string {
  const providerId = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(providerId)) {
    throw providerSecretError("invalid_provider_id", "Provider ID is invalid.");
  }
  return providerId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerSecretError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
