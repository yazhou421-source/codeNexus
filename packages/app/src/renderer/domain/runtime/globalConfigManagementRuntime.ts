import type { useConfigRequirementsStore } from "../../stores/configRequirements.store";
import type { useConfigStore } from "../../stores/config.store";
import {
  buildConfigBatchChangesFromDraft,
  createDefaultGlobalConfigDraft,
  extractConfigRequirementsFromReadResult,
  extractGlobalConfigFromReadResult,
  type ConfigWriteChange,
} from "../serverInterop";
import type { ConfigReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@codenexus/generated/codex-app-server/v2/ConfigRequirementsReadResponse";

type ConfigStore = ReturnType<typeof useConfigStore>;
type ConfigRequirementsStore = ReturnType<typeof useConfigRequirementsStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

type JsonRpcErrorLike = {
  code: number;
  message: string;
};

export type SaveGlobalConfigOptions = {
  source?: "manual" | "auto";
  silentSuccessToast?: boolean;
};

export type GlobalConfigManagementRuntimeDeps = {
  appTimelineId: string;
  configStore: ConfigStore;
  configRequirementsStore: ConfigRequirementsStore;
  getWorkspacePath: () => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  requestConfigRead: () => Promise<ConfigReadResponse>;
  requestConfigRequirementsRead: () => Promise<ConfigRequirementsReadResponse>;
  requestConfigBatchWrite: (changes: ConfigWriteChange[], filePath?: string | null) => Promise<void>;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type GlobalConfigManagementRuntime = {
  refreshGlobalConfig: () => Promise<void>;
  ensureGlobalConfigLoadedOnce: () => Promise<void>;
  saveGlobalConfig: (options?: SaveGlobalConfigOptions) => Promise<void>;
  resetGlobalConfig: () => void;
};

function normalizeWorkspacePath(value: unknown): string {
  return String(value ?? "").trim();
}

function readErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (message) return String(message);
  }
  return String(error);
}

function parseJsonRpcError(error: unknown): JsonRpcErrorLike | null {
  const raw = readErrorMessage(error).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const code = typeof parsed.code === "number" ? parsed.code : null;
    const message = typeof parsed.message === "string" ? parsed.message : "";
    if (code == null) return null;
    return { code, message };
  } catch {
    return null;
  }
}

export function createGlobalConfigManagementRuntime(
  deps: GlobalConfigManagementRuntimeDeps
): GlobalConfigManagementRuntime {
  const {
    appTimelineId,
    configStore,
    configRequirementsStore,
    getWorkspacePath,
    getServerIdForWorkspace,
    requestConfigRead,
    requestConfigRequirementsRead,
    requestConfigBatchWrite,
    pushEvent,
    showToast,
  } = deps;

  let globalConfigAutoLoadAttempted = false;

  const refreshGlobalConfig = async () => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!getServerIdForWorkspace(workspace)) {
      configStore.resetState("未连接服务");
      configRequirementsStore.resetState("未连接服务");
      return;
    }
    configStore.setLoadState("loading", "读取配置中…");
    configRequirementsStore.setLoadState("loading", "读取 requirements 中…");

    const [configResult, requirementsResult] = await Promise.allSettled([
      requestConfigRead(),
      requestConfigRequirementsRead(),
    ]);

    if (configResult.status === "fulfilled") {
      const draft = extractGlobalConfigFromReadResult(configResult.value);
      configStore.applySnapshot(draft);
      configStore.setLoadState("ready", "已同步生效配置（config/read）");
    } else {
      const msg = readErrorMessage(configResult.reason);
      configStore.setLoadState("error", `读取失败：${msg}`);
    }

    if (requirementsResult.status === "fulfilled") {
      const requirements = extractConfigRequirementsFromReadResult(requirementsResult.value);
      configRequirementsStore.setRequirements(requirements);
      configRequirementsStore.setLoadState(
        "ready",
        requirements ? "已同步服务端限制（configRequirements/read）" : "当前服务端未配置 requirements"
      );
      return;
    }

    const rpcErr = parseJsonRpcError(requirementsResult.reason);
    const requirementsMsg = readErrorMessage(requirementsResult.reason);
    configRequirementsStore.setRequirements(null);
    if (rpcErr?.code === -32601) {
      configRequirementsStore.setLoadState("ready", "当前服务端未提供 configRequirements/read，已按无约束处理");
      return;
    }
    configRequirementsStore.setLoadState(
      "error",
      `读取 requirements 失败：${requirementsMsg}；已按无约束处理`
    );
  };

  const ensureGlobalConfigLoadedOnce = async () => {
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (globalConfigAutoLoadAttempted) return;
    if (!getServerIdForWorkspace(workspace)) return;
    globalConfigAutoLoadAttempted = true;
    await refreshGlobalConfig();
  };

  const saveGlobalConfig = async (options?: SaveGlobalConfigOptions) => {
    const source = options?.source ?? "manual";
    const silentSuccessToast =
      typeof options?.silentSuccessToast === "boolean" ? options.silentSuccessToast : source === "auto";
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!getServerIdForWorkspace(workspace) || configStore.saving) return;
    const baseline = configStore.snapshot ?? createDefaultGlobalConfigDraft();
    const draft = configStore.draft ?? createDefaultGlobalConfigDraft();
    const changes = buildConfigBatchChangesFromDraft(draft, baseline);
    if (changes.length === 0) {
      configStore.setLoadState("ready", "已同步生效配置（config/read）");
      return;
    }
    configStore.setSaving(true);
    configStore.setLoadState("ready", "保存中…");
    try {
      await requestConfigBatchWrite(changes);
      pushEvent("config", `saved ${changes.length} keys`, { threadId: appTimelineId });
      await refreshGlobalConfig();
      if (!silentSuccessToast) {
        showToast({
          kind: "success",
          title:
            source === "auto" ? "全局配置已自动保存" : "全局配置已保存",
          message: `已写入 ${changes.length} 项`,
        });
      }
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      configStore.setLoadState("error", `保存失败：${msg}`);
      pushEvent("config:error", msg, { threadId: appTimelineId, level: "error" });
      showToast({
        kind: "error",
        title:
          source === "auto"
            ? "全局配置自动保存失败"
            : "全局配置保存失败",
        message: msg,
      });
    } finally {
      configStore.setSaving(false);
      if (configStore.loadState !== "error") {
        configStore.setLoadState(
          "ready",
          configStore.isDirty ? "有未保存改动" : "已同步生效配置（config/read）"
        );
      }
    }
  };

  const resetGlobalConfig = () => {
    configStore.resetToSnapshot();
    configStore.setLoadState(
      "ready",
      configStore.isDirty ? "有未保存改动" : "已同步生效配置（config/read）"
    );
  };

  return {
    refreshGlobalConfig,
    ensureGlobalConfigLoadedOnce,
    saveGlobalConfig,
    resetGlobalConfig,
  };
}
