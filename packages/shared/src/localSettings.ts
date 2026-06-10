import { normalizeCustomModelIds } from "./modelCatalog";
import { dynamicToolRegistry } from "./dynamicTools";

/**
 * 用户本地设置的共享 schema。
 *
 * 该模块负责把未知持久化内容收敛成稳定设置对象；实际保存位置和读写时机由主进程服务控制。
 */
export type LocalImageGenerationSettings = {
  enabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  defaultSize: string;
  defaultQuality: string;
  outputFormat: string;
  defaultBackground: string;
  defaultModeration: string;
  outputCompression: number;
  timeoutMs: number;
  maxImages: number;
};

export type LocalFlowchartAiSettings = {
  enabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  timeoutMs: number;
};

/** 自定义运行时（脱离 codex-app-server）对接的 provider 协议族。本期只有 openai-compatible 真正可用。 */
export type CustomProviderKind = "openai-compatible" | "anthropic" | "gemini";

/** 单个自定义 provider 的连接信息。apiKey 与 flowchartAi 一样存在本地设置，并由主进程做静态加密。 */
export type LocalCustomProvider = {
  id: string;
  kind: CustomProviderKind;
  name: string;
  baseUrl: string | null;
  apiKey: string | null;
  model: string;
  /** 是否开启思考/推理输出（Claude thinking / Gemini includeThoughts / OpenAI reasoning）。 */
  thinking?: boolean;
  /** 最大输出 tokens（Anthropic max_tokens / Gemini maxOutputTokens / OpenAI max_tokens）；未设或 ≤0 时用各协议默认值。 */
  maxOutputTokens?: number | null;
  /** 历史上下文预算（输入侧最大估算 tokens）；未设或 ≤0 时不裁剪、全量发送历史。 */
  contextLimit?: number | null;
};

/** 自定义 provider 集合与当前激活项。activeProviderId 必须指向仍存在的 provider。 */
export type LocalCustomProvidersSettings = {
  activeProviderId: string | null;
  providers: LocalCustomProvider[];
  /** 自定义运行时的工作区根目录（沙箱）。为 null 时使用系统工具路由，不绑定用户工作区。 */
  workspaceRoot: string | null;
};

export type LocalThreadWorkspaceGroupsCollapsedState = Record<string, boolean>;
export type LocalDynamicToolsSettings = {
  enabledByName: Record<string, boolean>;
};
export type LocalGoalShutdownSetting = {
  enabled: boolean;
  delaySeconds: number;
  objective: string;
  createdAt: number;
};
export type LocalGoalAutomationSettings = {
  shutdownByThreadId: Record<string, LocalGoalShutdownSetting>;
};

export type MainView = "chat" | "image" | "flowchart" | "paper";
/** 应用运行时模式：codex=旧版 codex-app-server；custom=新版自定义 provider；null=尚未选择（显示选择页）。 */
export type RuntimeMode = "codex" | "custom";
export type UiLanguage = "zh-CN" | "en-US";
export type UiFontFamilyPreset = "alibaba-puhuiti" | "source-han-sans-sc";
export type UiFontSizePreset = "small" | "medium" | "large";
export type UiWorkspaceFileIconTheme = "vscode-icons";

/** UI 和主进程共同消费的完整本地设置结构。 */
export type UserLocalSettings = {
  version: 1;
  ui: {
    theme: string | null;
    language: UiLanguage;
    mainView: MainView;
    runtimeMode: RuntimeMode | null;
    leftSidebarVisible: boolean;
    leftSidebarWidthPx: number;
    filesSidebarVisible: boolean;
    filesSidebarWidthPx: number;
    centerEditorWidthPx: number;
    fontFamilyPreset: UiFontFamilyPreset;
    fontSizePreset: UiFontSizePreset;
    workspaceFileIconTheme: UiWorkspaceFileIconTheme;
    threadWorkspaceGroupsCollapsed: LocalThreadWorkspaceGroupsCollapsedState;
    globalConfigAdvancedOpen: boolean;
  };
  notification: {
    selectedSoundId: string | null;
    soundVolumePercent: number;
  };
  models: {
    customIds: string[];
  };
  imageGeneration: LocalImageGenerationSettings;
  flowchartAi: LocalFlowchartAiSettings;
  customProviders: LocalCustomProvidersSettings;
  dynamicTools: LocalDynamicToolsSettings;
  goalAutomation: LocalGoalAutomationSettings;
  developer: {
    debugLogEnabled: boolean;
  };
};

/**
 * 局部设置补丁。
 *
 * undefined 表示不修改；部分字段允许 null，代表清空或回落到对应默认值。
 */
export type UserLocalSettingsPatch = {
  ui?: Partial<{
    theme: string | null;
    language: UiLanguage | null;
    mainView: MainView;
    runtimeMode: RuntimeMode | null;
    leftSidebarVisible: boolean;
    leftSidebarWidthPx: number | null;
    filesSidebarVisible: boolean;
    filesSidebarWidthPx: number | null;
    centerEditorWidthPx: number | null;
    fontFamilyPreset: UiFontFamilyPreset | null;
    fontSizePreset: UiFontSizePreset | null;
    workspaceFileIconTheme: UiWorkspaceFileIconTheme | null;
    threadWorkspaceGroupsCollapsed: Record<string, boolean> | null;
    globalConfigAdvancedOpen: boolean;
  }>;
  notification?: Partial<{
    selectedSoundId: string | null;
    soundVolumePercent: number | null;
  }>;
  models?: Partial<{
    customIds: string[] | null;
  }>;
  imageGeneration?: Partial<{
    enabled: boolean;
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
    defaultSize: string | null;
    defaultQuality: string | null;
    outputFormat: string | null;
    defaultBackground: string | null;
    defaultModeration: string | null;
    outputCompression: number | null;
    timeoutMs: number | null;
    maxImages: number | null;
  }>;
  flowchartAi?: Partial<{
    enabled: boolean;
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
    timeoutMs: number | null;
  }>;
  customProviders?: Partial<{
    activeProviderId: string | null;
    providers: LocalCustomProvider[];
    workspaceRoot: string | null;
  }>;
  dynamicTools?: Partial<{
    enabledByName: Partial<Record<string, boolean>> | null;
  }>;
  goalAutomation?: Partial<{
    shutdownByThreadId: Record<
      string,
      Partial<LocalGoalShutdownSetting> | null
    > | null;
  }>;
  developer?: Partial<{
    debugLogEnabled: boolean;
  }>;
};

export const DEFAULT_NOTIFICATION_SOUND_VOLUME_PERCENT = 70;
export const DEFAULT_IMAGE_GENERATION_MODEL = "gpt-image-2";
export const DEFAULT_IMAGE_GENERATION_SIZE = "1024x1024";
export const DEFAULT_IMAGE_GENERATION_QUALITY = "auto";
export const DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT = "png";
export const DEFAULT_IMAGE_GENERATION_BACKGROUND = "auto";
export const DEFAULT_IMAGE_GENERATION_MODERATION = "auto";
export const DEFAULT_IMAGE_GENERATION_OUTPUT_COMPRESSION = 100;
export const MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION = 0;
export const MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION = 100;
export const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 120_000;
export const MIN_IMAGE_GENERATION_TIMEOUT_MS = 10_000;
export const MAX_IMAGE_GENERATION_TIMEOUT_MS = 600_000;
export const DEFAULT_IMAGE_GENERATION_MAX_IMAGES = 1;
export const MIN_IMAGE_GENERATION_MAX_IMAGES = 1;
export const MAX_IMAGE_GENERATION_MAX_IMAGES = 4;
export const DEFAULT_FLOWCHART_AI_MODEL = "gpt-4o-mini";
export const DEFAULT_FLOWCHART_AI_TIMEOUT_MS = 60_000;
export const MIN_FLOWCHART_AI_TIMEOUT_MS = 10_000;
export const MAX_FLOWCHART_AI_TIMEOUT_MS = 300_000;
export const DEFAULT_GOAL_SHUTDOWN_DELAY_SECONDS = 60;
export const MIN_GOAL_SHUTDOWN_DELAY_SECONDS = 10;
export const MAX_GOAL_SHUTDOWN_DELAY_SECONDS = 600;
export const DEFAULT_UI_LANGUAGE: UiLanguage = "zh-CN";
export const DEFAULT_UI_FONT_FAMILY_PRESET: UiFontFamilyPreset =
  "alibaba-puhuiti";
export const DEFAULT_UI_FONT_SIZE_PRESET: UiFontSizePreset = "medium";
export const DEFAULT_UI_WORKSPACE_FILE_ICON_THEME: UiWorkspaceFileIconTheme =
  "vscode-icons";
const UI_FONT_SIZE_ZOOM_FACTORS: Record<UiFontSizePreset, number> = {
  small: 0.92,
  medium: 1,
  large: 1.08,
};

function buildDefaultDynamicToolsEnabledByName(): Record<string, boolean> {
  return dynamicToolRegistry.buildDefaultEnabledByName();
}

function normalizeUiFontFamilyPreset(value: unknown): UiFontFamilyPreset {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "source-han-sans-sc") return "source-han-sans-sc";
  if (raw === "alibaba-puhuiti") return "alibaba-puhuiti";
  return DEFAULT_UI_FONT_FAMILY_PRESET;
}

export function normalizeUiLanguage(value: unknown): UiLanguage {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace("_", "-");
  if (raw === "en" || raw === "en-us") return "en-US";
  if (
    raw === "zh" ||
    raw === "zh-cn" ||
    raw === "zh-hans" ||
    raw === "zh-hans-cn"
  )
    return "zh-CN";
  return DEFAULT_UI_LANGUAGE;
}

function normalizeUiFontSizePreset(value: unknown): UiFontSizePreset {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "small") return "small";
  if (raw === "large") return "large";
  return DEFAULT_UI_FONT_SIZE_PRESET;
}

export function normalizeUiWorkspaceFileIconTheme(
  _value: unknown,
): UiWorkspaceFileIconTheme {
  return DEFAULT_UI_WORKSPACE_FILE_ICON_THEME;
}

export function resolveUiFontSizeZoomFactor(value: UiFontSizePreset): number {
  return (
    UI_FONT_SIZE_ZOOM_FACTORS[value] ??
    UI_FONT_SIZE_ZOOM_FACTORS[DEFAULT_UI_FONT_SIZE_PRESET]
  );
}

/**
 * 本地设置的唯一默认基线。
 *
 * 所有读取和补丁合并最终都会回到这份基线，避免新增字段后旧配置出现 undefined。
 */
export const DEFAULT_USER_LOCAL_SETTINGS: UserLocalSettings = {
  version: 1,
  ui: {
    theme: null,
    language: DEFAULT_UI_LANGUAGE,
    mainView: "chat",
    runtimeMode: null,
    leftSidebarVisible: true,
    leftSidebarWidthPx: 320,
    filesSidebarVisible: true,
    filesSidebarWidthPx: 300,
    centerEditorWidthPx: 460,
    fontFamilyPreset: DEFAULT_UI_FONT_FAMILY_PRESET,
    fontSizePreset: DEFAULT_UI_FONT_SIZE_PRESET,
    workspaceFileIconTheme: DEFAULT_UI_WORKSPACE_FILE_ICON_THEME,
    threadWorkspaceGroupsCollapsed: {},
    globalConfigAdvancedOpen: false,
  },
  notification: {
    selectedSoundId: null,
    soundVolumePercent: DEFAULT_NOTIFICATION_SOUND_VOLUME_PERCENT,
  },
  models: {
    customIds: [],
  },
  imageGeneration: {
    enabled: false,
    baseUrl: null,
    apiKey: null,
    model: DEFAULT_IMAGE_GENERATION_MODEL,
    defaultSize: DEFAULT_IMAGE_GENERATION_SIZE,
    defaultQuality: DEFAULT_IMAGE_GENERATION_QUALITY,
    outputFormat: DEFAULT_IMAGE_GENERATION_OUTPUT_FORMAT,
    defaultBackground: DEFAULT_IMAGE_GENERATION_BACKGROUND,
    defaultModeration: DEFAULT_IMAGE_GENERATION_MODERATION,
    outputCompression: DEFAULT_IMAGE_GENERATION_OUTPUT_COMPRESSION,
    timeoutMs: DEFAULT_IMAGE_GENERATION_TIMEOUT_MS,
    maxImages: DEFAULT_IMAGE_GENERATION_MAX_IMAGES,
  },
  flowchartAi: {
    enabled: false,
    baseUrl: null,
    apiKey: null,
    model: DEFAULT_FLOWCHART_AI_MODEL,
    timeoutMs: DEFAULT_FLOWCHART_AI_TIMEOUT_MS,
  },
  customProviders: {
    activeProviderId: null,
    providers: [],
    workspaceRoot: null,
  },
  dynamicTools: {
    enabledByName: buildDefaultDynamicToolsEnabledByName(),
  },
  goalAutomation: {
    shutdownByThreadId: {},
  },
  developer: {
    debugLogEnabled: false,
  },
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toNullableString(
  value: unknown,
  fallback: string | null,
): string | null {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || null;
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : fallback;
}

/** 可选正整数：null/缺省/非法/≤0 → null（表示「未设置」），否则取四舍五入后的正整数。 */
function toNullablePositiveInteger(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

function toIntegerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function toNonEmptyString(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/** 只接受带 http/https scheme 的服务地址，非法值会回退而不是写入脏配置。 */
function normalizeHttpBaseUrl(
  value: unknown,
  fallback: string | null,
): string | null {
  const text = toNullableString(value, fallback);
  if (!text) return null;
  const normalized = text.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) return fallback;
  return normalized;
}

function normalizeMainView(value: unknown, fallback: MainView): MainView {
  if (value === "flowchart") return "flowchart";
  if (value === "image") return "image";
  if (value === "paper") return "paper";
  if (value === "chat") return "chat";
  return fallback;
}

/** 运行时模式只接受 codex/custom；其余（含 undefined）一律视为「未选择」→ null，触发启动选择页。 */
export function normalizeRuntimeMode(value: unknown): RuntimeMode | null {
  if (value === "codex") return "codex";
  if (value === "custom") return "custom";
  return null;
}

function normalizeCustomProviderKind(value: unknown): CustomProviderKind {
  if (value === "anthropic") return "anthropic";
  if (value === "gemini") return "gemini";
  return "openai-compatible";
}

/** 单个 provider 必须带稳定 id，否则丢弃；baseUrl 走统一的 http(s) 校验，非法回落 null。 */
function normalizeCustomProvider(value: unknown): LocalCustomProvider | null {
  const record = toRecord(value);
  if (!record) return null;
  const id = String(record.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    kind: normalizeCustomProviderKind(record.kind),
    name: toNonEmptyString(record.name, id),
    baseUrl: normalizeHttpBaseUrl(record.baseUrl, null),
    apiKey: toNullableString(record.apiKey, null),
    model: String(record.model ?? "").trim(),
    thinking: toBoolean(record.thinking, false),
    maxOutputTokens: toNullablePositiveInteger(record.maxOutputTokens),
    contextLimit: toNullablePositiveInteger(record.contextLimit),
  };
}

/** provider 列表按 id 去重，并保证 activeProviderId 指向仍存在的 provider。 */
function normalizeCustomProvidersSettings(
  value: unknown,
): LocalCustomProvidersSettings {
  const record = toRecord(value);
  const rawProviders = Array.isArray(record?.providers) ? record.providers : [];
  const byId = new Map<string, LocalCustomProvider>();
  for (const item of rawProviders) {
    const provider = normalizeCustomProvider(item);
    if (provider) byId.set(provider.id, provider);
  }
  const providers = [...byId.values()];
  const activeRaw = String(record?.activeProviderId ?? "").trim();
  const activeProviderId =
    activeRaw && providers.some((item) => item.id === activeRaw)
      ? activeRaw
      : null;
  const workspaceRoot = String(record?.workspaceRoot ?? "").trim() || null;
  return { activeProviderId, providers, workspaceRoot };
}

/** 图片生成设置会限制压缩率、超时和张数，避免 UI 写入超出服务端预期的值。 */
function normalizeImageGenerationSettings(
  value: unknown,
): LocalImageGenerationSettings {
  const record = toRecord(value);
  return {
    enabled: toBoolean(
      record?.enabled,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.enabled,
    ),
    baseUrl: normalizeHttpBaseUrl(
      record?.baseUrl,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.baseUrl,
    ),
    apiKey: toNullableString(
      record?.apiKey,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.apiKey,
    ),
    model: toNonEmptyString(
      record?.model,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.model,
    ),
    defaultSize: toNonEmptyString(
      record?.defaultSize,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.defaultSize,
    ),
    defaultQuality: toNonEmptyString(
      record?.defaultQuality,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.defaultQuality,
    ),
    outputFormat: toNonEmptyString(
      record?.outputFormat,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.outputFormat,
    ),
    defaultBackground: toNonEmptyString(
      record?.defaultBackground,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.defaultBackground,
    ),
    defaultModeration: toNonEmptyString(
      record?.defaultModeration,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.defaultModeration,
    ),
    outputCompression: toIntegerInRange(
      record?.outputCompression,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.outputCompression,
      MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION,
      MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION,
    ),
    timeoutMs: toIntegerInRange(
      record?.timeoutMs,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.timeoutMs,
      MIN_IMAGE_GENERATION_TIMEOUT_MS,
      MAX_IMAGE_GENERATION_TIMEOUT_MS,
    ),
    maxImages: toIntegerInRange(
      record?.maxImages,
      DEFAULT_USER_LOCAL_SETTINGS.imageGeneration.maxImages,
      MIN_IMAGE_GENERATION_MAX_IMAGES,
      MAX_IMAGE_GENERATION_MAX_IMAGES,
    ),
  };
}

function normalizeFlowchartAiSettings(
  value: unknown,
): LocalFlowchartAiSettings {
  const record = toRecord(value);
  return {
    enabled: toBoolean(
      record?.enabled,
      DEFAULT_USER_LOCAL_SETTINGS.flowchartAi.enabled,
    ),
    baseUrl: normalizeHttpBaseUrl(
      record?.baseUrl,
      DEFAULT_USER_LOCAL_SETTINGS.flowchartAi.baseUrl,
    ),
    apiKey: toNullableString(
      record?.apiKey,
      DEFAULT_USER_LOCAL_SETTINGS.flowchartAi.apiKey,
    ),
    model: toNonEmptyString(
      record?.model,
      DEFAULT_USER_LOCAL_SETTINGS.flowchartAi.model,
    ),
    timeoutMs: toIntegerInRange(
      record?.timeoutMs,
      DEFAULT_USER_LOCAL_SETTINGS.flowchartAi.timeoutMs,
      MIN_FLOWCHART_AI_TIMEOUT_MS,
      MAX_FLOWCHART_AI_TIMEOUT_MS,
    ),
  };
}

/** 动态工具设置只接受已登记的内置工具名，避免未知工具被持久化后误注入会话。 */
function normalizeDynamicToolsSettings(
  value: unknown,
): LocalDynamicToolsSettings {
  const record = toRecord(value);
  const enabledRecord = toRecord(record?.enabledByName);
  const enabledByName = buildDefaultDynamicToolsEnabledByName();
  for (const [rawName, rawEnabled] of Object.entries(enabledRecord ?? {})) {
    const name = String(rawName ?? "").trim();
    if (
      !name ||
      !dynamicToolRegistry.isKnownToolName(name) ||
      typeof rawEnabled !== "boolean"
    )
      continue;
    enabledByName[name] = rawEnabled;
  }
  return { enabledByName };
}

function mergeDynamicToolsEnabledByName(
  current: Record<string, boolean>,
  patchValue: unknown,
): Record<string, boolean> {
  const patchRecord = toRecord(patchValue);
  const next = { ...current };
  for (const [rawName, rawEnabled] of Object.entries(patchRecord ?? {})) {
    const name = String(rawName ?? "").trim();
    if (
      !name ||
      !dynamicToolRegistry.isKnownToolName(name) ||
      typeof rawEnabled !== "boolean"
    )
      continue;
    next[name] = rawEnabled;
  }
  return next;
}

function normalizeThreadWorkspaceGroupsCollapsedState(
  value: unknown,
): LocalThreadWorkspaceGroupsCollapsedState {
  const record = toRecord(value);
  const normalized: LocalThreadWorkspaceGroupsCollapsedState = {};
  for (const [rawKey, rawValue] of Object.entries(record ?? {})) {
    const key = String(rawKey ?? "").trim();
    if (!key || rawValue !== true) continue;
    normalized[key] = true;
  }
  return normalized;
}

/** 目标关闭规则必须带 objective 和 createdAt，避免空规则被后台任务误执行。 */
function normalizeGoalShutdownSetting(
  value: unknown,
): LocalGoalShutdownSetting | null {
  const record = toRecord(value);
  if (!record) return null;
  const objective = String(record.objective ?? "").trim();
  const createdAt = toIntegerInRange(
    record.createdAt,
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (!objective || createdAt <= 0) return null;
  return {
    enabled: toBoolean(record.enabled, false),
    delaySeconds: toIntegerInRange(
      record.delaySeconds,
      DEFAULT_GOAL_SHUTDOWN_DELAY_SECONDS,
      MIN_GOAL_SHUTDOWN_DELAY_SECONDS,
      MAX_GOAL_SHUTDOWN_DELAY_SECONDS,
    ),
    objective,
    createdAt,
  };
}

function normalizeGoalAutomationSettings(
  value: unknown,
): LocalGoalAutomationSettings {
  const record = toRecord(value);
  const rawByThread = toRecord(record?.shutdownByThreadId);
  const shutdownByThreadId: Record<string, LocalGoalShutdownSetting> = {};
  for (const [rawThreadId, rawSetting] of Object.entries(rawByThread ?? {})) {
    const threadId = String(rawThreadId ?? "").trim();
    if (!threadId) continue;
    const setting = normalizeGoalShutdownSetting(rawSetting);
    if (setting) shutdownByThreadId[threadId] = setting;
  }
  return { shutdownByThreadId };
}

function mergeGoalShutdownByThreadId(
  current: Record<string, LocalGoalShutdownSetting>,
  patchValue: unknown,
): Record<string, LocalGoalShutdownSetting> {
  const patchRecord = toRecord(patchValue);
  const next = { ...current };
  for (const [rawThreadId, rawSetting] of Object.entries(patchRecord ?? {})) {
    const threadId = String(rawThreadId ?? "").trim();
    if (!threadId) continue;
    if (rawSetting === null) {
      delete next[threadId];
      continue;
    }
    const setting = normalizeGoalShutdownSetting(rawSetting);
    if (setting) next[threadId] = setting;
    else delete next[threadId];
  }
  return next;
}

/**
 * 从任意持久化内容恢复完整设置。
 *
 * 该函数是本地设置读取入口，负责丢弃未知结构、补齐默认值，并把数值限制在 UI/服务可接受范围内。
 */
export function normalizeUserLocalSettings(value: unknown): UserLocalSettings {
  const root = toRecord(value);
  const ui = toRecord(root?.ui);
  const notification = toRecord(root?.notification);
  const models = toRecord(root?.models);
  const imageGeneration = toRecord(root?.imageGeneration);
  const flowchartAi = toRecord(root?.flowchartAi);
  const customProviders = toRecord(root?.customProviders);
  const dynamicTools = toRecord(root?.dynamicTools);
  const goalAutomation = toRecord(root?.goalAutomation);
  const developer = toRecord(root?.developer);
  const inferredMainViewFallback: MainView =
    DEFAULT_USER_LOCAL_SETTINGS.ui.mainView;

  return {
    version: 1,
    ui: {
      theme: toNullableString(ui?.theme, DEFAULT_USER_LOCAL_SETTINGS.ui.theme),
      language: normalizeUiLanguage(ui?.language),
      mainView: normalizeMainView(ui?.mainView, inferredMainViewFallback),
      runtimeMode: normalizeRuntimeMode(ui?.runtimeMode),
      leftSidebarVisible: toBoolean(
        ui?.leftSidebarVisible,
        DEFAULT_USER_LOCAL_SETTINGS.ui.leftSidebarVisible,
      ),
      leftSidebarWidthPx: toPositiveInteger(
        ui?.leftSidebarWidthPx,
        DEFAULT_USER_LOCAL_SETTINGS.ui.leftSidebarWidthPx,
      ),
      filesSidebarVisible: toBoolean(
        ui?.filesSidebarVisible,
        DEFAULT_USER_LOCAL_SETTINGS.ui.filesSidebarVisible,
      ),
      filesSidebarWidthPx: toPositiveInteger(
        ui?.filesSidebarWidthPx,
        DEFAULT_USER_LOCAL_SETTINGS.ui.filesSidebarWidthPx,
      ),
      centerEditorWidthPx: toPositiveInteger(
        ui?.centerEditorWidthPx,
        DEFAULT_USER_LOCAL_SETTINGS.ui.centerEditorWidthPx,
      ),
      fontFamilyPreset: normalizeUiFontFamilyPreset(ui?.fontFamilyPreset),
      fontSizePreset: normalizeUiFontSizePreset(ui?.fontSizePreset),
      workspaceFileIconTheme: normalizeUiWorkspaceFileIconTheme(
        ui?.workspaceFileIconTheme,
      ),
      threadWorkspaceGroupsCollapsed:
        normalizeThreadWorkspaceGroupsCollapsedState(
          ui?.threadWorkspaceGroupsCollapsed,
        ),
      globalConfigAdvancedOpen: toBoolean(
        ui?.globalConfigAdvancedOpen,
        DEFAULT_USER_LOCAL_SETTINGS.ui.globalConfigAdvancedOpen,
      ),
    },
    notification: {
      selectedSoundId: toNullableString(
        notification?.selectedSoundId,
        DEFAULT_USER_LOCAL_SETTINGS.notification.selectedSoundId,
      ),
      soundVolumePercent: toIntegerInRange(
        notification?.soundVolumePercent,
        DEFAULT_USER_LOCAL_SETTINGS.notification.soundVolumePercent,
        0,
        100,
      ),
    },
    models: {
      customIds: normalizeCustomModelIds(models?.customIds),
    },
    imageGeneration: normalizeImageGenerationSettings(imageGeneration),
    flowchartAi: normalizeFlowchartAiSettings(flowchartAi),
    customProviders: normalizeCustomProvidersSettings(customProviders),
    dynamicTools: normalizeDynamicToolsSettings(dynamicTools),
    goalAutomation: normalizeGoalAutomationSettings(goalAutomation),
    developer: {
      debugLogEnabled: toBoolean(
        developer?.debugLogEnabled,
        DEFAULT_USER_LOCAL_SETTINGS.developer.debugLogEnabled,
      ),
    },
  };
}

/**
 * 将局部 patch 合并到当前设置。
 *
 * 只处理 patch 中显式出现的字段，合并后再统一归一化，确保调用侧无法绕过默认值和范围限制。
 */
export function mergeUserLocalSettings(
  base: unknown,
  patch: UserLocalSettingsPatch | null | undefined,
): UserLocalSettings {
  const current = normalizeUserLocalSettings(base);
  const patchUi = toRecord(patch?.ui);
  const patchNotification = toRecord(patch?.notification);
  const patchModels = toRecord(patch?.models);
  const patchImageGeneration = toRecord(patch?.imageGeneration);
  const patchFlowchartAi = toRecord(patch?.flowchartAi);
  const patchCustomProviders = toRecord(patch?.customProviders);
  const patchDynamicTools = toRecord(patch?.dynamicTools);
  const patchGoalAutomation = toRecord(patch?.goalAutomation);
  const patchDeveloper = toRecord(patch?.developer);

  return normalizeUserLocalSettings({
    version: 1,
    ui: {
      theme: patchUi && "theme" in patchUi ? patchUi.theme : current.ui.theme,
      language:
        patchUi && "language" in patchUi
          ? patchUi.language
          : current.ui.language,
      mainView:
        patchUi && "mainView" in patchUi
          ? patchUi.mainView
          : current.ui.mainView,
      runtimeMode:
        patchUi && "runtimeMode" in patchUi
          ? patchUi.runtimeMode
          : current.ui.runtimeMode,
      leftSidebarVisible:
        patchUi && "leftSidebarVisible" in patchUi
          ? patchUi.leftSidebarVisible
          : current.ui.leftSidebarVisible,
      leftSidebarWidthPx:
        patchUi && "leftSidebarWidthPx" in patchUi
          ? patchUi.leftSidebarWidthPx
          : current.ui.leftSidebarWidthPx,
      filesSidebarVisible:
        patchUi && "filesSidebarVisible" in patchUi
          ? patchUi.filesSidebarVisible
          : current.ui.filesSidebarVisible,
      filesSidebarWidthPx:
        patchUi && "filesSidebarWidthPx" in patchUi
          ? patchUi.filesSidebarWidthPx
          : current.ui.filesSidebarWidthPx,
      centerEditorWidthPx:
        patchUi && "centerEditorWidthPx" in patchUi
          ? patchUi.centerEditorWidthPx
          : current.ui.centerEditorWidthPx,
      fontFamilyPreset:
        patchUi && "fontFamilyPreset" in patchUi
          ? patchUi.fontFamilyPreset
          : current.ui.fontFamilyPreset,
      fontSizePreset:
        patchUi && "fontSizePreset" in patchUi
          ? patchUi.fontSizePreset
          : current.ui.fontSizePreset,
      workspaceFileIconTheme:
        patchUi && "workspaceFileIconTheme" in patchUi
          ? patchUi.workspaceFileIconTheme
          : current.ui.workspaceFileIconTheme,
      threadWorkspaceGroupsCollapsed:
        patchUi && "threadWorkspaceGroupsCollapsed" in patchUi
          ? patchUi.threadWorkspaceGroupsCollapsed
          : current.ui.threadWorkspaceGroupsCollapsed,
      globalConfigAdvancedOpen:
        patchUi && "globalConfigAdvancedOpen" in patchUi
          ? patchUi.globalConfigAdvancedOpen
          : current.ui.globalConfigAdvancedOpen,
    },
    notification: {
      selectedSoundId:
        patchNotification && "selectedSoundId" in patchNotification
          ? patchNotification.selectedSoundId
          : current.notification.selectedSoundId,
      soundVolumePercent:
        patchNotification && "soundVolumePercent" in patchNotification
          ? patchNotification.soundVolumePercent
          : current.notification.soundVolumePercent,
    },
    models: {
      customIds:
        patchModels && "customIds" in patchModels
          ? patchModels.customIds
          : current.models.customIds,
    },
    imageGeneration: {
      enabled:
        patchImageGeneration && "enabled" in patchImageGeneration
          ? patchImageGeneration.enabled
          : current.imageGeneration.enabled,
      baseUrl:
        patchImageGeneration && "baseUrl" in patchImageGeneration
          ? patchImageGeneration.baseUrl
          : current.imageGeneration.baseUrl,
      apiKey:
        patchImageGeneration && "apiKey" in patchImageGeneration
          ? patchImageGeneration.apiKey
          : current.imageGeneration.apiKey,
      model:
        patchImageGeneration && "model" in patchImageGeneration
          ? patchImageGeneration.model
          : current.imageGeneration.model,
      defaultSize:
        patchImageGeneration && "defaultSize" in patchImageGeneration
          ? patchImageGeneration.defaultSize
          : current.imageGeneration.defaultSize,
      defaultQuality:
        patchImageGeneration && "defaultQuality" in patchImageGeneration
          ? patchImageGeneration.defaultQuality
          : current.imageGeneration.defaultQuality,
      outputFormat:
        patchImageGeneration && "outputFormat" in patchImageGeneration
          ? patchImageGeneration.outputFormat
          : current.imageGeneration.outputFormat,
      defaultBackground:
        patchImageGeneration && "defaultBackground" in patchImageGeneration
          ? patchImageGeneration.defaultBackground
          : current.imageGeneration.defaultBackground,
      defaultModeration:
        patchImageGeneration && "defaultModeration" in patchImageGeneration
          ? patchImageGeneration.defaultModeration
          : current.imageGeneration.defaultModeration,
      outputCompression:
        patchImageGeneration && "outputCompression" in patchImageGeneration
          ? patchImageGeneration.outputCompression
          : current.imageGeneration.outputCompression,
      timeoutMs:
        patchImageGeneration && "timeoutMs" in patchImageGeneration
          ? patchImageGeneration.timeoutMs
          : current.imageGeneration.timeoutMs,
      maxImages:
        patchImageGeneration && "maxImages" in patchImageGeneration
          ? patchImageGeneration.maxImages
          : current.imageGeneration.maxImages,
    },
    flowchartAi: {
      enabled:
        patchFlowchartAi && "enabled" in patchFlowchartAi
          ? patchFlowchartAi.enabled
          : current.flowchartAi.enabled,
      baseUrl:
        patchFlowchartAi && "baseUrl" in patchFlowchartAi
          ? patchFlowchartAi.baseUrl
          : current.flowchartAi.baseUrl,
      apiKey:
        patchFlowchartAi && "apiKey" in patchFlowchartAi
          ? patchFlowchartAi.apiKey
          : current.flowchartAi.apiKey,
      model:
        patchFlowchartAi && "model" in patchFlowchartAi
          ? patchFlowchartAi.model
          : current.flowchartAi.model,
      timeoutMs:
        patchFlowchartAi && "timeoutMs" in patchFlowchartAi
          ? patchFlowchartAi.timeoutMs
          : current.flowchartAi.timeoutMs,
    },
    customProviders: {
      activeProviderId:
        patchCustomProviders && "activeProviderId" in patchCustomProviders
          ? patchCustomProviders.activeProviderId
          : current.customProviders.activeProviderId,
      providers:
        patchCustomProviders && "providers" in patchCustomProviders
          ? patchCustomProviders.providers
          : current.customProviders.providers,
      workspaceRoot:
        patchCustomProviders && "workspaceRoot" in patchCustomProviders
          ? patchCustomProviders.workspaceRoot
          : current.customProviders.workspaceRoot,
    },
    dynamicTools: {
      enabledByName:
        patchDynamicTools && "enabledByName" in patchDynamicTools
          ? mergeDynamicToolsEnabledByName(
              current.dynamicTools.enabledByName,
              patchDynamicTools.enabledByName,
            )
          : current.dynamicTools.enabledByName,
    },
    goalAutomation: {
      shutdownByThreadId:
        patchGoalAutomation && "shutdownByThreadId" in patchGoalAutomation
          ? mergeGoalShutdownByThreadId(
              current.goalAutomation.shutdownByThreadId,
              patchGoalAutomation.shutdownByThreadId,
            )
          : current.goalAutomation.shutdownByThreadId,
    },
    developer: {
      debugLogEnabled:
        patchDeveloper && "debugLogEnabled" in patchDeveloper
          ? patchDeveloper.debugLogEnabled
          : current.developer.debugLogEnabled,
    },
  });
}
