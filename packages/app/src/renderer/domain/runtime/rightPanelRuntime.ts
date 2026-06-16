import type { useConfigRequirementsStore } from "../../stores/configRequirements.store";
import type { useConfigStore } from "../../stores/config.store";
import type { useMcpResourceStore } from "../../stores/mcpResource.store";
import type { useMcpStore } from "../../stores/mcp.store";
import type { useSkillsStore } from "../../stores/skills.store";
import type { useUserInputStore } from "../../stores/userInput.store";
import type { McpServerState, SkillState } from "../types";

type ConfigStore = ReturnType<typeof useConfigStore>;
type ConfigRequirementsStore = ReturnType<typeof useConfigRequirementsStore>;
type SkillsStore = ReturnType<typeof useSkillsStore>;
type McpStore = ReturnType<typeof useMcpStore>;
type McpResourceStore = ReturnType<typeof useMcpResourceStore>;
type UserInputStore = ReturnType<typeof useUserInputStore>;

export type SkillsSnapshot = {
  items: SkillState[];
  parseErrors: string[];
  summary: string;
};

export type McpSnapshot = {
  servers: McpServerState[];
  statusText: string;
};

export type RightPanelRuntimeDeps = {
  configStore: ConfigStore;
  configRequirementsStore: ConfigRequirementsStore;
  skillsStore: SkillsStore;
  mcpStore: McpStore;
  mcpResourceStore: McpResourceStore;
  userInputStore: UserInputStore;
  skillsSnapshotByWorkspace: Map<string, SkillsSnapshot>;
  mcpSnapshotByWorkspace: Map<string, McpSnapshot>;
  normalizeWorkspacePath: (value: string) => string;
};

export type RightPanelRuntime = {
  saveSkillsSnapshot: (workspacePath: string, snapshot: SkillsSnapshot) => void;
  invalidateSkillsSnapshot: (workspacePath?: string) => void;
  hasSkillsSnapshot: (workspacePath: string) => boolean;
  saveMcpSnapshot: (workspacePath: string, snapshot: McpSnapshot) => void;
  invalidateMcpSnapshot: (workspacePath?: string) => void;
  hasMcpSnapshot: (workspacePath: string) => boolean;
  applyCachedRightPanels: (workspacePath: string) => void;
  resetSidePanelStores: (statusText?: string) => void;
};

function cloneSkillItems(items: SkillState[]): SkillState[] {
  return items.map((item) => ({ ...item }));
}

function cloneMcpServers(servers: McpServerState[]): McpServerState[] {
  return servers.map((server) => ({
    ...server,
    ...(Array.isArray(server.args) ? { args: [...server.args] } : {}),
    ...(server.env ? { env: { ...server.env } } : {}),
    ...(server.headers ? { headers: { ...server.headers } } : {}),
    tools: Array.isArray(server.tools) ? server.tools.map((tool) => ({ ...tool })) : [],
    resources: Array.isArray(server.resources) ? [...server.resources] : [],
    resourceTemplates: Array.isArray(server.resourceTemplates) ? [...server.resourceTemplates] : [],
  }));
}

export function createRightPanelRuntime(deps: RightPanelRuntimeDeps): RightPanelRuntime {
  const {
    configStore,
    configRequirementsStore,
    skillsStore,
    mcpStore,
    mcpResourceStore,
    userInputStore,
    skillsSnapshotByWorkspace,
    mcpSnapshotByWorkspace,
    normalizeWorkspacePath,
  } = deps;

  const applySkillsSnapshot = (workspacePathValue: string): boolean => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return false;
    const snapshot = skillsSnapshotByWorkspace.get(workspace);
    if (!snapshot) return false;
    skillsStore.setItems(cloneSkillItems(snapshot.items));
    skillsStore.setParseErrors([...snapshot.parseErrors]);
    skillsStore.setSummary(snapshot.summary);
    skillsStore.setLoadState("ready");
    return true;
  };

  const saveSkillsSnapshot = (workspacePathValue: string, snapshot: SkillsSnapshot) => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return;
    skillsSnapshotByWorkspace.set(workspace, {
      items: cloneSkillItems(snapshot.items),
      parseErrors: [...snapshot.parseErrors],
      summary: snapshot.summary,
    });
  };

  const invalidateSkillsSnapshot = (workspacePathValue?: string) => {
    const workspace = normalizeWorkspacePath(workspacePathValue ?? "");
    if (!workspace) return;
    skillsSnapshotByWorkspace.delete(workspace);
  };

  const hasSkillsSnapshot = (workspacePathValue: string): boolean => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return false;
    return skillsSnapshotByWorkspace.has(workspace);
  };

  const applyMcpSnapshot = (workspacePathValue: string): boolean => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return false;
    const snapshot = mcpSnapshotByWorkspace.get(workspace);
    if (!snapshot) return false;
    mcpStore.setServers(cloneMcpServers(snapshot.servers));
    mcpStore.setStatusText(snapshot.statusText);
    mcpStore.setLoadState("ready");
    return true;
  };

  const saveMcpSnapshot = (workspacePathValue: string, snapshot: McpSnapshot) => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return;
    mcpSnapshotByWorkspace.set(workspace, {
      servers: cloneMcpServers(snapshot.servers),
      statusText: snapshot.statusText,
    });
  };

  const invalidateMcpSnapshot = (workspacePathValue?: string) => {
    const workspace = normalizeWorkspacePath(workspacePathValue ?? "");
    if (!workspace) return;
    mcpSnapshotByWorkspace.delete(workspace);
  };

  const hasMcpSnapshot = (workspacePathValue: string): boolean => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return false;
    return mcpSnapshotByWorkspace.has(workspace);
  };

  const applyCachedRightPanels = (workspacePathValue: string) => {
    const workspace = normalizeWorkspacePath(workspacePathValue);
    if (!workspace) return;
    applySkillsSnapshot(workspace);
    applyMcpSnapshot(workspace);
  };

  const resetSidePanelStores = (statusText = "未连接服务") => {
    configStore.resetState(statusText);
    configRequirementsStore.resetState(statusText);
    skillsStore.resetState(statusText);
    mcpStore.resetState(statusText);
    mcpResourceStore.resetState();
    userInputStore.resetAll();
  };

  return {
    saveSkillsSnapshot,
    invalidateSkillsSnapshot,
    hasSkillsSnapshot,
    saveMcpSnapshot,
    invalidateMcpSnapshot,
    hasMcpSnapshot,
    applyCachedRightPanels,
    resetSidePanelStores,
  };
}
