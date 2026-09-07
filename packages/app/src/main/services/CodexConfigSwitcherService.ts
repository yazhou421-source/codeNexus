import { assertNotSharedCodexConfig } from "../codexConfigProtection";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createDefaultCodexConfigSwitcherState,
  normalizeCodexConfigSwitcherMcpServers,
  normalizeCodexConfigSwitcherState,
  type CodexConfigSwitcherActivateResult,
  type CodexConfigSwitcherBackup,
  type CodexConfigSwitcherCcswitchStatus,
  type CodexConfigSwitcherImportArgs,
  type CodexConfigSwitcherMutationResult,
  type CodexConfigSwitcherSnapshot,
  type CodexConfigSwitcherState,
} from "@codenexus/shared/codexConfigSwitcher";

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function timestampId(now = new Date()): string {
  const pad = (value: number, len = 2) => String(value).padStart(len, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
}

export class CodexConfigSwitcherService {
  private writeQueue: Promise<CodexConfigSwitcherState> = Promise.resolve(
    normalizeCodexConfigSwitcherState(createDefaultCodexConfigSwitcherState())
  );

  constructor(
    private readonly filePath: string,
    private readonly codexConfigPathValue: string,
    private readonly backupDirValue: string,
    private readonly ccswitchDataDirValue: string,
    private readonly ccswitchDatabasePathValue: string
  ) {}

  get path(): string {
    return this.filePath;
  }

  get codexConfigPath(): string {
    return this.codexConfigPathValue;
  }

  get backupDir(): string {
    return this.backupDirValue;
  }

  private async detectCcswitch(): Promise<CodexConfigSwitcherCcswitchStatus> {
    const reasons: string[] = [];
    try {
      const info = await stat(this.ccswitchDataDirValue);
      if (info.isDirectory()) reasons.push("dataDir");
    } catch {}
    try {
      const info = await stat(this.ccswitchDatabasePathValue);
      if (info.isFile()) reasons.push("database");
    } catch {}
    return {
      detected: reasons.length > 0,
      dataDir: this.ccswitchDataDirValue,
      databasePath: this.ccswitchDatabasePathValue,
      reasons,
    };
  }

  private async toSnapshot(exists: boolean, state: CodexConfigSwitcherState): Promise<CodexConfigSwitcherSnapshot> {
    return {
      path: this.filePath,
      exists,
      codexConfigPath: this.codexConfigPathValue,
      backupDir: this.backupDirValue,
      ccswitch: await this.detectCcswitch(),
      state,
    };
  }

  private async toMutationResult(state: CodexConfigSwitcherState): Promise<CodexConfigSwitcherMutationResult> {
    return {
      path: this.filePath,
      exists: true,
      codexConfigPath: this.codexConfigPathValue,
      backupDir: this.backupDirValue,
      ccswitch: await this.detectCcswitch(),
      state,
    };
  }

  private async readStateFromDisk(): Promise<{ exists: boolean; state: CodexConfigSwitcherState }> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return { exists: true, state: normalizeCodexConfigSwitcherState(tryParseJson(raw)) };
    } catch {
      return { exists: false, state: createDefaultCodexConfigSwitcherState() };
    }
  }

  async read(): Promise<CodexConfigSwitcherSnapshot> {
    await this.writeQueue.catch(() => undefined);
    const { exists, state } = await this.readStateFromDisk();
    return await this.toSnapshot(exists, state);
  }

  private async writeState(next: CodexConfigSwitcherState): Promise<CodexConfigSwitcherState> {
    const normalized = normalizeCodexConfigSwitcherState(next);
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
    return normalized;
  }

  async save(next: unknown): Promise<CodexConfigSwitcherMutationResult> {
    const task = this.writeQueue
      .catch(() => createDefaultCodexConfigSwitcherState())
      .then(async () => this.writeState(normalizeCodexConfigSwitcherState(next)));
    this.writeQueue = task;
    return await this.toMutationResult(await task);
  }

  async importCurrentConfig(args: CodexConfigSwitcherImportArgs): Promise<CodexConfigSwitcherMutationResult> {
    const importedMcpServers = normalizeCodexConfigSwitcherMcpServers(args?.mcpServers ?? {});
    const importedSkills = Array.isArray(args?.skills)
      ? normalizeCodexConfigSwitcherState({
          version: 1,
          activeProfileId: null,
          profiles: [],
          skills: args.skills,
          backups: [],
        }).skills
      : [];
    const enabledSkillIds = Array.isArray(args?.enabledSkillIds)
      ? args.enabledSkillIds.map((item) => normalizeText(item)).filter(Boolean)
      : [];
    const now = Date.now();
    const task = this.writeQueue
      .catch(() => createDefaultCodexConfigSwitcherState())
      .then(async () => {
        const current = await this.readStateFromDisk();
        const state = normalizeCodexConfigSwitcherState(current.state);
        const id = "imported-codex";
        const name = normalizeText(args?.name) || "Imported Codex";
        const existingIndex = state.profiles.findIndex((profile) => profile.id === id);
        const profile = {
          id,
          name,
          mcpServers: importedMcpServers,
          skillIds:
            enabledSkillIds.length > 0
              ? enabledSkillIds
              : existingIndex >= 0
                ? (state.profiles[existingIndex]?.skillIds ?? [])
                : [],
          createdAt: existingIndex >= 0 ? (state.profiles[existingIndex]?.createdAt ?? now) : now,
          updatedAt: now,
          ...(existingIndex >= 0 && state.profiles[existingIndex]?.lastActivatedAt
            ? { lastActivatedAt: state.profiles[existingIndex]!.lastActivatedAt }
            : {}),
        };
        const profiles = [...state.profiles];
        if (existingIndex >= 0) profiles[existingIndex] = profile;
        else profiles.push(profile);
        return this.writeState({
          ...state,
          activeProfileId: id,
          profiles,
          skills: importedSkills.length > 0 ? importedSkills : state.skills,
        });
      });
    this.writeQueue = task;
    return await this.toMutationResult(await task);
  }

  private async backupCodexConfig(profileId?: string): Promise<CodexConfigSwitcherBackup> {
    const now = Date.now();
    const id = timestampId(new Date(now));
    const backupPath = join(this.backupDirValue, `${id}.config.toml`);
    let existed = false;
    try {
      const info = await stat(this.codexConfigPathValue);
      existed = info.isFile();
    } catch {}
    await mkdir(this.backupDirValue, { recursive: true });
    if (existed) {
      await copyFile(this.codexConfigPathValue, backupPath);
    }
    return {
      id,
      path: backupPath,
      sourcePath: this.codexConfigPathValue,
      existed,
      createdAt: now,
      ...(profileId ? { profileId } : {}),
    };
  }

  async activateProfile(profileIdValue: string): Promise<CodexConfigSwitcherActivateResult> {
    const profileId = normalizeText(profileIdValue);
    if (!profileId) throw new Error("profileId is required");
    const backup = await this.backupCodexConfig(profileId);
    const task = this.writeQueue
      .catch(() => createDefaultCodexConfigSwitcherState())
      .then(async () => {
        const current = await this.readStateFromDisk();
        const state = normalizeCodexConfigSwitcherState(current.state);
        const now = Date.now();
        let found = false;
        const profiles = state.profiles.map((profile) => {
          if (profile.id !== profileId) return profile;
          found = true;
          return { ...profile, lastActivatedAt: now, updatedAt: now };
        });
        if (!found) throw new Error(`profile not found: ${profileId}`);
        return this.writeState({
          ...state,
          activeProfileId: profileId,
          profiles,
          backups: [backup, ...state.backups].slice(0, 30),
        });
      });
    this.writeQueue = task;
    return { ...(await this.toMutationResult(await task)), backup };
  }

  async restoreBackup(backupIdValue: string): Promise<CodexConfigSwitcherMutationResult> {
    await assertNotSharedCodexConfig(this.codexConfigPathValue);
    const backupId = normalizeText(backupIdValue);
    if (!backupId) throw new Error("backupId is required");
    const current = await this.readStateFromDisk();
    const state = normalizeCodexConfigSwitcherState(current.state);
    const backup = state.backups.find((item) => item.id === backupId);
    if (!backup) throw new Error(`backup not found: ${backupId}`);
    await mkdir(dirname(this.codexConfigPathValue), { recursive: true });
    if (backup.existed) {
      await copyFile(backup.path, this.codexConfigPathValue);
    } else {
      await rm(this.codexConfigPathValue, { force: true });
    }
    return await this.toMutationResult(state);
  }
}
