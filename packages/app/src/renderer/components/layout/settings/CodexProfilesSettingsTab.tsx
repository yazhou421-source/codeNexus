import {
  BarChart3,
  Bot,
  Copy,
  FlaskConical,
  GripVertical,
  Play,
  Plus,
  RefreshCw,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useCodexProfilesStore } from "../../../stores/codexProfiles.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { showCenterToast } from "../../../ui/centerToast";
import { showToast } from "../../../ui/toast";
import {
  DEFAULT_CODEX_AUTH_FILE_PATH,
  DEFAULT_CODEX_CONFIG_FILE_PATH,
  DEFAULT_CODEX_PROFILE_MODEL,
  DEFAULT_CODEX_PROVIDER_KIND,
  normalizeCodexProfileId,
  normalizeCodexProviderId,
  normalizeCodexProviderKind,
  type CodexProviderKind,
  type CodexProviderProfile,
  type CodexProviderProfileInput,
} from "@codenexus/shared/codexProfiles";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

type ProfileForm = {
  name: string;
  providerKind: CodexProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  authFilePath: string;
  configFilePath: string;
  authFileContent: string;
  configFileContent: string;
  order: number;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function escapeTomlString(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function siblingConfigPath(authPath: string): string {
  const text = String(authPath ?? "").trim();
  if (!text) return DEFAULT_CODEX_CONFIG_FILE_PATH;
  if (/auth\.json$/i.test(text)) return text.replace(/auth\.json$/i, "config.toml");
  const separatorIndex = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  if (separatorIndex < 0) return "config.toml";
  return `${text.slice(0, separatorIndex + 1)}config.toml`;
}

function profileInitial(profile: CodexProviderProfile): string {
  return (profile.name || profile.modelProviderId || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function providerKindLabel(value: CodexProviderKind): string {
  return value === "deepseek-chat" ? "DeepSeek" : "Responses";
}

function formatProviderLatency(elapsedMs: number | null | undefined): string {
  const n = Number(elapsedMs);
  if (!Number.isFinite(n) || n < 0) return "";
  return `${Math.round(n)}ms`;
}

function createEmptyForm(defaultAuthFilePath = "", defaultConfigFilePath = "", order = 0): ProfileForm {
  const form: ProfileForm = {
    name: "",
    providerKind: DEFAULT_CODEX_PROVIDER_KIND,
    model: DEFAULT_CODEX_PROFILE_MODEL,
    baseUrl: "",
    apiKey: "",
    authFilePath: defaultAuthFilePath,
    configFilePath: defaultConfigFilePath,
    authFileContent: "",
    configFileContent: "",
    order,
  };
  return {
    ...form,
    authFileContent: buildAuthJsonContent(form),
    configFileContent: buildConfigTomlContent(form, "provider"),
  };
}

function buildAuthJsonContent(form: Pick<ProfileForm, "apiKey">): string {
  return `${JSON.stringify({ OPENAI_API_KEY: String(form.apiKey ?? "").trim() }, null, 2)}\n`;
}

function buildConfigTomlContent(form: ProfileForm, modelProviderId: string): string {
  const providerId = normalizeCodexProviderId(modelProviderId);
  const name = form.name.trim() || providerId;
  const model = form.model.trim() || DEFAULT_CODEX_PROFILE_MODEL;
  const baseUrl =
    form.providerKind === "deepseek-chat" ? "<local DeepSeek proxy assigned on enable>" : form.baseUrl.trim();
  return [
    `model_provider = "${escapeTomlString(providerId)}"`,
    `model = "${escapeTomlString(model)}"`,
    "",
    `[model_providers.${providerId}]`,
    `name = "${escapeTomlString(name)}"`,
    `base_url = "${escapeTomlString(baseUrl)}"`,
    'wire_api = "responses"',
    "requires_openai_auth = true",
    "",
  ].join("\n");
}

export default function CodexProfilesSettingsTab() {
  const runtime = getRuntimeOrchestrator();
  const appShellStore = useAppShellStore();
  const profilesStore = useCodexProfilesStore();
  const runtimeStore = useRuntimeStore();
  const orderedProfiles = useMemo(
    () => [...profilesStore.profiles].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [profilesStore.profiles]
  );
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [errorText, setErrorText] = useState("");
  const [localSaving, setLocalSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draggingProfileId, setDraggingProfileId] = useState("");
  const [defaultAuthFilePath, setDefaultAuthFilePath] = useState(DEFAULT_CODEX_AUTH_FILE_PATH);
  const [defaultConfigFilePath, setDefaultConfigFilePath] = useState(DEFAULT_CODEX_CONFIG_FILE_PATH);
  const [fileEditorsDirty, setFileEditorsDirty] = useState(false);
  const [providerModelOptions, setProviderModelOptions] = useState<string[]>([]);
  const [providerModelsLoading, setProviderModelsLoading] = useState(false);
  const [providerModelsStatusText, setProviderModelsStatusText] = useState("");
  const [form, setForm] = useState<ProfileForm>(() => createEmptyForm());
  const mutationPending = profilesStore.saving || localSaving || Boolean(profilesStore.applyingProfileId);
  const canApplyForm = Boolean(
    form.name.trim() &&
      form.baseUrl.trim() &&
      form.model.trim() &&
      form.apiKey.trim() &&
      form.authFileContent.trim() &&
      form.configFileContent.trim()
  );
  const canFetchProviderModels =
    Boolean(form.baseUrl.trim() && form.apiKey.trim()) && !providerModelsLoading && !mutationPending;
  const baseUrlLabel =
    form.providerKind === "deepseek-chat"
      ? "上游 Base URL"
      : "Base URL";
  const baseUrlPlaceholder =
    form.providerKind === "deepseek-chat" ? DEFAULT_DEEPSEEK_BASE_URL : "https://example.com/v1";

  const resolveAuthFilePath = (value: string): string =>
    String(value ?? "").trim() || defaultAuthFilePath || DEFAULT_CODEX_AUTH_FILE_PATH;
  const resolveConfigFilePath = (value: string): string =>
    String(value ?? "").trim() || defaultConfigFilePath || DEFAULT_CODEX_CONFIG_FILE_PATH;
  const currentModelProviderId = (draft = form): string => {
    const existing = selectedProfileId ? profilesStore.profiles.find((item) => item.id === selectedProfileId) : null;
    if (existing?.modelProviderId) return existing.modelProviderId;
    const id = normalizeCodexProfileId(draft.name || draft.model || "provider") || "provider";
    return normalizeCodexProviderId(id);
  };
  const uniqueProfileId = (base: string, currentId = ""): string => {
    const normalized = normalizeCodexProfileId(base) || "provider";
    const used = new Set(profilesStore.profiles.filter((item) => item.id !== currentId).map((item) => item.id));
    if (!used.has(normalized)) return normalized;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${normalized}-${index}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${normalized}-${Date.now()}`;
  };
  const resetProviderModels = () => {
    setProviderModelOptions([]);
    setProviderModelsStatusText("");
    setProviderModelsLoading(false);
  };
  const updateForm = (patch: Partial<ProfileForm>, opts?: { markFileEditorsDirty?: boolean }) => {
    setForm((prev) => ({ ...prev, ...patch }));
    if (opts?.markFileEditorsDirty) setFileEditorsDirty(true);
  };

  const fillForm = (profile: CodexProviderProfile) => {
    const next: ProfileForm = {
      name: profile.name,
      providerKind: normalizeCodexProviderKind(profile.providerKind),
      model: profile.model,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      authFilePath: resolveAuthFilePath(profile.authFilePath),
      configFilePath: resolveConfigFilePath(profile.configFilePath),
      authFileContent: profile.authFileContent,
      configFileContent: profile.configFileContent,
      order: profile.order,
    };
    setFileEditorsDirty(Boolean(profile.authFileContent || profile.configFileContent));
    resetProviderModels();
    setForm({
      ...next,
      authFileContent: next.authFileContent || buildAuthJsonContent(next),
      configFileContent: next.configFileContent || buildConfigTomlContent(next, profile.modelProviderId),
    });
  };
  const resetForm = () => {
    setFileEditorsDirty(false);
    resetProviderModels();
    setForm(createEmptyForm(defaultAuthFilePath, defaultConfigFilePath, orderedProfiles.length));
  };
  const openEditor = (profile: CodexProviderProfile) => {
    setSelectedProfileId(profile.id);
    setErrorText("");
    fillForm(profile);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setSelectedProfileId("");
    setErrorText("");
  };
  const startNewProfile = () => {
    setSelectedProfileId("");
    setErrorText("");
    resetForm();
    setEditorOpen(true);
  };

  const buildInput = (): CodexProviderProfileInput => {
    const existing = selectedProfileId ? profilesStore.profiles.find((item) => item.id === selectedProfileId) : null;
    const id = existing?.id || uniqueProfileId(form.name || form.model || "provider");
    const modelProviderId = existing?.modelProviderId || normalizeCodexProviderId(id);
    return {
      id,
      name: form.name,
      providerKind: form.providerKind,
      modelProviderId,
      model: form.model,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      authFilePath: resolveAuthFilePath(form.authFilePath),
      configFilePath: resolveConfigFilePath(form.configFilePath),
      authFileContent: form.authFileContent,
      configFileContent: form.configFileContent,
      order: form.order,
    };
  };
  const saveProfile = async (options?: { showSuccessToast?: boolean }): Promise<string> => {
    const showSuccessToast = options?.showSuccessToast !== false;
    setErrorText("");
    setLocalSaving(true);
    try {
      const input = buildInput();
      if (!String(input.name ?? "").trim()) throw new Error("供应商名称不能为空。");
      if (!String(input.baseUrl ?? "").trim()) throw new Error("Base URL 不能为空。");
      if (!String(input.model ?? "").trim()) throw new Error("模型名称不能为空。");
      if (!String(input.apiKey ?? "").trim()) throw new Error("API Key 不能为空。");
      if (!String(input.configFileContent ?? "").trim()) throw new Error("config.toml 不能为空。");
      if (!String(input.authFileContent ?? "").trim()) throw new Error("auth.json 不能为空。");
      try {
        JSON.parse(String(input.authFileContent ?? ""));
      } catch {
        throw new Error("auth.json 不是有效 JSON。");
      }
      await profilesStore.upsert(input);
      const id = String(input.id ?? "").trim();
      if (selectedProfileId && selectedProfileId !== id) await profilesStore.deleteProfile(selectedProfileId);
      setSelectedProfileId(id);
      setEditorOpen(false);
      if (showSuccessToast) {
        showCenterToast({
          kind: "success",
          title: "保存成功",
          message: `${input.name} 配置已更新。`,
        });
      }
      return id;
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "保存失败");
      setErrorText(message);
      showCenterToast({ kind: "error", title: "保存失败", message });
      throw error;
    } finally {
      setLocalSaving(false);
    }
  };

  const readCodexConfig = async (): Promise<Record<string, unknown> | null> => {
    const serverId = String(runtimeStore.serverId ?? "").trim();
    if (!serverId) return null;
    const cwd = String(runtimeStore.workspacePath ?? "").trim();
    const { result } = await codexDesktop.codexServer.rpc({
      serverId,
      method: "config/read",
      params: { includeLayers: true, ...(cwd ? { cwd } : {}) },
    });
    return readRecord((result as any)?.config);
  };
  const loadDefaultCodexPaths = async () => {
    const auth = await codexDesktop.app.readCodexAuthApiKey().catch(() => null);
    const authPath = String(auth?.path ?? "").trim();
    const configPath = siblingConfigPath(authPath) || DEFAULT_CODEX_CONFIG_FILE_PATH;
    setDefaultAuthFilePath(authPath || DEFAULT_CODEX_AUTH_FILE_PATH);
    setDefaultConfigFilePath(configPath);
    setForm((prev) => ({
      ...prev,
      authFilePath: prev.authFilePath || authPath || DEFAULT_CODEX_AUTH_FILE_PATH,
      configFilePath: prev.configFilePath || configPath,
    }));
  };
  const autoImportCurrentCodexConfig = async () => {
    if (!runtimeStore.serverId) return;
    const config = await readCodexConfig().catch(() => null);
    if (!config) return;
    const providerId = String(config.model_provider ?? "").trim();
    const model = String(config.model ?? "").trim();
    if (!providerId || !model) return;
    const providers = readRecord(config.model_providers);
    const provider = readRecord(providers?.[providerId]);
    const baseUrl = String(provider?.base_url ?? "").trim();
    if (!baseUrl) return;
    const exists = profilesStore.profiles.some((item) => item.modelProviderId === providerId || item.id === providerId);
    if (exists) return;
    const auth = await codexDesktop.app.readCodexAuthApiKey().catch(() => null);
    await profilesStore.upsert({
      id: uniqueProfileId(providerId),
      name: String(provider?.name ?? providerId).trim() || providerId,
      providerKind: "openai-responses",
      modelProviderId: normalizeCodexProviderId(providerId),
      model,
      baseUrl,
      apiKey: auth?.apiKey ?? "",
      authFilePath: defaultAuthFilePath,
      configFilePath: defaultConfigFilePath,
      authFileContent: `${JSON.stringify({ OPENAI_API_KEY: auth?.apiKey ?? "" }, null, 2)}\n`,
      configFileContent: [
        `model_provider = "${escapeTomlString(normalizeCodexProviderId(providerId))}"`,
        `model = "${escapeTomlString(model)}"`,
        "",
        `[model_providers.${normalizeCodexProviderId(providerId)}]`,
        `name = "${escapeTomlString(String(provider?.name ?? providerId).trim() || providerId)}"`,
        `base_url = "${escapeTomlString(baseUrl)}"`,
        'wire_api = "responses"',
        "requires_openai_auth = true",
        "",
      ].join("\n"),
      order: orderedProfiles.length,
    });
    showToast({
      kind: "success",
      title: "已导入当前 Codex 配置",
      message: `${providerId} / ${model}`,
    });
  };
  const refresh = async () => {
    setErrorText("");
    await profilesStore.refresh();
    await autoImportCurrentCodexConfig();
  };

  useEffect(() => {
    void loadDefaultCodexPaths().finally(() => refresh());
  }, []);
  useEffect(() => {
    if (!editorOpen || fileEditorsDirty) return;
    setForm((prev) => ({
      ...prev,
      authFileContent: buildAuthJsonContent(prev),
      configFileContent: buildConfigTomlContent(prev, currentModelProviderId(prev)),
    }));
  }, [editorOpen, fileEditorsDirty, form.name, form.providerKind, form.model, form.baseUrl, form.apiKey, selectedProfileId]);
  useEffect(() => {
    if (!editorOpen) return;
    resetProviderModels();
    if (form.providerKind === "deepseek-chat") {
      setForm((prev) => ({
        ...prev,
        baseUrl: prev.baseUrl.trim() ? prev.baseUrl : DEFAULT_DEEPSEEK_BASE_URL,
        model: !prev.model.trim() || prev.model === DEFAULT_CODEX_PROFILE_MODEL ? DEFAULT_DEEPSEEK_MODEL : prev.model,
      }));
    }
  }, [form.providerKind, editorOpen]);
  useEffect(() => {
    if (!editorOpen || providerModelsLoading) return;
    setProviderModelOptions([]);
    setProviderModelsStatusText("");
  }, [form.baseUrl, form.apiKey, editorOpen, providerModelsLoading]);

  const applyProfile = async (id: string) => {
    if (!runtimeStore.serverId) {
      showToast({
        kind: "warn",
        title: "未连接 Codex 服务",
        message: "连接服务后才能写入 config.toml。",
      });
      return;
    }
    await runtime.applyCodexProfile(id);
  };
  const saveAndApply = async () => {
    try {
      const id = await saveProfile({ showSuccessToast: false });
      if (id) await applyProfile(id);
    } catch (error: any) {
      setErrorText(String(error?.message ?? error ?? "应用失败"));
    }
  };
  const fetchProviderModels = async () => {
    if (!form.baseUrl.trim() || !form.apiKey.trim() || providerModelsLoading) return;
    setProviderModelsLoading(true);
    setProviderModelsStatusText("正在获取模型...");
    try {
      const result = await codexDesktop.app.testCodexProvider({
        providerKind: form.providerKind,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        timeoutMs: 15_000,
      });
      if (!result.ok) {
        setProviderModelOptions([]);
        setProviderModelsStatusText(result.message || "获取模型失败。");
        showCenterToast({
          kind: "error",
          title: "获取模型失败",
          message: result.message || "获取模型失败。",
        });
        return;
      }
      setProviderModelOptions(result.models);
      const elapsed = formatProviderLatency(result.elapsedMs);
      const suffix = elapsed ? `，响应时间 ${elapsed}` : "";
      setProviderModelsStatusText(
        result.models.length > 0
          ? `已获取 ${result.models.length} 个模型${suffix}。`
          : `连接成功，但未读取到模型${suffix}。`
      );
      if (result.models.length > 0 && !form.model.trim()) updateForm({ model: result.models[0] });
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "获取模型失败");
      setProviderModelOptions([]);
      setProviderModelsStatusText(message);
      showCenterToast({ kind: "error", title: "获取模型失败", message });
    } finally {
      setProviderModelsLoading(false);
    }
  };
  const duplicateProfile = async (profile: CodexProviderProfile) => {
    const id = uniqueProfileId(`${profile.id}-copy`);
    await profilesStore.upsert({
      ...profile,
      id,
      name: `${profile.name} copy`,
      modelProviderId: uniqueProfileId(`${profile.modelProviderId}-copy`),
      order: orderedProfiles.length,
      lastTestedAt: null,
      lastTestStatus: null,
      lastTestMessage: null,
    });
    showToast({
      kind: "success",
      title: "已复制供应商",
      message: `${profile.name} copy`,
    });
  };
  const deleteProfile = async (profile: CodexProviderProfile) => {
    if (!window.confirm(`删除供应商「${profile.name}」？`)) return;
    await profilesStore.deleteProfile(profile.id);
    if (selectedProfileId === profile.id) closeEditor();
  };
  const testProfile = async (profile: CodexProviderProfile) => {
    setLocalSaving(true);
    try {
      const result = await codexDesktop.app.testCodexProvider({
        providerKind: profile.providerKind,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        timeoutMs: 15_000,
      });
      await profilesStore.upsert({
        ...profile,
        lastTestedAt: Date.now(),
        lastTestStatus: result.ok ? "ok" : "error",
        lastTestMessage: result.ok
          ? `连接成功${
              result.elapsedMs == null ? "" : `，响应时间 ${formatProviderLatency(result.elapsedMs)}`
            }`
          : result.message,
      });
      const elapsed = formatProviderLatency(result.elapsedMs);
      showToast({
        kind: result.ok ? "success" : "error",
        title: result.ok ? "连接成功" : "连接失败",
        message: result.ok
          ? elapsed
            ? `响应时间 ${elapsed}`
            : "连接成功。"
          : result.message,
      });
    } finally {
      setLocalSaving(false);
    }
  };
  const showProfileStats = (profile: CodexProviderProfile) => {
    const tested = profile.lastTestedAt
      ? new Date(profile.lastTestedAt).toLocaleString(appShellStore.language)
      : "未测试";
    const statusLabel =
      profile.lastTestStatus === "ok"
        ? "正常"
        : profile.lastTestStatus === "error"
          ? "异常"
          : profile.lastTestStatus;
    const status = statusLabel
      ? `${statusLabel}: ${profile.lastTestMessage ?? ""}`
      : "无测试结果";
    window.alert(`供应商：${profile.name}\n模型：${profile.model}\n最近测试：${tested}\n状态：${status}`);
  };
  const onDrop = async (targetId: string) => {
    const sourceId = draggingProfileId;
    setDraggingProfileId("");
    if (!sourceId || sourceId === targetId) return;
    const list = [...orderedProfiles];
    const sourceIndex = list.findIndex((item) => item.id === sourceId);
    const targetIndex = list.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [source] = list.splice(sourceIndex, 1);
    list.splice(targetIndex, 0, source);
    setLocalSaving(true);
    try {
      for (let index = 0; index < list.length; index += 1) {
        await profilesStore.upsert({ ...list[index], order: index });
      }
    } finally {
      setLocalSaving(false);
    }
  };
  const onDragOver = (event: DragEvent<HTMLElement>) => event.preventDefault();

  return (
    <section className="codex-providers-page" aria-label="Codex 模型供应商配置">
      {profilesStore.errorText || errorText ? (
        <div className="global-field-error">{profilesStore.errorText || errorText}</div>
      ) : null}

      {!editorOpen ? (
        <div className="codex-providers-list-page">
          <div className="codex-providers-shell">
            <section className="codex-provider-list" aria-label="供应商列表">
              {orderedProfiles.map((profile) => {
                const active = profilesStore.activeProfileId === profile.id;
                const dragging = draggingProfileId === profile.id;
                return (
                  <article
                    key={profile.id}
                    className={`codex-provider-card${active ? " is-active" : ""}${dragging ? " is-dragging" : ""}`}
                    draggable
                    onDragStart={() => setDraggingProfileId(profile.id)}
                    onDragOver={onDragOver}
                    onDrop={(event) => {
                      event.preventDefault();
                      void onDrop(profile.id);
                    }}
                    onDragEnd={() => setDraggingProfileId("")}
                  >
                    <button className="codex-provider-grip" type="button" aria-label="拖拽排序">
                      <GripVertical aria-hidden="true" />
                    </button>
                    <div className="codex-provider-avatar mono" aria-hidden="true">
                      {profileInitial(profile)}
                    </div>
                    <button className="codex-provider-main" type="button" onClick={() => openEditor(profile)}>
                      <span className="codex-provider-name">{profile.name}</span>
                      <span className="codex-provider-url mono">
                        {providerKindLabel(profile.providerKind)} · {profile.baseUrl}
                      </span>
                    </button>
                    <div className="codex-provider-actions">
                      <button
                        className="codex-provider-enable"
                        type="button"
                        disabled={!runtimeStore.serverId || mutationPending}
                        onClick={() => void applyProfile(profile.id)}
                      >
                        <Play aria-hidden="true" />
                        启用
                      </button>
                      <button className="btn-icon" type="button" title="编辑" onClick={() => openEditor(profile)}>
                        <SquarePen aria-hidden="true" />
                      </button>
                      <button
                        className="btn-icon"
                        type="button"
                        title="复制"
                        disabled={mutationPending}
                        onClick={() => void duplicateProfile(profile)}
                      >
                        <Copy aria-hidden="true" />
                      </button>
                      <button
                        className="btn-icon"
                        type="button"
                        title="测试连接"
                        disabled={mutationPending}
                        onClick={() => void testProfile(profile)}
                      >
                        <FlaskConical aria-hidden="true" />
                      </button>
                      <button className="btn-icon" type="button" title="状态" onClick={() => showProfileStats(profile)}>
                        <BarChart3 aria-hidden="true" />
                      </button>
                      <button
                        className="btn-icon danger"
                        type="button"
                        title="删除"
                        disabled={mutationPending}
                        onClick={() => void deleteProfile(profile)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                );
              })}
              {orderedProfiles.length === 0 ? (
                <div className="codex-provider-empty">
                  <Bot aria-hidden="true" />
                  <div>
                    <strong>暂无供应商</strong>
                    <span>新建一条配置，或连接 Codex 服务后从当前 CLI 配置自动导入。</span>
                  </div>
                </div>
              ) : null}
            </section>

            <div className="codex-providers-floating-actions" aria-label="供应商操作">
              <button className="codex-provider-float-btn" type="button" disabled={profilesStore.loadState === "loading"} onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" />
                <span>刷新</span>
              </button>
              <button
                className="codex-provider-float-btn codex-provider-float-btn--primary"
                type="button"
                title="新建供应商"
                aria-label="新建供应商"
                onClick={startNewProfile}
              >
                <Plus aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="codex-provider-editor-page">
          <section className="codex-provider-editor" aria-label="编辑供应商">
            <div className="codex-editor-head">
              <div>
                <div className="codex-editor-title">
                  {selectedProfileId ? "编辑供应商" : "新建供应商"}
                </div>
                <div className="codex-editor-subtitle mono">{profilesStore.path || "codex-profiles.json"}</div>
              </div>
              <button className="btn-icon" type="button" onClick={closeEditor}>
                <X aria-hidden="true" />
              </button>
            </div>

            <form
              className="codex-editor-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveProfile();
              }}
            >
              <label className="global-row">
                <span className="context-label">供应商名称</span>
                <input
                  className="context-input"
                  type="text"
                  autoComplete="off"
                  placeholder="xcode"
                  value={form.name}
                  onChange={(event) => updateForm({ name: event.currentTarget.value })}
                />
              </label>
              <label className="global-row">
                <span className="context-label">供应商类型</span>
                <select
                  className="context-input"
                  value={form.providerKind}
                  onChange={(event) => updateForm({ providerKind: event.currentTarget.value as CodexProviderKind })}
                >
                  <option value="openai-responses">OpenAI Responses 兼容</option>
                  <option value="deepseek-chat">DeepSeek Chat Completions</option>
                </select>
              </label>
              <label className="global-row">
                <span className="context-label">模型名称</span>
                <div className="codex-model-picker">
                  <input
                    className="context-input mono"
                    type="text"
                    autoComplete="off"
                    list="codex-provider-model-options"
                    placeholder="gpt-5.4"
                    value={form.model}
                    onChange={(event) => updateForm({ model: event.currentTarget.value })}
                  />
                  <button className="btn-mini codex-model-fetch-btn" type="button" disabled={!canFetchProviderModels} onClick={() => void fetchProviderModels()}>
                    {providerModelsLoading ? "获取中" : "获取模型"}
                  </button>
                </div>
              </label>
              <datalist id="codex-provider-model-options">
                {providerModelOptions.map((modelId) => (
                  <option key={modelId} value={modelId} />
                ))}
              </datalist>
              {providerModelOptions.length || providerModelsStatusText ? (
                <div className="codex-model-select-row">
                  <span className="context-label" />
                  <div className="codex-model-select-stack">
                    {providerModelOptions.length ? (
                      <select
                        className="context-input mono codex-model-select"
                        value={form.model}
                        onChange={(event) => {
                          const next = String(event.currentTarget.value ?? "").trim();
                          if (next) updateForm({ model: next });
                        }}
                      >
                        <option value="" disabled>
                          选择获取到的模型
                        </option>
                        {form.model && !providerModelOptions.includes(form.model) ? (
                          <option value={form.model}>{`${form.model}（当前）`}</option>
                        ) : null}
                        {providerModelOptions.map((modelId) => (
                          <option key={modelId} value={modelId}>
                            {modelId}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {providerModelsStatusText ? <div className="codex-model-status">{providerModelsStatusText}</div> : null}
                  </div>
                </div>
              ) : null}
              <label className="global-row">
                <span className="context-label">{baseUrlLabel}</span>
                <input
                  className="context-input mono"
                  type="url"
                  autoComplete="off"
                  placeholder={baseUrlPlaceholder}
                  value={form.baseUrl}
                  onChange={(event) => updateForm({ baseUrl: event.currentTarget.value })}
                />
              </label>
              {form.providerKind === "deepseek-chat" ? (
                <div className="codex-provider-hint">DeepSeek 会通过本机 127.0.0.1 代理接入 Codex；启用时会自动把 config.toml 写成代理地址。</div>
              ) : null}
              <label className="global-row">
                <span className="context-label">API Key</span>
                <input
                  className="context-input mono"
                  type="password"
                  autoComplete="off"
                  placeholder="sk-..."
                  value={form.apiKey}
                  onChange={(event) => updateForm({ apiKey: event.currentTarget.value })}
                />
              </label>

              <section className="codex-file-editor-block">
                <div className="codex-file-editor-head">
                  <div>
                    <div className="codex-file-editor-title">
                      config.toml <span>(TOML)</span> *
                    </div>
                    <div className="codex-file-editor-path mono">{resolveConfigFilePath(form.configFilePath)}</div>
                  </div>
                </div>
                <textarea
                  className="codex-file-editor-textarea app-scrollbar mono"
                  spellCheck={false}
                  value={form.configFileContent}
                  onChange={(event) => updateForm({ configFileContent: event.currentTarget.value }, { markFileEditorsDirty: true })}
                />
              </section>
              <section className="codex-file-editor-block">
                <div className="codex-file-editor-head">
                  <div>
                    <div className="codex-file-editor-title">
                      auth.json <span>(JSON)</span> *
                    </div>
                    <div className="codex-file-editor-path mono">{resolveAuthFilePath(form.authFilePath)}</div>
                  </div>
                </div>
                <textarea
                  className="codex-file-editor-textarea app-scrollbar mono"
                  spellCheck={false}
                  value={form.authFileContent}
                  onChange={(event) => updateForm({ authFileContent: event.currentTarget.value }, { markFileEditorsDirty: true })}
                />
              </section>
              <div className="codex-editor-actions">
                <button className="btn-mini" type="button" disabled={mutationPending} onClick={closeEditor}>
                  取消
                </button>
                <button className="btn-mini" type="submit" disabled={mutationPending}>
                  保存
                </button>
                <button className="btn-mini" type="button" disabled={mutationPending || !canApplyForm} onClick={() => void saveAndApply()}>
                  保存并启用
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
