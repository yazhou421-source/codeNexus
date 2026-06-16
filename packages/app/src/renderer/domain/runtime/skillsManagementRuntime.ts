import type { useCodexSkillRootsStore } from "../../stores/codexSkillRoots.store";
import type { useSkillsStore } from "../../stores/skills.store";
import type { SkillState } from "../types";
import type { SkillsListSnapshot } from "./skillsRuntime";

type SkillsStore = ReturnType<typeof useSkillsStore>;
type CodexSkillRootsStore = ReturnType<typeof useCodexSkillRootsStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

type SkillsSnapshot = {
  items: SkillState[];
  parseErrors: string[];
  summary: string;
};

export type SkillsManagementRuntimeDeps = {
  appTimelineId: string;
  skillsStore: SkillsStore;
  codexSkillRootsStore: CodexSkillRootsStore;
  skillsRefreshDebounceMs: number;
  getWorkspacePath: () => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  requestSkillsList: (forceReload: boolean) => Promise<SkillsListSnapshot>;
  writeSkillConfig: (skillPath: string, enabled: boolean) => Promise<void>;
  saveSkillsSnapshot: (workspacePath: string, snapshot: SkillsSnapshot) => void;
  invalidateSkillsSnapshot: (workspacePath?: string) => void;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type SkillsManagementRuntime = {
  refreshSkills: (forceReload?: boolean) => Promise<void>;
  scheduleSkillsRefresh: (workspacePath: string) => void;
  toggleSkill: (skillPath: string, enabled: boolean) => Promise<void>;
  addSkillRoot: (root: string) => Promise<void>;
  removeSkillRoot: (root: string) => Promise<void>;
  dispose: () => void;
};

function normalizeWorkspacePath(value: unknown): string {
  return String(value ?? "").trim();
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

export function createSkillsManagementRuntime(deps: SkillsManagementRuntimeDeps): SkillsManagementRuntime {
  const {
    appTimelineId,
    skillsStore,
    codexSkillRootsStore,
    skillsRefreshDebounceMs,
    getWorkspacePath,
    getServerIdForWorkspace,
    requestSkillsList,
    writeSkillConfig,
    saveSkillsSnapshot,
    invalidateSkillsSnapshot,
    pushEvent,
    showToast,
  } = deps;

  const skillsRefreshTimersByWorkspace = new Map<string, ReturnType<typeof setTimeout>>();

  const refreshSkills = async (forceReload = false) => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!getServerIdForWorkspace(workspace)) {
      skillsStore.resetState("未连接服务");
      return;
    }
    if (!workspace) {
      skillsStore.resetState("未选择工作区");
      return;
    }
    const hasVisibleData = skillsStore.loadState === "ready" && skillsStore.items.length > 0;
    if (forceReload || !hasVisibleData) {
      skillsStore.setLoadState("loading");
    }
    try {
      const res = await requestSkillsList(forceReload);
      skillsStore.setItems(res.entries);
      skillsStore.setParseErrors(res.errors);
      skillsStore.setSummary(res.summary);
      skillsStore.setLoadState("ready");
      saveSkillsSnapshot(workspace, {
        items: res.entries,
        parseErrors: res.errors,
        summary: res.summary,
      });
      if (res.entries.length === 0) {
        pushEvent("skills:empty", res.summary, { threadId: appTimelineId });
      }
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      if (hasVisibleData) {
        skillsStore.setLoadState("ready");
      } else {
        skillsStore.setLoadState("error", msg);
      }
    }
  };

  const scheduleSkillsRefresh = (workspacePath: string) => {
    const workspace = normalizeWorkspacePath(workspacePath);
    if (!workspace) return;
    const existing = skillsRefreshTimersByWorkspace.get(workspace);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      skillsRefreshTimersByWorkspace.delete(workspace);
      if (normalizeWorkspacePath(getWorkspacePath()) !== workspace) return;
      if (!getServerIdForWorkspace(workspace)) return;
      void refreshSkills(true);
    }, skillsRefreshDebounceMs);
    skillsRefreshTimersByWorkspace.set(workspace, timer);
  };

  const toggleSkill = async (skillPath: string, enabled: boolean) => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!getServerIdForWorkspace(workspace)) return;
    try {
      await writeSkillConfig(skillPath, enabled);
      invalidateSkillsSnapshot(workspace);
      pushEvent("skills", `${enabled ? "enabled" : "disabled"}\n${skillPath}`, { threadId: appTimelineId });
      await refreshSkills(true);
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      pushEvent("skills:error", msg, { threadId: appTimelineId, level: "error" });
      showToast({ kind: "error", title: "技能配置失败", message: msg });
      throw error;
    }
  };

  const addSkillRoot = async (root: string) => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!workspace) throw new Error("未选择工作区。");
    const normalizedRoot = String(root ?? "").trim();
    if (!normalizedRoot) throw new Error("技能目录不能为空。");
    try {
      await codexSkillRootsStore.addRootForWorkspace(workspace, normalizedRoot);
      invalidateSkillsSnapshot(workspace);
      pushEvent("skills:roots", `added\n${normalizedRoot}`, { threadId: appTimelineId });
      await refreshSkills(true);
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      pushEvent("skills:roots:error", msg, { threadId: appTimelineId, level: "error" });
      showToast({ kind: "error", title: "技能目录添加失败", message: msg });
      throw error;
    }
  };

  const removeSkillRoot = async (root: string) => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!workspace) throw new Error("未选择工作区。");
    const normalizedRoot = String(root ?? "").trim();
    if (!normalizedRoot) return;
    try {
      await codexSkillRootsStore.removeRootForWorkspace(workspace, normalizedRoot);
      invalidateSkillsSnapshot(workspace);
      pushEvent("skills:roots", `removed\n${normalizedRoot}`, { threadId: appTimelineId });
      await refreshSkills(true);
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      pushEvent("skills:roots:error", msg, { threadId: appTimelineId, level: "error" });
      showToast({ kind: "error", title: "技能目录移除失败", message: msg });
      throw error;
    }
  };

  const dispose = () => {
    for (const timer of skillsRefreshTimersByWorkspace.values()) clearTimeout(timer);
    skillsRefreshTimersByWorkspace.clear();
  };

  return {
    refreshSkills,
    scheduleSkillsRefresh,
    toggleSkill,
    addSkillRoot,
    removeSkillRoot,
    dispose,
  };
}
