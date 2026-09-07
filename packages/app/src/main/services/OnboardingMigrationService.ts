import { stat } from "node:fs/promises";
import { join } from "node:path";

const LEGACY_USER_DATA_PATHS = [
  "user-settings.json",
  "thread-history-cache.json",
  "draft-state.json",
  "message-outbox.json",
  "codex-profiles.json",
  "codex-skill-roots.json",
  "codex-config-switcher.json",
  "thread-tasks.json",
  "thread-artifacts.json",
  "thread-title-overrides.json",
  join("embedded-router", "provider-secrets.json"),
  join("embedded-router", "provider-preferences.json"),
] as const;

export async function detectLegacyUserData(userDataPath: string): Promise<boolean> {
  for (const relativePath of LEGACY_USER_DATA_PATHS) {
    try {
      const info = await stat(join(userDataPath, relativePath));
      if (info.isFile()) return true;
    } catch {}
  }
  return false;
}
