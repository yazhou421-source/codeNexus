import { codexDesktop } from "../../api/codexDesktopClient";
import type { useCodexConfigSwitcherStore } from "../../stores/codexConfigSwitcher.store";
import type { useSkillsStore } from "../../stores/skills.store";
import type { ConfigWriteChange } from "../serverInterop";
import type { SkillState } from "../types";
import {
  getActiveCodexConfigSwitcherProfile,
  normalizeCodexConfigSwitcherMcpServers,
  normalizeCodexConfigSwitcherState,
  type CodexConfigSwitcherProfile,
  type CodexConfigSwitcherSkillEntry,
  type CodexConfigSwitcherState,
} from "@codenexus/shared/codexConfigSwitcher";

type CodexConfigSwitcherStore = ReturnType<typeof useCodexConfigSwitcherStore>;
type SkillsStore = ReturnType<typeof useSkillsStore>;
type ToastKind = "info" | "success" | "warn" | "error";

type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;
type ConfigReadResult = { config?: unknown };

export type CodexConfigSwitcherRuntimeDeps = {
  codexConfigSwitcherStore: CodexConfigSwitcherStore;
  skillsStore: SkillsStore;
  requestConfigRead: () => Promise<ConfigReadResult>;
  requestConfigBatchWrite: (changes: ConfigWriteChange[], filePath?: string | null) => Promise<void>;
  requestReloadMcpConfig: () => Promise<void>;
  writeSkillConfig: (skillPath: string, enabled: boolean) => Promise<void>;
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  refreshMcp: () => Promise<void>;
  invalidateMcpSnapshot: (workspacePath?: string) => void;
  getWorkspacePath: () => string;
  showToast: ShowToast;
};

export type CodexConfigSwitcherRuntime = {
  refreshCodexConfigSwitcher: () => Promise<void>;
  importCurrentCodexConfigProfile: () => Promise<void>;
  activateCodexConfigProfile: (profileId: string) => Promise<void>;
  getRequiredActiveSwitcherProfile: () => CodexConfigSwitcherProfile;
  writeCodexConfigSwitcherState: (state: CodexConfigSwitcherState) => Promise<void>;
  syncSwitcherProfileToCodex: (profile: CodexConfigSwitcherProfile) => Promise<void>;
  upsertActiveSwitcherMcpServers: (servers: Record<string, Record<string, unknown>>) => Promise<void>;
};

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

function skillToSwitcherEntry(skill: SkillState): CodexConfigSwitcherSkillEntry | null {
  const path = String(skill.path ?? "").trim();
  if (!path) return null;
  return {
    id: path,
    name: String(skill.displayName || skill.name || path).trim() || path,
    path,
    enabled: Boolean(skill.enabled),
  };
}

export function createCodexConfigSwitcherRuntime(deps: CodexConfigSwitcherRuntimeDeps): CodexConfigSwitcherRuntime {
  const {
    codexConfigSwitcherStore,
    skillsStore,
    requestConfigRead,
    requestConfigBatchWrite,
    requestReloadMcpConfig,
    writeSkillConfig,
    refreshSkills,
    refreshMcp,
    invalidateMcpSnapshot,
    getWorkspacePath,
    showToast,
  } = deps;

  const readEffectiveMcpServersFromCodexConfig = async () => {
    const configResult = await requestConfigRead();
    return normalizeCodexConfigSwitcherMcpServers((configResult.config as Record<string, unknown> | null)?.mcp_servers);
  };

  const refreshCodexConfigSwitcher = async () => {
    await codexConfigSwitcherStore.refresh();
  };

  const assertNoCcswitchManagedCodexConfig = () => {
    if (!codexConfigSwitcherStore.ccswitch.detected) return;
    const reason = codexConfigSwitcherStore.ccswitch.reasons.join(", ") || "detected";
    throw new Error(`检测到 ccswitch（${reason}），已禁用 CodeNexus 全局配置切换器写入，避免覆盖 ~/.codex/config.toml。`);
  };

  const writeCodexConfigSwitcherState = async (state: CodexConfigSwitcherState) => {
    assertNoCcswitchManagedCodexConfig();
    await codexConfigSwitcherStore.saveState(normalizeCodexConfigSwitcherState(state));
  };

  const collectCurrentSwitcherSkills = async () => {
    if (skillsStore.loadState !== "ready") await refreshSkills(true);
    const skills = skillsStore.items
      .map(skillToSwitcherEntry)
      .filter((item): item is CodexConfigSwitcherSkillEntry => Boolean(item));
    return {
      skills,
      enabledSkillIds: skills.filter((skill) => skill.enabled).map((skill) => skill.id),
    };
  };

  const syncSwitcherSkillsToCodex = async (profile: CodexConfigSwitcherProfile) => {
    const enabledIds = new Set(profile.skillIds);
    for (const skill of codexConfigSwitcherStore.state.skills) {
      const path = String(skill.path ?? "").trim();
      if (!path) continue;
      await writeSkillConfig(path, enabledIds.has(skill.id));
    }
  };

  const syncSwitcherProfileToCodex = async (profile: CodexConfigSwitcherProfile) => {
    assertNoCcswitchManagedCodexConfig();
    const activation = await codexDesktop.app.activateCodexConfigSwitcherProfile({ profileId: profile.id });
    codexConfigSwitcherStore.applySnapshot(activation);
    try {
      await requestConfigBatchWrite([{ keyPath: "mcp_servers", value: profile.mcpServers }]);
      await syncSwitcherSkillsToCodex(profile);
      await requestReloadMcpConfig();
      invalidateMcpSnapshot(getWorkspacePath());
      await refreshMcp();
      showToast({ kind: "success", title: "Codex 配置已切换", message: profile.name });
    } catch (error: unknown) {
      await codexDesktop.app
        .restoreCodexConfigSwitcherBackup({ backupId: activation.backup.id })
        .catch(() => undefined);
      throw error;
    }
  };

  const getRequiredActiveSwitcherProfile = (): CodexConfigSwitcherProfile => {
    const profile = getActiveCodexConfigSwitcherProfile(codexConfigSwitcherStore.state);
    if (!profile) throw new Error("请先导入当前 Codex 配置，创建受管配置集。");
    return profile;
  };

  const importCurrentCodexConfigProfile = async () => {
    try {
      assertNoCcswitchManagedCodexConfig();
      const mcpServers = await readEffectiveMcpServersFromCodexConfig();
      const skills = await collectCurrentSwitcherSkills();
      const snapshot = await codexDesktop.app.importCurrentCodexConfigSwitcher({
        name: "Imported Codex",
        mcpServers,
        skills: skills.skills,
        enabledSkillIds: skills.enabledSkillIds,
      });
      codexConfigSwitcherStore.applySnapshot(snapshot);
      const profile = getRequiredActiveSwitcherProfile();
      await syncSwitcherProfileToCodex(profile);
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      showToast({ kind: "error", title: "Codex 配置导入失败", message: msg });
      throw error;
    }
  };

  const activateCodexConfigProfile = async (profileId: string) => {
    assertNoCcswitchManagedCodexConfig();
    const profile =
      codexConfigSwitcherStore.state.profiles.find((item) => item.id === String(profileId ?? "").trim()) ?? null;
    if (!profile) throw new Error("配置集不存在。");
    try {
      await syncSwitcherProfileToCodex(profile);
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      showToast({ kind: "error", title: "Codex 配置切换失败", message: msg });
      throw error;
    }
  };

  const upsertActiveSwitcherMcpServers = async (servers: Record<string, Record<string, unknown>>) => {
    if (codexConfigSwitcherStore.loadState === "idle") await refreshCodexConfigSwitcher();
    assertNoCcswitchManagedCodexConfig();
    let profile = getActiveCodexConfigSwitcherProfile(codexConfigSwitcherStore.state);
    if (!profile) {
      const current = await readEffectiveMcpServersFromCodexConfig();
      const snapshot = await codexDesktop.app.importCurrentCodexConfigSwitcher({
        name: "Imported Codex",
        mcpServers: current,
      });
      codexConfigSwitcherStore.applySnapshot(snapshot);
      profile = getRequiredActiveSwitcherProfile();
    }
    const now = Date.now();
    const nextProfile: CodexConfigSwitcherProfile = {
      ...profile,
      mcpServers: {
        ...profile.mcpServers,
        ...servers,
      },
      updatedAt: now,
    };
    const nextState: CodexConfigSwitcherState = {
      ...codexConfigSwitcherStore.state,
      activeProfileId: nextProfile.id,
      profiles: codexConfigSwitcherStore.state.profiles.map((item) =>
        item.id === nextProfile.id ? nextProfile : item
      ),
    };
    await writeCodexConfigSwitcherState(nextState);
    await syncSwitcherProfileToCodex(nextProfile);
  };

  return {
    refreshCodexConfigSwitcher,
    importCurrentCodexConfigProfile,
    activateCodexConfigProfile,
    getRequiredActiveSwitcherProfile,
    writeCodexConfigSwitcherState,
    syncSwitcherProfileToCodex,
    upsertActiveSwitcherMcpServers,
  };
}
