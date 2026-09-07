import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_USER_LOCAL_SETTINGS,
  mergeUserLocalSettings,
  migrateUserLocalSettingsForOnboarding,
  normalizeUserLocalSettings,
  type UserLocalSettings,
  type UserLocalSettingsPatch,
} from "../../common/localSettings";
import { SecureStorageService } from "./SecureStorageService";
import { logger } from "../utils/logger";

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class LocalSettingsService {
  private writeQueue: Promise<UserLocalSettings> = Promise.resolve(
    normalizeUserLocalSettings(DEFAULT_USER_LOCAL_SETTINGS)
  );
  private readonly secureStorage = new SecureStorageService();

  constructor(
    private readonly filePath: string,
    private readonly options: { legacyUserDataExists?: boolean; now?: () => string } = {}
  ) {}

  get path(): string {
    return this.filePath;
  }

  private decryptApiKeys(settings: UserLocalSettings): UserLocalSettings {
    return {
      ...settings,
      imageGeneration: {
        ...settings.imageGeneration,
        apiKey: this.secureStorage.decrypt(settings.imageGeneration.apiKey),
      },
      flowchartAi: {
        ...settings.flowchartAi,
        apiKey: this.secureStorage.decrypt(settings.flowchartAi.apiKey),
      },
      customProviders: {
        ...settings.customProviders,
        providers: settings.customProviders.providers.map((provider) => ({
          ...provider,
          apiKey: this.secureStorage.decrypt(provider.apiKey),
        })),
      },
    };
  }

  private encryptApiKeys(settings: UserLocalSettings): UserLocalSettings {
    return {
      ...settings,
      imageGeneration: {
        ...settings.imageGeneration,
        apiKey: this.secureStorage.encrypt(settings.imageGeneration.apiKey),
      },
      flowchartAi: {
        ...settings.flowchartAi,
        apiKey: this.secureStorage.encrypt(settings.flowchartAi.apiKey),
      },
      customProviders: {
        ...settings.customProviders,
        providers: settings.customProviders.providers.map((provider) => ({
          ...provider,
          apiKey: this.secureStorage.encrypt(provider.apiKey),
        })),
      },
    };
  }

  private async readFromDisk(): Promise<{ exists: boolean; settings: UserLocalSettings }> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = tryParseJson(raw);
      const migration = migrateUserLocalSettingsForOnboarding(parsed, {
        settingsFileExists: true,
        legacyUserDataExists: true,
        now: this.options.now?.(),
      });
      const settings = migration.settings;
      const decrypted = this.decryptApiKeys(settings);
      if (this.secureStorage.needsMigration) {
        this.migrateEncryption(decrypted);
      } else if (migration.migrated) {
        await writeSettingsFile(this.filePath, this.encryptApiKeys(decrypted));
      }
      return { exists: true, settings: decrypted };
    } catch (error) {
      if (isMissingFileError(error) && this.options.legacyUserDataExists) {
        const migration = migrateUserLocalSettingsForOnboarding(null, {
          settingsFileExists: false,
          legacyUserDataExists: true,
          now: this.options.now?.(),
        });
        await writeSettingsFile(this.filePath, this.encryptApiKeys(migration.settings));
        return { exists: true, settings: migration.settings };
      }
      logger.info("settings", `settings file not available, using defaults (${this.filePath})`);
      return { exists: false, settings: normalizeUserLocalSettings(DEFAULT_USER_LOCAL_SETTINGS) };
    }
  }

  private migrateEncryption(settings: UserLocalSettings): void {
    logger.info("settings", "auto-migrating plaintext API keys to encrypted storage");
    const toWrite = this.encryptApiKeys(settings);
    writeSettingsFile(this.filePath, toWrite).catch((error) =>
      logger.warn("settings", "failed to migrate API key encryption", error)
    );
  }

  async read(): Promise<{ exists: boolean; settings: UserLocalSettings }> {
    await this.writeQueue.catch(() => undefined);
    return this.readFromDisk();
  }

  async patch(patch: UserLocalSettingsPatch | null | undefined): Promise<UserLocalSettings> {
    const task = this.writeQueue
      .catch(() => normalizeUserLocalSettings(DEFAULT_USER_LOCAL_SETTINGS))
      .then(async () => {
        const current = await this.readFromDisk();
        const next = mergeUserLocalSettings(current.settings, patch ?? {});
        const toWrite = this.encryptApiKeys(next);
        await writeSettingsFile(this.filePath, toWrite);
        return next;
      });
    this.writeQueue = task;
    return task;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function writeSettingsFile(filePath: string, settings: UserLocalSettings): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
