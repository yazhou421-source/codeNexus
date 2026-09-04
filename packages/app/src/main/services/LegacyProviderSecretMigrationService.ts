import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFile, readlink, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { safeStorage } from "electron";
import { ProviderSecretStore, type ProviderSecretEncryption } from "./ProviderSecretStore";

export const LEGACY_PROVIDER_SECRET_HELPER_ARG = "--calmnova-legacy-provider-secret-helper";
const execFileAsync = promisify(execFile);

type LegacySecretHelperPayload = {
  version: 1;
  secrets: Record<string, string>;
  failedProviderIds: string[];
};

type EncryptedHelperResponse = {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type LegacyProviderSecretMigrationResult = {
  migratedProviderIds: string[];
  retainedProviderIds: string[];
};

export function isLegacyProviderSecretHelper(argv: readonly string[]): boolean {
  return argv.includes(LEGACY_PROVIDER_SECRET_HELPER_ARG);
}

export async function runLegacyProviderSecretHelper(): Promise<void> {
  await assertSameExecutableParent();
  const request = parseHelperRequest(await readStdin(128 * 1024));
  if (!safeStorage.isEncryptionAvailable()) throw new Error("legacy secure storage unavailable");
  const source = parseEncryptedStore(JSON.parse(await readFile(request.sourcePath, "utf8")));
  const payload: LegacySecretHelperPayload = { version: 1, secrets: {}, failedProviderIds: [] };
  for (const [providerId, encrypted] of source) {
    try {
      const plaintext = safeStorage.decryptString(Buffer.from(encrypted, "base64")).trim();
      if (!plaintext) throw new Error("empty credential");
      payload.secrets[providerId] = plaintext;
    } catch {
      payload.failedProviderIds.push(providerId);
    }
  }
  const response = encryptHelperPayload(payload, request.transportKey);
  await writeStdout(`${JSON.stringify(response)}\n`);
}

export async function decryptLegacyProviderSecretsWithHelper(options: {
  sourcePath: string;
  legacyUserDataPath: string;
  executablePath: string;
  applicationPath: string;
  defaultApp: boolean;
  timeoutMs?: number;
}): Promise<LegacySecretHelperPayload> {
  const transportKey = randomBytes(32);
  const args = [
    ...(options.defaultApp ? [options.applicationPath] : []),
    LEGACY_PROVIDER_SECRET_HELPER_ARG,
    `--user-data-dir=${options.legacyUserDataPath}`,
  ];
  const child = spawn(options.executablePath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: sanitizedHelperEnvironment(),
  });
  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let settled = false;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return await new Promise<LegacySecretHelperPayload>((resolve, reject) => {
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill(process.platform === "win32" ? undefined : "SIGKILL");
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("legacy credential helper timed out"), timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 1024 * 1024) {
        fail("legacy credential helper returned too much data");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.resume();
    child.on("error", () => fail("legacy credential helper could not start"));
    child.on("exit", (code) => {
      if (settled) return;
      if (code !== 0) {
        fail("legacy credential helper failed");
        return;
      }
      try {
        const encrypted = parseEncryptedHelperResponse(Buffer.concat(stdout).toString("utf8"));
        const payload = decryptHelperPayload(encrypted, transportKey);
        settled = true;
        clearTimeout(timer);
        resolve(payload);
      } catch {
        fail("legacy credential helper returned invalid data");
      }
    });
    child.stdin.end(
      JSON.stringify({
        version: 1,
        sourcePath: options.sourcePath,
        transportKey: transportKey.toString("base64"),
      })
    );
  });
}

async function assertSameExecutableParent(): Promise<void> {
  if (process.platform === "win32") return;
  const executable = await realpath(process.execPath);
  let parentExecutable: string;
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("/bin/ps", ["-p", String(process.ppid), "-o", "comm="], {
      maxBuffer: 16 * 1024,
    });
    parentExecutable = stdout.trim();
  } else {
    parentExecutable = await readlink(`/proc/${process.ppid}/exe`);
  }
  if (!parentExecutable || (await realpath(parentExecutable)) !== executable) {
    throw new Error("legacy credential helper parent is not trusted");
  }
}

function sanitizedHelperEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, VITE_DEV_SERVER_URL: "" };
  for (const name of Object.keys(environment)) {
    if (/(?:api.?key|authorization|password|secret|token)/i.test(name)) delete environment[name];
  }
  return environment;
}

export async function reencryptLegacyProviderSecrets(options: {
  currentFilePath: string;
  encryption: ProviderSecretEncryption;
  decryptLegacySecrets: () => Promise<LegacySecretHelperPayload>;
}): Promise<LegacyProviderSecretMigrationResult> {
  const payload = await options.decryptLegacySecrets();
  const store = new ProviderSecretStore(options.currentFilePath, options.encryption);
  await store.load();
  const migratedProviderIds: string[] = [];
  const retainedProviderIds: string[] = [];
  for (const [providerId, plaintextValue] of Object.entries(payload.secrets)) {
    const plaintext = String(plaintextValue ?? "").trim();
    if (!plaintext) continue;
    if (store.isConfigured(providerId)) {
      try {
        if (store.resolve(providerId)) {
          retainedProviderIds.push(providerId);
          payload.secrets[providerId] = "";
          continue;
        }
      } catch {
        // A prior partial migration may have copied an old-identity ciphertext.
      }
    }
    await store.save(providerId, plaintext);
    payload.secrets[providerId] = "";
    migratedProviderIds.push(providerId);
  }
  if (payload.failedProviderIds.length) throw new Error("one or more legacy credentials could not be decrypted");
  return { migratedProviderIds, retainedProviderIds };
}

function parseHelperRequest(raw: string): { sourcePath: string; transportKey: Buffer } {
  const value = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1 || typeof value.sourcePath !== "string") {
    throw new Error("invalid legacy credential helper request");
  }
  const transportKey = decodeBase64(value.transportKey, 32);
  return { sourcePath: value.sourcePath, transportKey };
}

function parseEncryptedStore(value: unknown): Map<string, string> {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.secrets)) {
    throw new Error("invalid legacy credential store");
  }
  const result = new Map<string, string>();
  for (const [providerId, entry] of Object.entries(value.secrets)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(providerId) || !isRecord(entry)) {
      throw new Error("invalid legacy credential entry");
    }
    result.set(providerId, decodeBase64(entry.encrypted).toString("base64"));
  }
  if (result.size > 64) throw new Error("too many legacy credentials");
  return result;
}

function encryptHelperPayload(payload: LegacySecretHelperPayload, key: Buffer): EncryptedHelperResponse {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptHelperPayload(response: EncryptedHelperResponse, key: Buffer): LegacySecretHelperPayload {
  const decipher = createDecipheriv("aes-256-gcm", key, decodeBase64(response.iv, 12));
  decipher.setAuthTag(decodeBase64(response.tag, 16));
  const value = JSON.parse(
    Buffer.concat([decipher.update(decodeBase64(response.ciphertext)), decipher.final()]).toString("utf8")
  );
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.secrets) || !Array.isArray(value.failedProviderIds)) {
    throw new Error("invalid legacy credential helper payload");
  }
  const secrets: Record<string, string> = {};
  for (const [providerId, plaintext] of Object.entries(value.secrets)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(providerId) || typeof plaintext !== "string") {
      throw new Error("invalid legacy credential helper secret");
    }
    secrets[providerId] = plaintext;
  }
  const failedProviderIds = value.failedProviderIds.map(String);
  return { version: 1, secrets, failedProviderIds };
}

function parseEncryptedHelperResponse(raw: string): EncryptedHelperResponse {
  const value = JSON.parse(raw.trim());
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("invalid legacy credential helper response");
  }
  return value as EncryptedHelperResponse;
}

function decodeBase64(value: unknown, exactLength?: number): Buffer {
  if (typeof value !== "string" || !value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("invalid base64 data");
  }
  const result = Buffer.from(value, "base64");
  if (
    !result.length ||
    result.toString("base64") !== value ||
    (exactLength !== undefined && result.length !== exactLength)
  ) {
    throw new Error("invalid base64 data");
  }
  return result;
}

async function readStdin(maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new Error("legacy credential helper request is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function writeStdout(value: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(value, (error) => (error ? reject(error) : resolve()));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
