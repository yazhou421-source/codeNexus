import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRODUCT_USER_DATA_MIGRATION_MARKER,
  migrateProductUserData,
  migrateProductUserDataFailSoft,
} from "./ProductUserDataMigrationService";

const roots: string[] = [];

async function createPaths() {
  const root = await mkdtemp(join(tmpdir(), "calmnova migration with spaces-"));
  roots.push(root);
  return { root, legacyPath: join(root, "CodeNexus"), currentPath: join(root, "Calmnova Code") };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ProductUserDataMigrationService", () => {
  it("does nothing for a clean install", async () => {
    const paths = await createPaths();
    await expect(migrateProductUserData(paths)).resolves.toEqual({ status: "not-needed", marker: null });
  });

  it("copies active data, preserves unknown files, retains the source, and writes a versioned marker", async () => {
    const paths = await createPaths();
    await writeJson(join(paths.legacyPath, "user-settings.json"), {
      onboarding: { version: 1, status: "completed" },
      workspace: { recentPaths: ["/项目/alpha"] },
    });
    await writeFile(join(paths.legacyPath, "diagnostic.log"), "legacy log", "utf8");

    const result = await migrateProductUserData({ ...paths, now: () => "2026-09-04T00:00:00.000Z" });

    expect(result.status).toBe("complete");
    expect(await readJson(join(paths.currentPath, "user-settings.json"))).toMatchObject({
      onboarding: { status: "completed" },
      workspace: { recentPaths: ["/项目/alpha"] },
    });
    expect(await readFile(join(paths.currentPath, "legacy-preserved", "diagnostic.log"), "utf8")).toBe("legacy log");
    expect(await readFile(join(paths.legacyPath, "diagnostic.log"), "utf8")).toBe("legacy log");
    expect(await readJson(join(paths.currentPath, PRODUCT_USER_DATA_MIGRATION_MARKER))).toMatchObject({
      version: 1,
      fromProduct: "CodeNexus",
      toProduct: "Calmnova Code",
      status: "complete",
      legacyDataPreserved: true,
      failures: [],
    });
  });

  it("merges settings deeply with current data winning conflicts", async () => {
    const paths = await createPaths();
    await writeJson(join(paths.legacyPath, "user-settings.json"), {
      runtimeMode: "custom",
      onboarding: { status: "completed", selectedService: "deepseek" },
      workspace: { recentPaths: ["/legacy"], legacyOnly: true },
    });
    await writeJson(join(paths.currentPath, "user-settings.json"), {
      runtimeMode: "codex",
      onboarding: { status: "in_progress" },
      workspace: { recentPaths: ["/current"] },
    });

    await migrateProductUserData(paths);
    expect(await readJson(join(paths.currentPath, "user-settings.json"))).toEqual({
      runtimeMode: "codex",
      onboarding: { status: "in_progress", selectedService: "deepseek" },
      workspace: { recentPaths: ["/current"], legacyOnly: true },
    });
  });

  it("merges provider preferences and ciphertext without exposing or overwriting current credentials", async () => {
    const paths = await createPaths();
    const oldCiphertext = Buffer.from("old-encrypted-value").toString("base64");
    const currentCiphertext = Buffer.from("current-encrypted-value").toString("base64");
    await writeJson(join(paths.legacyPath, "embedded-router", "provider-secrets.json"), {
      version: 1,
      secrets: { deepseek: { encrypted: oldCiphertext }, kimi: { encrypted: oldCiphertext } },
    });
    await writeJson(join(paths.currentPath, "embedded-router", "provider-secrets.json"), {
      version: 1,
      secrets: { deepseek: { encrypted: currentCiphertext } },
    });
    await writeJson(join(paths.legacyPath, "embedded-router", "provider-preferences.json"), {
      version: 1,
      providers: { deepseek: { enabled: true, modelIds: ["deepseek-chat"] } },
    });

    const validateProviderSecrets = vi.fn(async () => undefined);
    await migrateProductUserData({ ...paths, validateProviderSecrets });
    const stored = await readJson(join(paths.currentPath, "embedded-router", "provider-secrets.json"));
    expect(stored.secrets.deepseek.encrypted).toBe(currentCiphertext);
    expect(stored.secrets.kimi.encrypted).toBe(oldCiphertext);
    expect(JSON.stringify(stored)).not.toContain("old-encrypted-value");
    expect(validateProviderSecrets).toHaveBeenCalledTimes(1);
    expect(await readJson(join(paths.currentPath, "embedded-router", "provider-preferences.json"))).toEqual({
      version: 1,
      providers: { deepseek: { enabled: true, modelIds: ["deepseek-chat"] } },
    });
  });

  it("merges history records by identity with current records winning", async () => {
    const paths = await createPaths();
    await writeJson(join(paths.legacyPath, "thread-history-cache.json"), {
      version: 2,
      items: [
        { id: "shared", title: "old" },
        { id: "legacy", title: "legacy-only" },
      ],
    });
    await writeJson(join(paths.currentPath, "thread-history-cache.json"), {
      version: 2,
      items: [
        { id: "shared", title: "current" },
        { id: "current", title: "current-only" },
      ],
    });

    await migrateProductUserData(paths);
    expect((await readJson(join(paths.currentPath, "thread-history-cache.json"))).items).toEqual([
      { id: "legacy", title: "legacy-only" },
      { id: "shared", title: "current" },
      { id: "current", title: "current-only" },
    ]);
  });

  it("preserves drafts and never reads or writes a sibling .codex directory", async () => {
    const paths = await createPaths();
    const sharedCodex = join(paths.root, ".codex");
    await writeJson(join(paths.legacyPath, "draft-state.json"), {
      version: 1,
      updatedAt: 123,
      threads: { "thread-1": { text: "unfinished draft" } },
    });
    await mkdir(sharedCodex, { recursive: true });
    await writeFile(join(sharedCodex, "sentinel"), "unchanged", "utf8");

    await migrateProductUserData(paths);

    expect(await readJson(join(paths.currentPath, "draft-state.json"))).toMatchObject({
      threads: { "thread-1": { text: "unfinished draft" } },
    });
    expect(await readFile(join(sharedCodex, "sentinel"), "utf8")).toBe("unchanged");
  });

  it("merges image and flowchart history while preserving current entries", async () => {
    const paths = await createPaths();
    for (const file of ["image-generation-history.json", "flowchart-history.json"]) {
      await writeJson(join(paths.legacyPath, file), {
        version: 1,
        items: [
          { id: "legacy", value: "legacy-only" },
          { id: "shared", value: "legacy" },
        ],
      });
      await writeJson(join(paths.currentPath, file), {
        version: 1,
        items: [{ id: "shared", value: "current" }],
      });
    }

    await migrateProductUserData(paths);

    for (const file of ["image-generation-history.json", "flowchart-history.json"]) {
      expect((await readJson(join(paths.currentPath, file))).items).toEqual([
        { id: "legacy", value: "legacy-only" },
        { id: "shared", value: "current" },
      ]);
    }
  });

  it("is idempotent and does not overwrite changes made after migration", async () => {
    const paths = await createPaths();
    await writeJson(join(paths.legacyPath, "user-settings.json"), { theme: "legacy" });
    await migrateProductUserData(paths);
    await writeJson(join(paths.currentPath, "user-settings.json"), { theme: "current-after-migration" });

    const second = await migrateProductUserData(paths);
    expect(second.status).toBe("already-complete");
    expect(await readJson(join(paths.currentPath, "user-settings.json"))).toEqual({
      theme: "current-after-migration",
    });
  });

  it("recovers from a partial prior copy when no marker exists", async () => {
    const paths = await createPaths();
    await writeJson(join(paths.legacyPath, "user-settings.json"), { oldOnly: true, conflict: "old" });
    await writeJson(join(paths.currentPath, "user-settings.json"), { conflict: "new" });

    const result = await migrateProductUserData(paths);
    expect(result.status).toBe("complete");
    expect(await readJson(join(paths.currentPath, "user-settings.json"))).toEqual({
      oldOnly: true,
      conflict: "new",
    });
  });

  it("retries a partial marker and completes credential re-encryption", async () => {
    const paths = await createPaths();
    const encrypted = Buffer.from("legacy-ciphertext").toString("base64");
    await writeJson(join(paths.legacyPath, "embedded-router", "provider-secrets.json"), {
      version: 1,
      secrets: { deepseek: { encrypted } },
    });
    const first = await migrateProductUserData({
      ...paths,
      migrateProviderSecrets: async () => {
        throw new Error("legacy identity unavailable");
      },
    });
    expect(first.status).toBe("partial");

    const migrateProviderSecrets = vi.fn(async (_legacyPath: string, currentPath: string) => {
      await writeJson(currentPath, {
        version: 1,
        secrets: { deepseek: { encrypted: Buffer.from("current-ciphertext").toString("base64") } },
      });
    });
    const second = await migrateProductUserData({ ...paths, migrateProviderSecrets });

    expect(second.status).toBe("complete");
    expect(migrateProviderSecrets).toHaveBeenCalledOnce();
    expect((await readJson(join(paths.currentPath, PRODUCT_USER_DATA_MIGRATION_MARKER))).status).toBe("complete");
  });

  it("quarantines malformed legacy credentials and records a partial migration", async () => {
    const paths = await createPaths();
    await writeJson(join(paths.legacyPath, "embedded-router", "provider-secrets.json"), {
      version: 1,
      secrets: { deepseek: { encrypted: "plaintext-not-base64" } },
    });

    const result = await migrateProductUserData(paths);
    expect(result.status).toBe("partial");
    await expect(stat(join(paths.currentPath, "embedded-router", "provider-secrets.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readJson(join(paths.currentPath, PRODUCT_USER_DATA_MIGRATION_MARKER))).toMatchObject({
      status: "partial",
      failures: [{ relativePath: "embedded-router/provider-secrets.json", code: "invalid-data" }],
    });
    expect(
      await readJson(join(paths.currentPath, "legacy-preserved", "embedded-router", "provider-secrets.json"))
    ).toMatchObject({ version: 1 });
  });

  it("records credential identity validation failure without logging or persisting plaintext", async () => {
    const paths = await createPaths();
    const encrypted = Buffer.from("synthetic-test-secret").toString("base64");
    await writeJson(join(paths.legacyPath, "embedded-router", "provider-secrets.json"), {
      version: 1,
      secrets: { deepseek: { encrypted } },
    });

    const result = await migrateProductUserData({
      ...paths,
      validateProviderSecrets: async () => {
        throw new Error("credential_decryption_failed: synthetic-test-secret");
      },
    });
    expect(result.status).toBe("partial");
    const markerText = await readFile(join(paths.currentPath, PRODUCT_USER_DATA_MIGRATION_MARKER), "utf8");
    expect(markerText).not.toContain("synthetic-test-secret");
    expect(JSON.parse(markerText).failures).toContainEqual({
      relativePath: "embedded-router/provider-secrets.json",
      code: "credential-validation-failed",
    });
  });

  it.skipIf(process.platform === "win32")("never follows symbolic links from the legacy profile", async () => {
    const paths = await createPaths();
    await mkdir(paths.legacyPath, { recursive: true });
    const outside = join(paths.root, "outside-secret.txt");
    await writeFile(outside, "must-not-copy", "utf8");
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, join(paths.legacyPath, "linked-secret.txt"));

    await migrateProductUserData(paths);
    await expect(stat(join(paths.currentPath, "legacy-preserved", "linked-secret.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails soft on an unwritable destination shape and leaves legacy data intact", async () => {
    const paths = await createPaths();
    await writeJson(join(paths.legacyPath, "user-settings.json"), { retained: true });
    await writeFile(paths.currentPath, "not-a-directory", "utf8");
    const warn = vi.fn();

    await expect(migrateProductUserDataFailSoft(paths, warn)).resolves.toEqual({ status: "failed", marker: null });
    expect(warn).toHaveBeenCalledOnce();
    expect(await readJson(join(paths.legacyPath, "user-settings.json"))).toEqual({ retained: true });
  });
});
