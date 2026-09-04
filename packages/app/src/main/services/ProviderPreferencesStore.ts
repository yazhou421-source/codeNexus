import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ProviderPreference = {
  enabled: boolean;
  modelIds: string[];
};

type ProviderPreferencesFile = {
  version: 1;
  providers: Record<string, ProviderPreference>;
};

export class ProviderPreferencesStore {
  private preferences = new Map<string, ProviderPreference>();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.preferences = parsePreferences(parsed);
    } catch (error: any) {
      this.preferences.clear();
      if (String(error?.code ?? "") !== "ENOENT") {
        this.loaded = true;
        throw new Error("Provider preferences are unavailable.");
      }
    }
    this.loaded = true;
  }

  get(providerId: string): ProviderPreference | null {
    this.assertLoaded();
    const value = this.preferences.get(providerId);
    return value ? { enabled: value.enabled, modelIds: [...value.modelIds] } : null;
  }

  async set(providerId: string, preference: ProviderPreference): Promise<void> {
    this.assertLoaded();
    const task = this.writeQueue.then(async () => {
      const next = new Map(this.preferences);
      next.set(providerId, { enabled: preference.enabled, modelIds: [...preference.modelIds] });
      await writePreferences(this.filePath, next);
      this.preferences = next;
    });
    this.writeQueue = task.catch(() => undefined);
    return await task;
  }

  private assertLoaded(): void {
    if (!this.loaded) throw new Error("Provider preferences are not ready.");
  }
}

function parsePreferences(value: unknown): Map<string, ProviderPreference> {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.providers)) {
    throw new Error("invalid provider preferences");
  }
  const result = new Map<string, ProviderPreference>();
  for (const [providerId, raw] of Object.entries(value.providers)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(providerId)) throw new Error("invalid provider preference ID");
    if (!isRecord(raw) || typeof raw.enabled !== "boolean" || !Array.isArray(raw.modelIds)) {
      throw new Error("invalid provider preference");
    }
    const modelIds = raw.modelIds.map((item) => String(item ?? "").trim()).filter(Boolean);
    result.set(providerId, { enabled: raw.enabled, modelIds: [...new Set(modelIds)] });
  }
  return result;
}

async function writePreferences(filePath: string, values: ReadonlyMap<string, ProviderPreference>): Promise<void> {
  const providers = Object.create(null) as ProviderPreferencesFile["providers"];
  for (const [providerId, value] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    providers[providerId] = { enabled: value.enabled, modelIds: [...value.modelIds] };
  }
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, providers }, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
