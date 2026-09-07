import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectLegacyUserData } from "./OnboardingMigrationService";

describe("detectLegacyUserData", () => {
  it("does not treat Electron cache folders as an existing CodeNexus profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "codenexus-onboarding-fresh-"));
    await mkdir(join(root, "Cache"));
    expect(await detectLegacyUserData(root)).toBe(false);
  });

  it.each(["thread-history-cache.json", "user-settings.json", join("embedded-router", "provider-secrets.json")])(
    "recognizes %s as upgrade evidence",
    async (relativePath) => {
      const root = await mkdtemp(join(tmpdir(), "codenexus-onboarding-upgrade-"));
      await mkdir(join(root, "embedded-router"), { recursive: true });
      await writeFile(join(root, relativePath), "{}", "utf8");
      expect(await detectLegacyUserData(root)).toBe(true);
    }
  );
});
