import { codexDesktop } from "../../api/codexDesktopClient";
import type { useCodexProfilesStore } from "../../stores/codexProfiles.store";
import type { ConfigWriteChange } from "../serverInterop";
import type { CodexProviderProfile } from "@codenexus/shared/codexProfiles";

type CodexProfilesStore = ReturnType<typeof useCodexProfilesStore>;
type RuntimeEventLevel = "info" | "warn" | "error";
type ToastKind = "info" | "success" | "warn" | "error";

type PushEvent = (method: string, paramsText: string, opts?: { threadId?: string; level?: RuntimeEventLevel }) => void;
type ShowToast = (options: { kind?: ToastKind; title?: string; message: string }) => void;

export type CodexProfileRuntimeDeps = {
  appTimelineId: string;
  codexProfilesStore: CodexProfilesStore;
  getWorkspacePath: () => string;
  getServerIdForWorkspace: (workspacePath: string) => string;
  requestConfigBatchWrite: (changes: ConfigWriteChange[], filePath?: string | null) => Promise<void>;
  refreshGlobalConfig: () => Promise<void>;
  pushEvent: PushEvent;
  showToast: ShowToast;
};

export type CodexProfileRuntime = {
  applyCodexProfile: (profileId: string) => Promise<void>;
};

function normalizeWorkspacePath(value: unknown): string {
  return String(value ?? "").trim();
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "");
}

function resolveCodexProfileBaseUrl(profile: CodexProviderProfile, baseUrlOverride?: string): string {
  return String(baseUrlOverride ?? profile.baseUrl ?? "").trim();
}

function buildCodexProfileConfigChanges(
  profile: CodexProviderProfile,
  baseUrlOverride?: string
): ConfigWriteChange[] {
  const providerId = String(profile.modelProviderId ?? "").trim();
  if (!providerId) throw new Error("模型供应商 ID 不能为空。");
  const model = String(profile.model ?? "").trim();
  if (!model) throw new Error("模型 ID 不能为空。");
  const baseUrl = resolveCodexProfileBaseUrl(profile, baseUrlOverride);
  if (!baseUrl) throw new Error("Base URL 不能为空。");
  return [
    { keyPath: "model_provider", value: providerId },
    { keyPath: "model", value: model },
    {
      keyPath: `model_providers.${providerId}`,
      value: {
        name: String(profile.name ?? "").trim() || providerId,
        base_url: baseUrl,
        wire_api: "responses",
        requires_openai_auth: true,
      },
    },
  ];
}

function buildCodexProfileAuthJsonContent(profile: CodexProviderProfile): string {
  return `${JSON.stringify({ OPENAI_API_KEY: String(profile.apiKey ?? "").trim() }, null, 2)}\n`;
}

export function createCodexProfileRuntime(deps: CodexProfileRuntimeDeps): CodexProfileRuntime {
  const {
    appTimelineId,
    codexProfilesStore,
    getWorkspacePath,
    getServerIdForWorkspace,
    requestConfigBatchWrite,
    refreshGlobalConfig,
    pushEvent,
    showToast,
  } = deps;

  const applyCodexProfile = async (profileId: string) => {
    const id = String(profileId ?? "").trim();
    if (!id) throw new Error("缺少模型配置 ID。");
    if (codexProfilesStore.loadState === "idle") {
      await codexProfilesStore.refresh();
    }
    const profile = codexProfilesStore.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("找不到该模型配置。");
    const workspace = normalizeWorkspacePath(getWorkspacePath());
    if (!getServerIdForWorkspace(workspace)) throw new Error("未连接服务，无法应用 Codex 配置。");

    codexProfilesStore.applyingProfileId = id;
    try {
      const deepSeekProxy =
        profile.providerKind === "deepseek-chat"
          ? await codexDesktop.app.prepareDeepSeekProxy({ upstreamBaseUrl: profile.baseUrl })
          : null;
      const isDeepSeekProfile = Boolean(deepSeekProxy);
      const codexBaseUrl = deepSeekProxy?.baseUrl ?? profile.baseUrl;
      const authFileContent = isDeepSeekProfile
        ? buildCodexProfileAuthJsonContent(profile)
        : String(profile.authFileContent ?? "").trim()
          ? String(profile.authFileContent ?? "")
          : buildCodexProfileAuthJsonContent(profile);
      const configFileContent =
        !isDeepSeekProfile && String(profile.configFileContent ?? "").trim() ? String(profile.configFileContent) : "";
      if (isDeepSeekProfile) {
        await codexDesktop.app.writeCodexAuthApiKey({
          apiKey: profile.apiKey,
          filePath: String(profile.authFilePath ?? "").trim() || null,
        });
      } else if (String(profile.authFilePath ?? "").trim()) {
        await codexDesktop.app.writeTextFile({ path: profile.authFilePath, content: authFileContent });
      } else {
        await codexDesktop.app.writeCodexAuthApiKey({ apiKey: profile.apiKey });
      }
      if (isDeepSeekProfile) {
        await requestConfigBatchWrite(
          buildCodexProfileConfigChanges(profile, codexBaseUrl),
          profile.configFilePath
        );
      } else if (String(profile.configFilePath ?? "").trim() && configFileContent) {
        await codexDesktop.app.writeTextFile({ path: profile.configFilePath, content: configFileContent });
      } else {
        await requestConfigBatchWrite(
          buildCodexProfileConfigChanges(profile, codexBaseUrl),
          profile.configFilePath
        );
      }
      await codexProfilesStore.setActiveProfile(id);
      await refreshGlobalConfig();
      pushEvent(
        "codex:profile",
        `applied ${profile.name}\nprovider=${profile.modelProviderId}\nkind=${profile.providerKind}\nmodel=${profile.model}`,
        {
          threadId: appTimelineId,
        }
      );
      showToast({
        kind: "success",
        title: "模型配置已切换",
        message: `${profile.name} · ${profile.model}`,
      });
    } catch (error: unknown) {
      const msg = readErrorMessage(error);
      pushEvent("codex:profile:error", msg, { threadId: appTimelineId, level: "error" });
      showToast({ kind: "error", title: "模型配置切换失败", message: msg });
      throw error;
    } finally {
      codexProfilesStore.applyingProfileId = "";
    }
  };

  return { applyCodexProfile };
}
