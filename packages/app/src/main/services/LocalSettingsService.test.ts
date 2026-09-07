import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { LocalSettingsService } from "./LocalSettingsService";

describe("LocalSettingsService onboarding migration", () => {
  beforeAll(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("keeps a genuinely fresh install in onboarding", async () => {
    const root = await mkdtemp(join(tmpdir(), "codenexus-settings-fresh-"));
    const service = new LocalSettingsService(join(root, "user-settings.json"));
    const result = await service.read();
    expect(result.exists).toBe(false);
    expect(result.settings.ui.runtimeMode).toBe("codex");
    expect(result.settings.onboarding).toMatchObject({ step: "welcome", completedAt: null });
  });

  it("migrates an old custom-mode profile atomically and idempotently", async () => {
    const root = await mkdtemp(join(tmpdir(), "codenexus-settings-upgrade-"));
    const filePath = join(root, "user-settings.json");
    await writeFile(filePath, JSON.stringify({ ui: { runtimeMode: "custom" } }), "utf8");
    const service = new LocalSettingsService(filePath, {
      legacyUserDataExists: true,
      now: () => "2026-09-04T00:00:00.000Z",
    });

    const first = await service.read();
    const second = await service.read();
    expect(first.settings.ui.runtimeMode).toBe("custom");
    expect(first.settings.onboarding.completedAt).toBe("2026-09-04T00:00:00.000Z");
    expect(second.settings.onboarding.completedAt).toBe(first.settings.onboarding.completedAt);
    expect((await readdir(root)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(await readFile(filePath, "utf8")).onboarding.version).toBe(1);
  });

  it("recognizes legacy user data even when the old settings file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "codenexus-settings-legacy-"));
    const filePath = join(root, "user-settings.json");
    const service = new LocalSettingsService(filePath, {
      legacyUserDataExists: true,
      now: () => "2026-09-04T01:00:00.000Z",
    });
    const result = await service.read();
    expect(result.exists).toBe(true);
    expect(result.settings.onboarding.completedAt).toBe("2026-09-04T01:00:00.000Z");
    expect(result.settings.ui.runtimeMode).toBe("codex");
  });

  it("persists interrupted progress and marks completion only at the final action", async () => {
    const root = await mkdtemp(join(tmpdir(), "codenexus-settings-progress-"));
    const service = new LocalSettingsService(join(root, "user-settings.json"));
    const interrupted = await service.patch({
      onboarding: { step: "account", selectedService: "deepseek" },
    });
    expect(interrupted.onboarding).toMatchObject({
      step: "account",
      selectedService: "deepseek",
      completedAt: null,
    });
    const completed = await service.patch({
      onboarding: { step: "complete", completedAt: "2026-09-04T02:00:00.000Z" },
    });
    expect(completed.onboarding.completedAt).toBe("2026-09-04T02:00:00.000Z");
  });
});
