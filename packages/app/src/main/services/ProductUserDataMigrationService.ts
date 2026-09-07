import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { LEGACY_PRODUCT_NAME, PRODUCT_NAME } from "../productIdentity";

export const PRODUCT_USER_DATA_MIGRATION_VERSION = 1 as const;
export const PRODUCT_USER_DATA_MIGRATION_MARKER = "product-identity-migration.json";
const PRESERVED_DIRECTORY = "legacy-preserved";

const ACTIVE_DIRECTORIES = new Set(["backups", "generated-images"]);
const VOLATILE_OR_RUNTIME_ENTRIES = new Set([
  "blob_storage",
  "Cache",
  "Code Cache",
  "Crashpad",
  "DevToolsActivePort",
  "DIPS",
  "DIPS-wal",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUCache",
  "GraphiteDawnCache",
  "Local Storage",
  "Network",
  "Network Persistent State",
  "Preferences",
  "Session Storage",
  "Shared Dictionary",
  "SharedStorage",
  "SharedStorage-wal",
  "SingletonCookie",
  "SingletonLock",
  "SingletonSocket",
  "Trust Tokens",
  "Trust Tokens-journal",
]);
const ACTIVE_FILES = new Set([
  "user-settings.json",
  "thread-history-cache.json",
  "draft-state.json",
  "message-outbox.json",
  "codex-profiles.json",
  "codex-skill-roots.json",
  "codex-config-switcher.json",
  "image-generation-history.json",
  "image-generation-tasks.json",
  "flowchart-history.json",
  "thread-tasks.json",
  "thread-artifacts.json",
  "thread-title-overrides.json",
]);

const MERGE_STRATEGIES: Readonly<Record<string, MergeStrategy>> = {
  "user-settings.json": { kind: "deep", expectedVersion: null },
  "thread-history-cache.json": { kind: "array", collection: "items", key: "id", expectedVersion: 2 },
  "draft-state.json": { kind: "record", collection: "threads", expectedVersion: 1 },
  "message-outbox.json": { kind: "record-arrays", collection: "threads", key: "id", expectedVersion: 1 },
  "thread-tasks.json": { kind: "array", collection: "tasks", key: ["threadId", "taskId"], expectedVersion: 1 },
  "thread-artifacts.json": { kind: "array", collection: "artifacts", key: "artifactId", expectedVersion: 1 },
  "thread-title-overrides.json": { kind: "record", collection: "overrides", expectedVersion: 1 },
  "codex-profiles.json": { kind: "array", collection: "profiles", key: "id", expectedVersion: 1 },
  "codex-skill-roots.json": { kind: "record", collection: "rootsByWorkspace", expectedVersion: 1 },
  "codex-config-switcher.json": {
    kind: "multi-array",
    collections: ["profiles", "skills", "backups"],
    key: "id",
    expectedVersion: 1,
  },
  "image-generation-history.json": { kind: "array", collection: "items", key: "id", expectedVersion: 1 },
  "image-generation-tasks.json": { kind: "array", collection: "tasks", key: "id", expectedVersion: 1 },
  "flowchart-history.json": { kind: "array", collection: "items", key: "id", expectedVersion: 1 },
  "embedded-router/provider-secrets.json": { kind: "record", collection: "secrets", expectedVersion: 1 },
  "embedded-router/provider-preferences.json": { kind: "record", collection: "providers", expectedVersion: 1 },
};

type MergeStrategy =
  | { kind: "deep"; expectedVersion: number | null }
  | { kind: "record"; collection: string; expectedVersion: number }
  | { kind: "record-arrays"; collection: string; key: string; expectedVersion: number }
  | { kind: "array"; collection: string; key: string | readonly string[]; expectedVersion: number }
  | { kind: "multi-array"; collections: readonly string[]; key: string; expectedVersion: number };

export type ProductUserDataMigrationFailure = {
  relativePath: string;
  code: "invalid-data" | "copy-failed" | "credential-validation-failed";
};

export type ProductUserDataMigrationMarker = {
  version: typeof PRODUCT_USER_DATA_MIGRATION_VERSION;
  fromProduct: typeof LEGACY_PRODUCT_NAME;
  toProduct: typeof PRODUCT_NAME;
  status: "complete" | "partial";
  migratedAt: string;
  legacyDataPreserved: true;
  copiedFiles: number;
  mergedFiles: number;
  preservedFiles: number;
  failures: ProductUserDataMigrationFailure[];
};

export type ProductUserDataMigrationResult =
  | { status: "not-needed" | "already-complete"; marker: ProductUserDataMigrationMarker | null }
  | { status: "complete" | "partial"; marker: ProductUserDataMigrationMarker }
  | { status: "failed"; marker: null };

export type ProductUserDataMigrationOptions = {
  legacyPath: string;
  currentPath: string;
  now?: () => string;
  validateProviderSecrets?: (filePath: string) => Promise<void>;
  migrateProviderSecrets?: (legacyFilePath: string, currentFilePath: string) => Promise<void>;
};

export async function migrateProductUserDataFailSoft(
  options: ProductUserDataMigrationOptions,
  warn: (message: string, error: unknown) => void = () => undefined
): Promise<ProductUserDataMigrationResult> {
  try {
    return await migrateProductUserData(options);
  } catch (error) {
    warn("legacy profile migration failed; the original profile remains unchanged", error);
    return { status: "failed", marker: null };
  }
}

export async function migrateProductUserData(
  options: ProductUserDataMigrationOptions
): Promise<ProductUserDataMigrationResult> {
  const legacyPath = options.legacyPath;
  const currentPath = options.currentPath;
  if (!legacyPath || !currentPath || legacyPath === currentPath) return { status: "not-needed", marker: null };
  if (!(await isDirectory(legacyPath))) return { status: "not-needed", marker: null };

  const markerPath = join(currentPath, PRODUCT_USER_DATA_MIGRATION_MARKER);
  const existingMarker = await readMigrationMarker(markerPath);
  if (existingMarker?.status === "complete") return { status: "already-complete", marker: existingMarker };

  await mkdir(currentPath, { recursive: true });
  const counters = { copiedFiles: 0, mergedFiles: 0, preservedFiles: 0 };
  const failures: ProductUserDataMigrationFailure[] = [];

  for (const file of ACTIVE_FILES) {
    await migrateActiveFile(file, options, counters, failures);
  }
  await migrateProviderSecrets(options, counters, failures);
  await migrateActiveFile("embedded-router/provider-preferences.json", options, counters, failures);

  for (const directory of ACTIVE_DIRECTORIES) {
    await copyTreeMissing(
      join(legacyPath, directory),
      join(currentPath, directory),
      counters,
      failures,
      directory,
      false
    );
  }

  await preserveUnknownEntries(options, counters, failures);

  const secretPath = join(currentPath, "embedded-router", "provider-secrets.json");
  if (options.validateProviderSecrets && (await isFile(secretPath))) {
    try {
      await options.validateProviderSecrets(secretPath);
    } catch {
      failures.push({
        relativePath: "embedded-router/provider-secrets.json",
        code: "credential-validation-failed",
      });
    }
  }

  const marker: ProductUserDataMigrationMarker = {
    version: PRODUCT_USER_DATA_MIGRATION_VERSION,
    fromProduct: LEGACY_PRODUCT_NAME,
    toProduct: PRODUCT_NAME,
    status: failures.length ? "partial" : "complete",
    migratedAt: options.now?.() ?? new Date().toISOString(),
    legacyDataPreserved: true,
    ...counters,
    failures,
  };
  await writeJsonAtomic(markerPath, marker, 0o600);
  return { status: marker.status, marker };
}

async function migrateProviderSecrets(
  options: ProductUserDataMigrationOptions,
  counters: { copiedFiles: number; mergedFiles: number; preservedFiles: number },
  failures: ProductUserDataMigrationFailure[]
): Promise<void> {
  const relativePath = "embedded-router/provider-secrets.json";
  const source = join(options.legacyPath, relativePath);
  if (!(await isFile(source))) return;
  if (!options.migrateProviderSecrets) {
    await migrateActiveFile(relativePath, options, counters, failures);
    return;
  }
  const destination = join(options.currentPath, relativePath);
  const existed = await pathExists(destination);
  try {
    validatePayload(relativePath, await readJson(source), MERGE_STRATEGIES[relativePath]);
    await options.migrateProviderSecrets(source, destination);
    if (existed) counters.mergedFiles += 1;
    else counters.copiedFiles += 1;
  } catch {
    failures.push({ relativePath, code: "credential-validation-failed" });
    await preserveOne(
      source,
      join(options.currentPath, PRESERVED_DIRECTORY, relativePath),
      counters,
      failures,
      relativePath
    );
  }
}

async function migrateActiveFile(
  relativePath: string,
  options: ProductUserDataMigrationOptions,
  counters: { copiedFiles: number; mergedFiles: number; preservedFiles: number },
  failures: ProductUserDataMigrationFailure[]
): Promise<void> {
  const source = join(options.legacyPath, relativePath);
  if (!(await isFile(source))) return;
  const destination = join(options.currentPath, relativePath);
  const strategy = MERGE_STRATEGIES[relativePath];
  try {
    if (!(await pathExists(destination))) {
      if (strategy) validatePayload(relativePath, await readJson(source), strategy);
      await copyFileAtomic(source, destination, relativePath.includes("provider-secrets") ? 0o600 : undefined);
      counters.copiedFiles += 1;
      return;
    }
    if (!strategy) return;
    const legacyValue = await readJson(source);
    const currentValue = await readJson(destination);
    validatePayload(relativePath, legacyValue, strategy);
    validatePayload(relativePath, currentValue, strategy);
    const merged = mergePayloads(legacyValue, currentValue, strategy);
    await writeJsonAtomic(destination, merged, relativePath.includes("provider-secrets") ? 0o600 : undefined);
    counters.mergedFiles += 1;
  } catch {
    failures.push({ relativePath, code: "invalid-data" });
    await preserveOne(
      source,
      join(options.currentPath, PRESERVED_DIRECTORY, relativePath),
      counters,
      failures,
      relativePath
    );
  }
}

async function preserveUnknownEntries(
  options: ProductUserDataMigrationOptions,
  counters: { copiedFiles: number; mergedFiles: number; preservedFiles: number },
  failures: ProductUserDataMigrationFailure[]
): Promise<void> {
  const entries = await readdir(options.legacyPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (
      ACTIVE_FILES.has(entry.name) ||
      ACTIVE_DIRECTORIES.has(entry.name) ||
      VOLATILE_OR_RUNTIME_ENTRIES.has(entry.name) ||
      entry.name === "embedded-router"
    ) {
      continue;
    }
    await copyTreeMissing(
      join(options.legacyPath, entry.name),
      join(options.currentPath, PRESERVED_DIRECTORY, entry.name),
      counters,
      failures,
      entry.name,
      true
    );
  }

  const routerRoot = join(options.legacyPath, "embedded-router");
  if (!(await isDirectory(routerRoot))) return;
  for (const entry of await readdir(routerRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === "provider-secrets.json" || entry.name === "provider-preferences.json") continue;
    await copyTreeMissing(
      join(routerRoot, entry.name),
      join(options.currentPath, PRESERVED_DIRECTORY, "embedded-router", entry.name),
      counters,
      failures,
      `embedded-router/${entry.name}`,
      true
    );
  }
}

async function copyTreeMissing(
  source: string,
  destination: string,
  counters: { copiedFiles: number; mergedFiles: number; preservedFiles: number },
  failures: ProductUserDataMigrationFailure[],
  displayPath: string,
  preserved: boolean
): Promise<void> {
  let info;
  try {
    info = await lstat(source);
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    failures.push({ relativePath: displayPath, code: "copy-failed" });
    return;
  }
  if (info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) {
      await copyTreeMissing(
        join(source, entry),
        join(destination, entry),
        counters,
        failures,
        `${displayPath}/${entry}`,
        preserved
      );
    }
    return;
  }
  if (!info.isFile() || (await pathExists(destination))) return;
  try {
    await copyFileAtomic(source, destination, preserved ? 0o600 : info.mode & 0o777);
    if (preserved) counters.preservedFiles += 1;
    else counters.copiedFiles += 1;
  } catch {
    failures.push({ relativePath: displayPath, code: "copy-failed" });
  }
}

async function preserveOne(
  source: string,
  destination: string,
  counters: { copiedFiles: number; mergedFiles: number; preservedFiles: number },
  failures: ProductUserDataMigrationFailure[],
  displayPath: string
): Promise<void> {
  if (await pathExists(destination)) return;
  try {
    await copyFileAtomic(source, destination, 0o600);
    counters.preservedFiles += 1;
  } catch {
    failures.push({ relativePath: displayPath, code: "copy-failed" });
  }
}

function mergePayloads(legacy: unknown, current: unknown, strategy: MergeStrategy): unknown {
  if (strategy.kind === "deep") return deepMergePreferCurrent(legacy, current);
  const oldRecord = legacy as Record<string, unknown>;
  const newRecord = current as Record<string, unknown>;
  if (strategy.kind === "record") {
    return {
      ...oldRecord,
      ...newRecord,
      [strategy.collection]: {
        ...(oldRecord[strategy.collection] as Record<string, unknown>),
        ...(newRecord[strategy.collection] as Record<string, unknown>),
      },
    };
  }
  if (strategy.kind === "record-arrays") {
    const oldCollections = oldRecord[strategy.collection] as Record<string, unknown[]>;
    const newCollections = newRecord[strategy.collection] as Record<string, unknown[]>;
    const keys = new Set([...Object.keys(oldCollections), ...Object.keys(newCollections)]);
    const mergedCollections: Record<string, unknown[]> = {};
    for (const key of keys) {
      mergedCollections[key] = mergeArrays(oldCollections[key] ?? [], newCollections[key] ?? [], strategy.key);
    }
    return { ...oldRecord, ...newRecord, [strategy.collection]: mergedCollections };
  }
  if (strategy.kind === "multi-array") {
    const merged: Record<string, unknown> = { ...oldRecord, ...newRecord };
    for (const collection of strategy.collections) {
      merged[collection] = mergeArrays(
        oldRecord[collection] as unknown[],
        newRecord[collection] as unknown[],
        strategy.key
      );
    }
    return merged;
  }
  return {
    ...oldRecord,
    ...newRecord,
    [strategy.collection]: mergeArrays(
      oldRecord[strategy.collection] as unknown[],
      newRecord[strategy.collection] as unknown[],
      strategy.key
    ),
  };
}

function mergeArrays(legacy: unknown[], current: unknown[], key: string | readonly string[]): unknown[] {
  const keys: readonly string[] = typeof key === "string" ? [key] : key;
  const identity = (value: unknown): string => {
    if (!isRecord(value)) return JSON.stringify(value);
    return keys.map((name) => String(value[name] ?? "")).join("\u0000");
  };
  const currentIds = new Set(current.map(identity));
  return [...legacy.filter((entry) => !currentIds.has(identity(entry))), ...current];
}

function deepMergePreferCurrent(legacy: unknown, current: unknown): unknown {
  if (!isRecord(legacy) || !isRecord(current)) return current;
  const result: Record<string, unknown> = { ...legacy };
  for (const [key, currentValue] of Object.entries(current)) {
    result[key] = key in legacy ? deepMergePreferCurrent(legacy[key], currentValue) : currentValue;
  }
  return result;
}

function validatePayload(relativePath: string, value: unknown, strategy: MergeStrategy): void {
  if (!isRecord(value)) throw new Error(`invalid ${relativePath}`);
  if (strategy.expectedVersion !== null && value.version !== strategy.expectedVersion) {
    throw new Error(`unsupported ${relativePath} version`);
  }
  if (strategy.kind === "record" && !isRecord(value[strategy.collection])) throw new Error("invalid record");
  if (strategy.kind === "record-arrays") {
    const collection = value[strategy.collection];
    if (!isRecord(collection)) throw new Error("invalid record arrays");
    if (Object.values(collection).some((entry) => !Array.isArray(entry))) {
      throw new Error("invalid record array entry");
    }
  }
  if (strategy.kind === "array" && !Array.isArray(value[strategy.collection])) throw new Error("invalid array");
  if (strategy.kind === "multi-array" && strategy.collections.some((collection) => !Array.isArray(value[collection]))) {
    throw new Error("invalid multi array");
  }
  if (relativePath === "embedded-router/provider-secrets.json") validateSecretStore(value);
  if (relativePath === "embedded-router/provider-preferences.json") validatePreferenceStore(value);
}

function validateSecretStore(value: Record<string, unknown>): void {
  for (const [providerId, entry] of Object.entries(value.secrets as Record<string, unknown>)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(providerId) || !isRecord(entry)) throw new Error("invalid secret");
    const encrypted = entry.encrypted;
    if (typeof encrypted !== "string" || !encrypted || encrypted.length % 4 !== 0) throw new Error("invalid secret");
    const decoded = Buffer.from(encrypted, "base64");
    if (!decoded.length || decoded.toString("base64") !== encrypted) throw new Error("invalid secret");
  }
}

function validatePreferenceStore(value: Record<string, unknown>): void {
  for (const [providerId, entry] of Object.entries(value.providers as Record<string, unknown>)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(providerId) || !isRecord(entry)) {
      throw new Error("invalid preference");
    }
    if (typeof entry.enabled !== "boolean" || !Array.isArray(entry.modelIds)) throw new Error("invalid preference");
    if (entry.modelIds.some((modelId) => typeof modelId !== "string" || !modelId.trim())) {
      throw new Error("invalid preference");
    }
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readMigrationMarker(path: string): Promise<ProductUserDataMigrationMarker | null> {
  try {
    const value = await readJson(path);
    if (
      isRecord(value) &&
      value.version === PRODUCT_USER_DATA_MIGRATION_VERSION &&
      value.fromProduct === LEGACY_PRODUCT_NAME &&
      value.toProduct === PRODUCT_NAME &&
      (value.status === "complete" || value.status === "partial")
    ) {
      return value as ProductUserDataMigrationMarker;
    }
  } catch {}
  return null;
}

async function copyFileAtomic(source: string, destination: string, mode?: number): Promise<void> {
  const data = await readFile(source);
  await writeAtomic(destination, data, mode);
}

async function writeJsonAtomic(path: string, value: unknown, mode?: number): Promise<void> {
  await writeAtomic(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"), mode);
}

async function writeAtomic(path: string, value: Buffer, mode?: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, value, { mode: mode ?? 0o600 });
    await rename(temporaryPath, path);
    if (mode !== undefined) await chmod(path, mode);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isPathInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !value.startsWith(sep));
}
