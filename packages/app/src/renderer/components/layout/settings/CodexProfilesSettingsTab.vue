<template>
  <section class="codex-providers-page" :aria-label="t('codexProfiles.aria')">
    <div v-if="profilesStore.errorText || errorText" class="global-field-error">
      {{ profilesStore.errorText || errorText }}
    </div>

    <Transition name="codex-provider-page-fade" mode="out-in">
      <div v-if="!editorOpen" key="list" class="codex-providers-list-page">
        <div class="codex-providers-shell">
          <section class="codex-provider-list" :aria-label="t('codexProfiles.providerListAria')">
            <article
              v-for="profile in orderedProfiles"
              :key="profile.id"
              class="codex-provider-card"
              :class="{
                'is-active': profilesStore.activeProfileId === profile.id,
                'is-dragging': draggingProfileId === profile.id,
              }"
              draggable="true"
              @dragstart="onDragStart(profile.id)"
              @dragover.prevent
              @drop.prevent="onDrop(profile.id)"
              @dragend="onDragEnd"
            >
              <button class="codex-provider-grip" type="button" :aria-label="t('codexProfiles.dragSort')">
                <GripVertical aria-hidden="true" />
              </button>

              <div class="codex-provider-avatar mono" aria-hidden="true">
                {{ profileInitial(profile) }}
              </div>

              <button class="codex-provider-main" type="button" @click="openEditor(profile)">
                <span class="codex-provider-name">{{ profile.name }}</span>
                <span class="codex-provider-url mono"
                  >{{ providerKindLabel(profile.providerKind) }} · {{ profile.baseUrl }}</span
                >
              </button>

              <div class="codex-provider-actions">
                <button
                  class="codex-provider-enable"
                  type="button"
                  :disabled="!runtimeStore.serverId || mutationPending"
                  @click="applyProfile(profile.id)"
                >
                  <Play aria-hidden="true" />
                  {{ t("codexProfiles.enable") }}
                </button>
                <button class="btn-icon" type="button" :title="t('codexProfiles.edit')" @click="openEditor(profile)">
                  <SquarePen aria-hidden="true" />
                </button>
                <button
                  class="btn-icon"
                  type="button"
                  :title="t('codexProfiles.copy')"
                  :disabled="mutationPending"
                  @click="duplicateProfile(profile)"
                >
                  <Copy aria-hidden="true" />
                </button>
                <button
                  class="btn-icon"
                  type="button"
                  :title="t('codexProfiles.testConnection')"
                  :disabled="mutationPending"
                  @click="testProfile(profile)"
                >
                  <FlaskConical aria-hidden="true" />
                </button>
                <button
                  class="btn-icon"
                  type="button"
                  :title="t('codexProfiles.status')"
                  @click="showProfileStats(profile)"
                >
                  <BarChart3 aria-hidden="true" />
                </button>
                <button
                  class="btn-icon danger"
                  type="button"
                  :title="t('common.delete')"
                  :disabled="mutationPending"
                  @click="deleteProfile(profile)"
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            </article>

            <div v-if="orderedProfiles.length === 0" class="codex-provider-empty">
              <Bot aria-hidden="true" />
              <div>
                <strong>{{ t("codexProfiles.emptyTitle") }}</strong>
                <span>{{ t("codexProfiles.emptyDesc") }}</span>
              </div>
            </div>
          </section>

          <div class="codex-providers-floating-actions" :aria-label="t('codexProfiles.actionsAria')">
            <button
              class="codex-provider-float-btn"
              type="button"
              :disabled="profilesStore.loadState === 'loading'"
              @click="refresh"
            >
              <RefreshCw aria-hidden="true" />
              <span>{{ t("common.refresh") }}</span>
            </button>
            <button
              class="codex-provider-float-btn codex-provider-float-btn--primary"
              type="button"
              :title="t('codexProfiles.newProvider')"
              :aria-label="t('codexProfiles.newProvider')"
              @click="startNewProfile"
            >
              <Plus aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div v-else key="editor" class="codex-provider-editor-page">
        <section class="codex-provider-editor" :aria-label="t('codexProfiles.editorAria')">
          <div class="codex-editor-head">
            <div>
              <div class="codex-editor-title">
                {{ selectedProfileId ? t("codexProfiles.editProvider") : t("codexProfiles.newProvider") }}
              </div>
              <div class="codex-editor-subtitle mono">{{ profilesStore.path || "codex-profiles.json" }}</div>
            </div>
            <button class="btn-icon" type="button" @click="closeEditor">
              <X aria-hidden="true" />
            </button>
          </div>

          <form class="codex-editor-form" @submit.prevent="saveProfile">
            <label class="global-row">
              <span class="context-label">{{ t("codexProfiles.providerName") }}</span>
              <input v-model="form.name" class="context-input" type="text" autocomplete="off" placeholder="xcode" />
            </label>

            <label class="global-row">
              <span class="context-label">{{ t("codexProfiles.providerType") }}</span>
              <select v-model="form.providerKind" class="context-input">
                <option value="openai-responses">{{ t("codexProfiles.openaiResponses") }}</option>
                <option value="deepseek-chat">{{ t("codexProfiles.deepseekChat") }}</option>
              </select>
            </label>

            <label class="global-row">
              <span class="context-label">{{ t("codexProfiles.modelName") }}</span>
              <div class="codex-model-picker">
                <input
                  v-model="form.model"
                  class="context-input mono"
                  type="text"
                  autocomplete="off"
                  list="codex-provider-model-options"
                  placeholder="gpt-5.4"
                />
                <button
                  class="btn-mini codex-model-fetch-btn"
                  type="button"
                  :disabled="!canFetchProviderModels"
                  @click="fetchProviderModels"
                >
                  {{ providerModelsLoading ? t("codexProfiles.fetchingModels") : t("codexProfiles.fetchModels") }}
                </button>
              </div>
            </label>

            <datalist id="codex-provider-model-options">
              <option v-for="modelId in providerModelOptions" :key="modelId" :value="modelId"></option>
            </datalist>

            <div v-if="providerModelOptions.length || providerModelsStatusText" class="codex-model-select-row">
              <span class="context-label"></span>
              <div class="codex-model-select-stack">
                <select
                  v-if="providerModelOptions.length"
                  class="context-input mono codex-model-select"
                  :value="form.model"
                  @change="onProviderModelSelect"
                >
                  <option value="" disabled>{{ t("codexProfiles.chooseFetchedModel") }}</option>
                  <option v-if="form.model && !providerModelOptions.includes(form.model)" :value="form.model">
                    {{ t("codexProfiles.modelCurrent", { model: form.model }) }}
                  </option>
                  <option v-for="modelId in providerModelOptions" :key="modelId" :value="modelId">
                    {{ modelId }}
                  </option>
                </select>
                <div v-if="providerModelsStatusText" class="codex-model-status">
                  {{ providerModelsStatusText }}
                </div>
              </div>
            </div>

            <label class="global-row">
              <span class="context-label">{{ baseUrlLabel }}</span>
              <input
                v-model="form.baseUrl"
                class="context-input mono"
                type="url"
                autocomplete="off"
                :placeholder="baseUrlPlaceholder"
              />
            </label>

            <div v-if="form.providerKind === 'deepseek-chat'" class="codex-provider-hint">
              {{ t("codexProfiles.deepseekProxyHint") }}
            </div>

            <label class="global-row">
              <span class="context-label">API Key</span>
              <input
                v-model="form.apiKey"
                class="context-input mono"
                type="password"
                autocomplete="off"
                placeholder="sk-..."
              />
            </label>

            <section class="codex-file-editor-block">
              <div class="codex-file-editor-head">
                <div>
                  <div class="codex-file-editor-title">config.toml <span>(TOML)</span> *</div>
                  <div class="codex-file-editor-path mono">{{ resolveConfigFilePath(form.configFilePath) }}</div>
                </div>
              </div>
              <textarea
                v-model="form.configFileContent"
                class="codex-file-editor-textarea app-scrollbar mono"
                spellcheck="false"
                @input="markFileEditorsDirty"
              ></textarea>
            </section>

            <section class="codex-file-editor-block">
              <div class="codex-file-editor-head">
                <div>
                  <div class="codex-file-editor-title">auth.json <span>(JSON)</span> *</div>
                  <div class="codex-file-editor-path mono">{{ resolveAuthFilePath(form.authFilePath) }}</div>
                </div>
              </div>
              <textarea
                v-model="form.authFileContent"
                class="codex-file-editor-textarea app-scrollbar mono"
                spellcheck="false"
                @input="markFileEditorsDirty"
              ></textarea>
            </section>

            <div class="codex-editor-actions">
              <button class="btn-mini" type="button" :disabled="mutationPending" @click="closeEditor">
                {{ t("common.cancel") }}
              </button>
              <button class="btn-mini" type="submit" :disabled="mutationPending">{{ t("common.save") }}</button>
              <button class="btn-mini" type="button" :disabled="mutationPending || !canApplyForm" @click="saveAndApply">
                {{ t("codexProfiles.saveAndEnable") }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { importableCodexConfig } from "../../../domain/importableCodexConfig";
import { isCalmnovaRouterProvider, isCalmnovaCodexEndpoint } from "@codenexus/shared/codexConfigOwnership";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
} from "lucide-vue-next";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { useCodexProfilesStore } from "../../../stores/codexProfiles.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { showCenterToast } from "../../../ui/centerToast";
import { showToast } from "../../../ui/toast";
import {
  DEFAULT_CODEX_AUTH_FILE_PATH,
  DEFAULT_CODEX_CONFIG_FILE_PATH,
  DEFAULT_CODEX_PROVIDER_KIND,
  DEFAULT_CODEX_PROFILE_MODEL,
  normalizeCodexProviderKind,
  normalizeCodexProfileId,
  normalizeCodexProviderId,
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

const runtime = getRuntimeOrchestrator();
const runtimeStore = useRuntimeStore();
const profilesStore = useCodexProfilesStore();
const { locale, t } = useI18n();
const selectedProfileId = ref("");
const errorText = ref("");
const localSaving = ref(false);
const editorOpen = ref(false);
const draggingProfileId = ref("");
const defaultAuthFilePath = ref(DEFAULT_CODEX_AUTH_FILE_PATH);
const defaultConfigFilePath = ref(DEFAULT_CODEX_CONFIG_FILE_PATH);
const fileEditorsDirty = ref(false);
const providerModelOptions = ref<string[]>([]);
const providerModelsLoading = ref(false);
const providerModelsStatusText = ref("");

const form = reactive<ProfileForm>({
  name: "",
  providerKind: DEFAULT_CODEX_PROVIDER_KIND,
  model: DEFAULT_CODEX_PROFILE_MODEL,
  baseUrl: "",
  apiKey: "",
  authFilePath: "",
  configFilePath: "",
  authFileContent: "",
  configFileContent: "",
  order: 0,
});

const orderedProfiles = computed(() =>
  [...profilesStore.profiles].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
);
const mutationPending = computed(
  () => profilesStore.saving || localSaving.value || Boolean(profilesStore.applyingProfileId)
);
const canApplyForm = computed(() =>
  Boolean(
    form.name.trim() &&
    form.baseUrl.trim() &&
    form.model.trim() &&
    form.apiKey.trim() &&
    form.authFileContent.trim() &&
    form.configFileContent.trim()
  )
);
const canFetchProviderModels = computed(
  () => Boolean(form.baseUrl.trim() && form.apiKey.trim()) && !providerModelsLoading.value && !mutationPending.value
);
const baseUrlLabel = computed(() =>
  form.providerKind === "deepseek-chat" ? t("codexProfiles.upstreamBaseUrl") : t("codexProfiles.baseUrl")
);
const baseUrlPlaceholder = computed(() =>
  form.providerKind === "deepseek-chat" ? DEFAULT_DEEPSEEK_BASE_URL : "https://example.com/v1"
);

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function uniqueProfileId(base: string, currentId = ""): string {
  const normalized = normalizeCodexProfileId(base) || "provider";
  const used = new Set(profilesStore.profiles.filter((item) => item.id !== currentId).map((item) => item.id));
  if (!used.has(normalized)) return normalized;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalized}-${index}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${normalized}-${Date.now()}`;
}

function siblingConfigPath(authPath: string): string {
  const text = String(authPath ?? "").trim();
  if (!text) return DEFAULT_CODEX_CONFIG_FILE_PATH;
  if (/auth\.json$/i.test(text)) return text.replace(/auth\.json$/i, "config.toml");
  const separatorIndex = Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\"));
  if (separatorIndex < 0) return "config.toml";
  return `${text.slice(0, separatorIndex + 1)}config.toml`;
}

function resolveAuthFilePath(value: string): string {
  return String(value ?? "").trim() || defaultAuthFilePath.value || DEFAULT_CODEX_AUTH_FILE_PATH;
}

function resolveConfigFilePath(value: string): string {
  return String(value ?? "").trim() || defaultConfigFilePath.value || DEFAULT_CODEX_CONFIG_FILE_PATH;
}

function escapeTomlString(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function currentModelProviderId(): string {
  const existing = selectedProfileId.value
    ? profilesStore.profiles.find((item) => item.id === selectedProfileId.value)
    : null;
  if (existing?.modelProviderId) return existing.modelProviderId;
  const id = normalizeCodexProfileId(form.name || form.model || "provider") || "provider";
  return normalizeCodexProviderId(id);
}

function providerKindLabel(value: CodexProviderKind): string {
  return value === "deepseek-chat" ? "DeepSeek" : "Responses";
}

function buildAuthJsonContent(): string {
  return `${JSON.stringify({ OPENAI_API_KEY: form.apiKey.trim() }, null, 2)}\n`;
}

function buildConfigTomlContent(): string {
  const providerId = currentModelProviderId();
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

function refreshGeneratedFileEditors() {
  form.authFileContent = buildAuthJsonContent();
  form.configFileContent = buildConfigTomlContent();
}

function markFileEditorsDirty() {
  fileEditorsDirty.value = true;
}

function resetProviderModels() {
  providerModelOptions.value = [];
  providerModelsStatusText.value = "";
  providerModelsLoading.value = false;
}

function fillForm(profile: CodexProviderProfile) {
  fileEditorsDirty.value = false;
  resetProviderModels();
  form.name = profile.name;
  form.providerKind = normalizeCodexProviderKind(profile.providerKind);
  form.model = profile.model;
  form.baseUrl = profile.baseUrl;
  form.apiKey = profile.apiKey;
  form.authFilePath = resolveAuthFilePath(profile.authFilePath);
  form.configFilePath = resolveConfigFilePath(profile.configFilePath);
  form.authFileContent = profile.authFileContent || buildAuthJsonContent();
  form.configFileContent = profile.configFileContent || buildConfigTomlContent();
  form.order = profile.order;
  fileEditorsDirty.value = Boolean(profile.authFileContent || profile.configFileContent);
}

function resetForm() {
  fileEditorsDirty.value = false;
  resetProviderModels();
  const nextOrder = orderedProfiles.value.length;
  form.name = "";
  form.providerKind = DEFAULT_CODEX_PROVIDER_KIND;
  form.model = DEFAULT_CODEX_PROFILE_MODEL;
  form.baseUrl = "";
  form.apiKey = "";
  form.authFilePath = defaultAuthFilePath.value;
  form.configFilePath = defaultConfigFilePath.value;
  refreshGeneratedFileEditors();
  form.order = nextOrder;
}

function startNewProfile() {
  selectedProfileId.value = "";
  errorText.value = "";
  resetForm();
  editorOpen.value = true;
}

function openEditor(profile: CodexProviderProfile) {
  selectedProfileId.value = profile.id;
  errorText.value = "";
  fillForm(profile);
  editorOpen.value = true;
}

function closeEditor() {
  editorOpen.value = false;
  selectedProfileId.value = "";
  errorText.value = "";
}

function buildInput(): CodexProviderProfileInput {
  const existing = selectedProfileId.value
    ? profilesStore.profiles.find((item) => item.id === selectedProfileId.value)
    : null;
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
}

async function saveProfile(options?: { showSuccessToast?: boolean }): Promise<string> {
  const showSuccessToast = options?.showSuccessToast !== false;
  errorText.value = "";
  localSaving.value = true;
  try {
    const input = buildInput();
    if (!String(input.name ?? "").trim()) throw new Error(t("codexProfiles.validation.providerNameRequired"));
    if (!String(input.baseUrl ?? "").trim()) throw new Error(t("codexProfiles.validation.baseUrlRequired"));
    if (!String(input.model ?? "").trim()) throw new Error(t("codexProfiles.validation.modelNameRequired"));
    if (!String(input.apiKey ?? "").trim()) throw new Error(t("codexProfiles.validation.apiKeyRequired"));
    if (!String(input.configFileContent ?? "").trim()) throw new Error(t("codexProfiles.validation.configRequired"));
    if (!String(input.authFileContent ?? "").trim()) throw new Error(t("codexProfiles.validation.authRequired"));
    try {
      JSON.parse(String(input.authFileContent ?? ""));
    } catch {
      throw new Error(t("codexProfiles.validation.authInvalidJson"));
    }
    await profilesStore.upsert(input);
    const id = String(input.id ?? "").trim();
    if (selectedProfileId.value && selectedProfileId.value !== id) {
      await profilesStore.deleteProfile(selectedProfileId.value);
    }
    selectedProfileId.value = id;
    editorOpen.value = false;
    if (showSuccessToast) {
      showCenterToast({
        kind: "success",
        title: t("codexProfiles.saveSuccessTitle"),
        message: t("codexProfiles.saveSuccessMessage", { name: input.name }),
      });
    }
    return id;
  } catch (error: any) {
    errorText.value = String(error?.message ?? error ?? t("codexProfiles.saveFailedTitle"));
    showCenterToast({ kind: "error", title: t("codexProfiles.saveFailedTitle"), message: errorText.value });
    throw error;
  } finally {
    localSaving.value = false;
  }
}

async function saveAndApply() {
  try {
    const id = await saveProfile({ showSuccessToast: false });
    if (id) await applyProfile(id);
  } catch (error: any) {
    errorText.value = String(error?.message ?? error ?? t("codexProfiles.applyFailed"));
  }
}

function formatProviderLatency(elapsedMs: number | null | undefined): string {
  const n = Number(elapsedMs);
  if (!Number.isFinite(n) || n < 0) return "";
  return `${Math.round(n)}ms`;
}

async function fetchProviderModels() {
  if (!form.baseUrl.trim() || !form.apiKey.trim() || providerModelsLoading.value) return;
  providerModelsLoading.value = true;
  providerModelsStatusText.value = t("codexProfiles.fetchingModelsStatus");
  try {
    const result = await codexDesktop.app.testCodexProvider({
      providerKind: form.providerKind,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      timeoutMs: 15_000,
    });
    if (!result.ok) {
      providerModelOptions.value = [];
      providerModelsStatusText.value = result.message || t("codexProfiles.fetchModelsFailedMessage");
      showCenterToast({
        kind: "error",
        title: t("codexProfiles.fetchModelsFailedTitle"),
        message: providerModelsStatusText.value,
      });
      return;
    }

    providerModelOptions.value = result.models;
    const elapsed = formatProviderLatency(result.elapsedMs);
    const suffix = elapsed ? t("codexProfiles.latencySuffix", { elapsed }) : "";
    providerModelsStatusText.value =
      result.models.length > 0
        ? t("codexProfiles.modelsFetched", { count: result.models.length, suffix })
        : t("codexProfiles.connectedNoModels", { suffix });
    if (result.models.length > 0 && !form.model.trim()) {
      form.model = result.models[0];
    }
  } catch (error: any) {
    providerModelOptions.value = [];
    providerModelsStatusText.value = String(error?.message ?? error ?? t("codexProfiles.fetchModelsFailedTitle"));
    showCenterToast({
      kind: "error",
      title: t("codexProfiles.fetchModelsFailedTitle"),
      message: providerModelsStatusText.value,
    });
  } finally {
    providerModelsLoading.value = false;
  }
}

function onProviderModelSelect(event: Event) {
  const target = event.target as HTMLSelectElement | null;
  const next = String(target?.value ?? "").trim();
  if (next) form.model = next;
}

async function applyProfile(id: string) {
  if (!runtimeStore.serverId) {
    showToast({
      kind: "warn",
      title: t("codexProfiles.codexDisconnectedTitle"),
      message: t("codexProfiles.codexDisconnectedMessage"),
    });
    return;
  }
  errorText.value = "";
  try {
    await runtime.applyCodexProfile(id);
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : String(error);
  }
}

async function duplicateProfile(profile: CodexProviderProfile) {
  const id = uniqueProfileId(`${profile.id}-copy`);
  await profilesStore.upsert({
    ...profile,
    id,
    name: `${profile.name} copy`,
    modelProviderId: uniqueProfileId(`${profile.modelProviderId}-copy`),
    authFilePath: profile.authFilePath,
    configFilePath: profile.configFilePath,
    authFileContent: profile.authFileContent,
    configFileContent: profile.configFileContent,
    order: orderedProfiles.value.length,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestMessage: null,
  });
  showToast({
    kind: "success",
    title: t("codexProfiles.duplicatedTitle"),
    message: t("codexProfiles.duplicatedMessage", { name: profile.name }),
  });
}

async function deleteProfile(profile: CodexProviderProfile) {
  if (!window.confirm(t("codexProfiles.confirmDelete", { name: profile.name }))) return;
  await profilesStore.deleteProfile(profile.id);
  if (selectedProfileId.value === profile.id) closeEditor();
}

async function testProfile(profile: CodexProviderProfile) {
  localSaving.value = true;
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
        ? t("codexProfiles.testSuccessWithSuffix", {
            suffix:
              result.elapsedMs == null
                ? ""
                : t("codexProfiles.latencySuffix", { elapsed: formatProviderLatency(result.elapsedMs) }),
          })
        : result.message,
    });
    const elapsed = formatProviderLatency(result.elapsedMs);
    showToast({
      kind: result.ok ? "success" : "error",
      title: result.ok ? t("codexProfiles.connectionSuccessTitle") : t("codexProfiles.connectionFailedTitle"),
      message: result.ok
        ? elapsed
          ? t("codexProfiles.latencyOnly", { elapsed })
          : t("codexProfiles.connectionSuccessMessage")
        : result.message,
    });
  } finally {
    localSaving.value = false;
  }
}

function showProfileStats(profile: CodexProviderProfile) {
  const tested = profile.lastTestedAt
    ? new Date(profile.lastTestedAt).toLocaleString(locale.value)
    : t("codexProfiles.notTested");
  const statusLabel =
    profile.lastTestStatus === "ok"
      ? t("codexProfiles.statusOk")
      : profile.lastTestStatus === "error"
        ? t("codexProfiles.statusError")
        : profile.lastTestStatus;
  const status = statusLabel
    ? t("codexProfiles.statusWithMessage", { status: statusLabel, message: profile.lastTestMessage ?? "" })
    : t("codexProfiles.noTestResult");
  window.alert(
    t("codexProfiles.statsAlert", {
      name: profile.name,
      model: profile.model,
      tested,
      status,
    })
  );
}

function profileInitial(profile: CodexProviderProfile): string {
  return (profile.name || profile.modelProviderId || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function onDragStart(id: string) {
  draggingProfileId.value = id;
}

function onDragEnd() {
  draggingProfileId.value = "";
}

async function onDrop(targetId: string) {
  const sourceId = draggingProfileId.value;
  draggingProfileId.value = "";
  if (!sourceId || sourceId === targetId) return;
  const list = [...orderedProfiles.value];
  const sourceIndex = list.findIndex((item) => item.id === sourceId);
  const targetIndex = list.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [source] = list.splice(sourceIndex, 1);
  list.splice(targetIndex, 0, source);
  localSaving.value = true;
  try {
    for (let index = 0; index < list.length; index += 1) {
      await profilesStore.upsert({ ...list[index], order: index });
    }
  } finally {
    localSaving.value = false;
  }
}

async function readCodexConfig(): Promise<Record<string, unknown> | null> {
  const serverId = String(runtimeStore.serverId ?? "").trim();
  if (!serverId) return null;
  const cwd = String(runtimeStore.workspacePath ?? "").trim();
  const { result } = await codexDesktop.codexServer.rpc({
    serverId,
    method: "config/read",
    params: { includeLayers: true, ...(cwd ? { cwd } : {}) },
  });
  return importableCodexConfig(result);
}

async function loadDefaultCodexPaths() {
  const auth = await codexDesktop.app.readCodexAuthApiKey().catch(() => null);
  const authPath = String(auth?.path ?? "").trim();
  defaultAuthFilePath.value = authPath || DEFAULT_CODEX_AUTH_FILE_PATH;
  defaultConfigFilePath.value = siblingConfigPath(authPath) || DEFAULT_CODEX_CONFIG_FILE_PATH;
}

async function autoImportCurrentCodexConfig() {
  if (!runtimeStore.serverId) return;
  const config = await readCodexConfig().catch(() => null);
  if (!config) return;
  const providerId = String(config.model_provider ?? "").trim();
  const model = String(config.model ?? "").trim();
  if (!providerId || !model) return;
  const providers = readRecord(config.model_providers);
  const provider = readRecord(providers?.[providerId]);
  const baseUrl = String(provider?.base_url ?? "").trim();
  if (!baseUrl || isCalmnovaRouterProvider(providerId) || isCalmnovaCodexEndpoint(baseUrl)) return;
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
    authFilePath: defaultAuthFilePath.value,
    configFilePath: defaultConfigFilePath.value,
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
    order: orderedProfiles.value.length,
  });
  showToast({
    kind: "success",
    title: t("codexProfiles.importedCurrentConfigTitle"),
    message: `${providerId} / ${model}`,
  });
}

async function refresh() {
  errorText.value = "";
  await profilesStore.refresh();
  await autoImportCurrentCodexConfig();
}

onMounted(() => {
  void loadDefaultCodexPaths().finally(() => refresh());
});

watch(
  () => [form.name, form.providerKind, form.model, form.baseUrl, form.apiKey],
  () => {
    if (!editorOpen.value || fileEditorsDirty.value) return;
    refreshGeneratedFileEditors();
  }
);

watch(
  () => form.providerKind,
  (next) => {
    if (!editorOpen.value) return;
    resetProviderModels();
    if (next === "deepseek-chat") {
      if (!form.baseUrl.trim()) form.baseUrl = DEFAULT_DEEPSEEK_BASE_URL;
      if (!form.model.trim() || form.model === DEFAULT_CODEX_PROFILE_MODEL) form.model = DEFAULT_DEEPSEEK_MODEL;
    }
  }
);

watch(
  () => [form.baseUrl, form.apiKey],
  () => {
    if (!editorOpen.value || providerModelsLoading.value) return;
    providerModelOptions.value = [];
    providerModelsStatusText.value = "";
  }
);
</script>
