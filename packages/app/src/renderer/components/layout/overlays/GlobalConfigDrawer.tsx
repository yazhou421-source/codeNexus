import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MODEL_NAME, buildModelPickerOptions, normalizeModelId } from "@codenexus/shared/modelCatalog";
import type { ApprovalsReviewer } from "@codenexus/generated/codex-app-server/v2/ApprovalsReviewer";
import type { AskForApproval } from "@codenexus/generated/codex-app-server/v2/AskForApproval";
import type { SandboxMode } from "@codenexus/generated/codex-app-server/v2/SandboxMode";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import {
  OFFICIAL_APPROVALS_REVIEWER_OPTIONS,
  OFFICIAL_APPROVAL_POLICY_OPTIONS,
  OFFICIAL_REASONING_EFFORT_OPTIONS,
  OFFICIAL_REASONING_SUMMARY_OPTIONS,
  OFFICIAL_SANDBOX_MODE_OPTIONS,
  createDefaultGranularApprovalPolicy,
  isGranularApprovalPolicy,
  normalizeApprovalPolicy,
} from "../../../domain/serverInterop";
import type { GlobalConfigDraft } from "../../../domain/types";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useConfigRequirementsStore } from "../../../stores/configRequirements.store";
import { useConfigStore } from "../../../stores/config.store";
import { useModelCatalogStore } from "../../../stores/modelCatalog.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import {
  UI_FONT_FAMILY_PRESET_OPTIONS,
  UI_FONT_SIZE_PRESET_OPTIONS,
  useTypographyStore,
} from "../../../stores/typography.store";
import { showToast } from "../../../ui/toast";
import SelectDropdown from "../../ui/SelectDropdown";

type GlobalConfigDrawerProps = {
  mode?: "drawer" | "settings";
  className?: string;
};

type SelectOption = { value: string; label: string; disabled?: boolean };
type RestrictedSelectState = {
  hasRestrictions: boolean;
  values: string[] | null;
  hasUnsupported: boolean;
};
type GranularApprovalPolicy = Extract<AskForApproval, { granular: unknown }>;
type GranularApprovalFlag = keyof GranularApprovalPolicy["granular"];
type PendingAction = "close" | "refresh" | "discard";

const TYPOGRAPHY_LABELS: Record<string, string> = {
  "globalConfig.fontFamilyAlibaba": "系统界面字体",
  "globalConfig.fontFamilySourceHan": "系统中文字体",
  "globalConfig.fontSizeSmall": "小",
  "globalConfig.fontSizeMedium": "中",
  "globalConfig.fontSizeLarge": "大",
};
const PENDING_TITLES: Record<PendingAction, string> = {
  close: "关闭前保存修改？",
  refresh: "刷新前保存修改？",
  discard: "放弃未保存修改？",
};
const PENDING_MESSAGES: Record<PendingAction, string> = {
  close: "当前主配置有未保存修改。",
  refresh: "刷新会覆盖当前主配置草稿。",
  discard: "主配置需要手动保存。",
};
const CONTEXT_WINDOW_PRESET_400K = 400000;
const AUTO_COMPACT_TOKEN_LIMIT_PRESET_400K = 360000;
const GLOBAL_CONFIG_DIRTY_KEYS: Array<keyof GlobalConfigDraft> = [
  "model",
  "fastModeEnabled",
  "modelContextWindow",
  "modelAutoCompactTokenLimit",
  "modelReasoningEffort",
  "modelReasoningSummary",
  "approvalPolicy",
  "approvalsReviewer",
  "sandboxMode",
  "windowsElevatedSandboxEnabled",
  "unifiedExecEnabled",
  "applyPatchStreamingEventsEnabled",
];

function normalizeOptionalPositiveIntegerInput(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const rounded = Math.round(value);
    return rounded > 0 ? rounded : null;
  }
  const digits = String(value ?? "")
    .replace(/\D+/g, "")
    .trim();
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatOptionalPositiveIntegerInput(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) || value <= 0 ? "" : String(Math.round(value));
}

function toApprovalPolicyOptionValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isGranularApprovalPolicy(value)) return "granular";
  return null;
}

function buildRestrictedSelectState(
  allowedRaw: readonly (string | null | undefined)[] | null | undefined,
  officialOptions: readonly string[]
): RestrictedSelectState {
  if (!Array.isArray(allowedRaw)) return { hasRestrictions: false, values: null, hasUnsupported: false };
  const allowed = allowedRaw.flatMap((value) => {
    const text = String(value ?? "").trim();
    return text ? [text] : [];
  });
  const officialSet = new Set(officialOptions);
  const values = allowed.filter((value) => officialSet.has(value));
  return {
    hasRestrictions: true,
    values: Array.from(new Set(values)),
    hasUnsupported: allowed.some((value) => !officialSet.has(value)),
  };
}

function formatRestrictedValues(values: readonly string[] | null | undefined, labels?: Record<string, string>): string {
  return (values ?? []).map((value) => labels?.[value] ?? value).join(", ");
}

function buildRestrictedSelectOptions(
  currentValue: string,
  officialOptions: readonly string[],
  restriction: RestrictedSelectState,
  labels?: Record<string, string>
): SelectOption[] {
  const options: SelectOption[] = [];
  const effectiveValues = restriction.values ?? [...officialOptions];
  const seen = new Set<string>();
  const labelFor = (value: string) => labels?.[value] ?? value;

  if (currentValue && !effectiveValues.includes(currentValue)) {
    options.push({
      value: currentValue,
      label: `${labelFor(currentValue)}（当前值）`,
      disabled: true,
    });
    seen.add(currentValue);
  }

  for (const value of effectiveValues) {
    if (seen.has(value)) continue;
    options.push({ value, label: labelFor(value) });
    seen.add(value);
  }
  return options;
}

function buildRestrictedHintText(restriction: RestrictedSelectState, labels?: Record<string, string>): string {
  if (!restriction.hasRestrictions) return "";
  if (!restriction.values || restriction.values.length === 0) {
    return restriction.hasUnsupported
      ? "当前服务端 requirements 仅返回桌面端暂未映射的限制项。"
      : "当前服务端 requirements 未允许可选项。";
  }
  const allowedText = formatRestrictedValues(restriction.values, labels);
  return restriction.hasUnsupported
    ? `当前服务端仅允许：${allowedText}；其余限制项桌面端暂未映射。`
    : `当前服务端仅允许：${allowedText}`;
}

function ToggleRow({
  title,
  note,
  checked,
  disabled,
  dirty,
  onChange,
}: {
  title: string;
  note: string;
  checked: boolean;
  disabled: boolean;
  dirty?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`global-toggle-row${dirty ? " is-dirty" : ""}`}>
      <div className="global-toggle-copy">
        <span className="global-toggle-title">{title}</span>
        <span className="global-toggle-note mono">{note}</span>
      </div>
      <span className="skill-switch">
        <input
          className="skill-switch-input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span className="skill-switch-track" aria-hidden="true">
          <span className="skill-switch-thumb" />
        </span>
      </span>
    </label>
  );
}

export default function GlobalConfigDrawer({ mode = "drawer", className }: GlobalConfigDrawerProps) {
  const runtime = getRuntimeOrchestrator();
  const appShellStore = useAppShellStore();
  const runtimeStore = useRuntimeStore();
  const configStore = useConfigStore();
  const configRequirementsStore = useConfigRequirementsStore();
  const typographyStore = useTypographyStore();
  const modelCatalogStore = useModelCatalogStore();
  const [actionPending, setActionPending] = useState(false);
  const isSettings = mode === "settings";
  const open = isSettings || appShellStore.globalConfigDrawerOpen;

  useEffect(() => {
    if (open && runtimeStore.serverId && configStore.loadState === "idle") void runtime.refreshGlobalConfig();
  }, [open, runtimeStore.serverId, configStore.loadState, runtime]);

  const isFieldDirty = (key: keyof GlobalConfigDraft): boolean =>
    JSON.stringify(configStore.draft[key]) !== JSON.stringify(configStore.snapshot[key]);
  const dirtyCount = GLOBAL_CONFIG_DIRTY_KEYS.filter((key) => isFieldDirty(key)).length;
  const controlsDisabled =
    actionPending || !runtimeStore.serverId || configStore.loadState !== "ready" || configStore.saving;
  const modelCatalogControlsDisabled = modelCatalogStore.saving;
  const canRefresh = Boolean(runtimeStore.serverId) && !configStore.saving && !actionPending;

  const typographyFontOptions = useMemo(
    () => UI_FONT_FAMILY_PRESET_OPTIONS.map((option) => ({ ...option, label: TYPOGRAPHY_LABELS[option.label] ?? option.label })),
    []
  );
  const typographySizeOptions = useMemo(
    () => UI_FONT_SIZE_PRESET_OPTIONS.map((option) => ({ ...option, label: TYPOGRAPHY_LABELS[option.label] ?? option.label })),
    []
  );
  const modelOptions = useMemo(
    () => buildModelPickerOptions({ customIds: modelCatalogStore.customIds, current: configStore.draft.model }),
    [modelCatalogStore.customIds, configStore.draft.model]
  );

  const approvalPolicyLabels = useMemo<Record<string, string>>(
    () => ({
      untrusted: "untrusted",
      "on-failure": "on-failure",
      "on-request": "on-request",
      never: "never",
      granular: "granular（细粒度）",
    }),
    []
  );
  const approvalsReviewerLabels = useMemo<Record<string, string>>(
    () => ({
      user: "user（用户）",
      auto_review: "auto_review",
      guardian_subagent: "guardian_subagent",
    }),
    []
  );
  const sandboxModeLabels = useMemo<Record<string, string>>(
    () => ({
      "read-only": "read-only（只读）",
      "workspace-write": "workspace-write（工作区可写）",
      "danger-full-access": "danger-full-access（完全权限）",
    }),
    []
  );

  const approvalPolicySelectValue = isGranularApprovalPolicy(configStore.draft.approvalPolicy)
    ? "granular"
    : String(configStore.draft.approvalPolicy);
  const granularApprovalPolicy = isGranularApprovalPolicy(configStore.draft.approvalPolicy)
    ? configStore.draft.approvalPolicy
    : createDefaultGranularApprovalPolicy();
  const approvalPolicyRestriction = buildRestrictedSelectState(
    configRequirementsStore.requirements?.allowedApprovalPolicies?.map(toApprovalPolicyOptionValue),
    OFFICIAL_APPROVAL_POLICY_OPTIONS
  );
  const approvalsReviewerRestriction = buildRestrictedSelectState(
    configRequirementsStore.requirements?.allowedApprovalsReviewers,
    OFFICIAL_APPROVALS_REVIEWER_OPTIONS
  );
  const sandboxModeRestriction = buildRestrictedSelectState(
    configRequirementsStore.requirements?.allowedSandboxModes,
    OFFICIAL_SANDBOX_MODE_OPTIONS
  );
  const approvalPolicyOptions = buildRestrictedSelectOptions(
    approvalPolicySelectValue,
    OFFICIAL_APPROVAL_POLICY_OPTIONS,
    approvalPolicyRestriction,
    approvalPolicyLabels
  );
  const approvalsReviewerOptions = buildRestrictedSelectOptions(
    String(configStore.draft.approvalsReviewer ?? ""),
    OFFICIAL_APPROVALS_REVIEWER_OPTIONS,
    approvalsReviewerRestriction,
    approvalsReviewerLabels
  );
  const sandboxModeOptions = buildRestrictedSelectOptions(
    String(configStore.draft.sandboxMode ?? ""),
    OFFICIAL_SANDBOX_MODE_OPTIONS,
    sandboxModeRestriction,
    sandboxModeLabels
  );
  const approvalPolicySelectDisabled =
    controlsDisabled || (approvalPolicyRestriction.hasRestrictions && (approvalPolicyRestriction.values?.length ?? 0) === 0);
  const approvalsReviewerSelectDisabled =
    controlsDisabled ||
    (approvalsReviewerRestriction.hasRestrictions && (approvalsReviewerRestriction.values?.length ?? 0) === 0);
  const sandboxModeSelectDisabled =
    controlsDisabled || (sandboxModeRestriction.hasRestrictions && (sandboxModeRestriction.values?.length ?? 0) === 0);

  const approvalPolicyHintText =
    configRequirementsStore.loadState === "error"
      ? ""
      : buildRestrictedHintText(approvalPolicyRestriction, approvalPolicyLabels);
  const sandboxModeHintText =
    configRequirementsStore.loadState === "error" ? "" : buildRestrictedHintText(sandboxModeRestriction, sandboxModeLabels);
  const approvalsReviewerHintText = (() => {
    if (!runtimeStore.serverId) return "";
    if (configRequirementsStore.loadState === "loading") return "正在读取服务端 requirements...";
    if (configRequirementsStore.loadState === "error") {
      return configRequirementsStore.statusText || "requirements 读取失败，当前按无约束显示 reviewer。";
    }
    if (!approvalsReviewerRestriction.hasRestrictions) return "默认由 user 处理审批。";
    if (!approvalsReviewerRestriction.values || approvalsReviewerRestriction.values.length === 0) {
      return approvalsReviewerRestriction.hasUnsupported
        ? "当前服务端 requirements 返回了桌面端暂未映射的 reviewer 限制。"
        : "当前服务端 requirements 未允许可选 reviewer。";
    }
    const suffix = approvalsReviewerRestriction.hasUnsupported
      ? "；其余 reviewer 限制桌面端暂未映射。"
      : "";
    return `当前服务端仅允许 reviewer：${formatRestrictedValues(approvalsReviewerRestriction.values, approvalsReviewerLabels)}${suffix}`;
  })();

  const modelContextWindow = normalizeOptionalPositiveIntegerInput(configStore.draft.modelContextWindow);
  const autoCompactLimit = normalizeOptionalPositiveIntegerInput(configStore.draft.modelAutoCompactTokenLimit);
  const baselineContextWindow = normalizeOptionalPositiveIntegerInput(configStore.snapshot.modelContextWindow);
  const baselineAutoCompactLimit = normalizeOptionalPositiveIntegerInput(configStore.snapshot.modelAutoCompactTokenLimit);
  const contextChanged = modelContextWindow !== baselineContextWindow;
  const compactChanged = autoCompactLimit !== baselineAutoCompactLimit;
  let modelContextWindowError = "";
  let modelAutoCompactTokenLimitError = "";
  if (contextChanged || compactChanged) {
    if (modelContextWindow == null && autoCompactLimit != null) {
      modelContextWindowError = "请先填写上下文窗口。";
    } else if (modelContextWindow != null && autoCompactLimit == null) {
      modelAutoCompactTokenLimitError = "请填写自动压缩阈值。";
    } else if (modelContextWindow != null && autoCompactLimit != null && autoCompactLimit >= modelContextWindow) {
      modelAutoCompactTokenLimitError = "必须小于上下文窗口。";
    }
  }
  const validationError = modelContextWindowError || modelAutoCompactTokenLimitError;
  const canSave =
    Boolean(runtimeStore.serverId) &&
    !configStore.saving &&
    configStore.loadState === "ready" &&
    configStore.isDirty &&
    !validationError;
  const canReset =
    Boolean(runtimeStore.serverId) && !configStore.saving && configStore.loadState === "ready" && configStore.isDirty;

  const statusKind = !runtimeStore.serverId
    ? "neutral"
    : configStore.loadState === "error" || validationError
      ? "error"
      : configStore.saving || configStore.loadState === "loading"
        ? "info"
        : configStore.isDirty
          ? "warning"
          : "success";
  const statusText = !runtimeStore.serverId
    ? "未连接服务"
    : configStore.saving
      ? "保存中..."
      : configStore.loadState === "loading"
        ? "读取配置中..."
        : configStore.loadState === "error"
          ? configStore.statusText || "读取失败"
          : validationError
            ? validationError
            : configStore.isDirty
              ? "有未保存改动"
              : "已同步生效配置";
  const actionsSummary = !runtimeStore.serverId
    ? "主配置未连接服务"
    : configStore.saving
      ? "正在保存主配置..."
      : configStore.isDirty
        ? `主配置待保存 ${dirtyCount} 项`
        : "主配置已同步";
  const actionsHint = !runtimeStore.serverId
    ? "连接服务后才能保存主配置。"
    : validationError
      ? "修正当前校验错误后，才能保存主配置。"
      : "主配置改动需要点击保存。";
  const configRequirementsSummaryText = (() => {
    if (!runtimeStore.serverId) return "";
    if (configRequirementsStore.loadState === "loading") return "正在读取服务端 requirements...";
    if (configRequirementsStore.loadState === "error") {
      return configRequirementsStore.statusText || "requirements 读取失败，当前按无约束展示配置选项。";
    }
    if (!configRequirementsStore.requirements) {
      return configRequirementsStore.statusText || "当前服务端未配置 requirements，使用完整配置选项。";
    }
    if (
      approvalPolicyRestriction.hasRestrictions ||
      approvalsReviewerRestriction.hasRestrictions ||
      sandboxModeRestriction.hasRestrictions
    ) {
      return "已按服务端 requirements 限制审批策略、审批复核方与沙箱模式。";
    }
    return configRequirementsStore.statusText || "当前服务端未限制审批策略、审批复核方与沙箱模式。";
  })();
  const configRequirementsSummaryClass =
    configRequirementsStore.loadState === "error"
      ? "is-error"
      : configRequirementsStore.loadState === "loading"
        ? "is-loading"
        : "is-ready";

  const remoteModelPickExists = (id: string) => Boolean(normalizeModelId(id)) && modelCatalogStore.availableModelIds.includes(id);
  const canRefreshRemoteModels = Boolean(runtimeStore.serverId) && modelCatalogStore.remoteLoadState !== "loading";
  const remoteModelStatusText = (() => {
    if (!runtimeStore.serverId) return "连接服务后可从 Codex 读取可用模型（model/list），无需手动查找。";
    if (modelCatalogStore.remoteLoadState === "loading") return "正在读取可用模型...";
    if (modelCatalogStore.remoteLoadState === "error") return "读取可用模型失败，可点击刷新重试。";
    if (modelCatalogStore.remoteIds.length > 0) {
      return `已读取 ${modelCatalogStore.remoteIds.length} 个可用模型。`;
    }
    return "点击刷新读取可用模型列表。";
  })();
  const remoteModelOptions = (() => {
    const hasServer = Boolean(runtimeStore.serverId);
    const loading = modelCatalogStore.remoteLoadState === "loading";
    const errored = modelCatalogStore.remoteLoadState === "error";
    let placeholder = "未加载，点击刷新";
    if (!hasServer) placeholder = "未连接服务";
    else if (loading) placeholder = "加载中...";
    else if (errored) placeholder = "加载失败，点击刷新";
    else if (modelCatalogStore.remoteIds.length > 0) placeholder = "选择可用模型";
    return [
      { value: "", label: placeholder, disabled: true },
      ...modelCatalogStore.remoteIds.map((id) => ({ value: id, label: id })),
    ];
  })();

  const [customModelInput, setCustomModelInput] = useState("");
  const [remoteModelPick, setRemoteModelPick] = useState("");
  const normalizedCustomModelInput = normalizeModelId(customModelInput);
  const customModelExists =
    Boolean(normalizedCustomModelInput) && modelCatalogStore.availableModelIds.includes(normalizedCustomModelInput);
  const canAddCustomModel =
    Boolean(normalizedCustomModelInput) && !customModelExists && !modelCatalogControlsDisabled;
  const canAddRemoteModel =
    Boolean(normalizeModelId(remoteModelPick)) && !remoteModelPickExists(normalizeModelId(remoteModelPick)) && !modelCatalogControlsDisabled;
  const customModelHintText = !normalizedCustomModelInput
    ? "添加后会同步到全局配置、主输入区和执行计划工具条。"
    : customModelExists
      ? "该模型已在可选列表中。"
      : "点击添加后，会立即出现在所有模型下拉里。";

  const saveGlobalConfigManually = async (options?: { silentSuccessToast?: boolean }): Promise<boolean> => {
    if (!canSave) return false;
    await runtime.saveGlobalConfig({ source: "manual", silentSuccessToast: options?.silentSuccessToast });
    return true;
  };
  const performWithDirtyGuard = async (actionKey: PendingAction, callback: () => void | Promise<void>) => {
    if (actionPending || configStore.saving) return;
    if (!configStore.isDirty) {
      await callback();
      return;
    }

    setActionPending(true);
    try {
      if (!canSave) {
        const reason = validationError || "主配置需要手动保存。";
        const proceed = window.confirm(
          `${PENDING_TITLES[actionKey]}\n${`当前内容无法保存：${reason}`}`
        );
        if (!proceed) return;
        runtime.resetGlobalConfig();
        await callback();
        return;
      }
      const proceed = window.confirm(
        `${PENDING_TITLES[actionKey]}\n${PENDING_MESSAGES[actionKey]}`
      );
      if (!proceed) return;
      const saved = await saveGlobalConfigManually({ silentSuccessToast: true });
      if (saved) await callback();
    } finally {
      setActionPending(false);
    }
  };

  const onRequestClose = () => {
    void performWithDirtyGuard("close", () => appShellStore.setGlobalConfigDrawerOpen(false));
  };
  const onRefreshGlobalConfig = () => {
    void performWithDirtyGuard("refresh", () => runtime.refreshGlobalConfig());
  };
  const onResetGlobalConfig = () => {
    void performWithDirtyGuard("discard", () => runtime.resetGlobalConfig());
  };
  const onApprovalPolicyChanged = (value: string) => {
    configStore.setDraft({
      approvalPolicy: value === "granular" ? createDefaultGranularApprovalPolicy() : normalizeApprovalPolicy(value),
    });
  };
  const onGranularApprovalFlagChanged = (key: GranularApprovalFlag, checked: boolean) => {
    configStore.setDraft({
      approvalPolicy: {
        granular: {
          ...granularApprovalPolicy.granular,
          [key]: checked,
        },
      },
    });
  };
  const setServiceTier = (fastModeEnabled: boolean) => {
    if (controlsDisabled) return;
    configStore.setDraft({ fastModeEnabled });
  };
  const onServiceTierKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setServiceTier(false);
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setServiceTier(true);
    }
  };
  const onAddCustomModel = async () => {
    const next = normalizedCustomModelInput;
    if (!next || customModelExists || modelCatalogControlsDisabled) return;
    const added = await modelCatalogStore.addCustomModel(next);
    if (added) setCustomModelInput("");
  };
  const onAddRemoteModel = async () => {
    const next = normalizeModelId(remoteModelPick);
    if (!next || remoteModelPickExists(next) || modelCatalogControlsDisabled) return;
    const added = await modelCatalogStore.addCustomModel(next);
    if (added) setRemoteModelPick("");
  };
  const onRemoveCustomModel = async (id: string) => {
    if (modelCatalogControlsDisabled) return;
    const removedId = normalizeModelId(id);
    if (!removedId) return;
    const globalWasDirty = configStore.isDirty;
    const removed = await modelCatalogStore.removeCustomModel(removedId);
    if (!removed) return;

    const reverted: string[] = [];
    if (normalizeModelId(runtimeStore.model) === removedId) {
      runtimeStore.model = DEFAULT_MODEL_NAME;
      await runtimeStore.saveThreadComposeStateNow();
      reverted.push("当前线程已回退");
    }
    if (normalizeModelId(configStore.draft.model) === removedId) {
      configStore.setDraft({ model: DEFAULT_MODEL_NAME });
      reverted.push("全局配置已回退");
      if (!globalWasDirty && runtimeStore.serverId && configStore.loadState === "ready" && !configStore.saving) {
        await runtime.saveGlobalConfig({ source: "auto", silentSuccessToast: true });
      } else if (globalWasDirty) {
        reverted.push("全局配置存在其它未保存改动，请手动保存");
      }
    }
    if (reverted.length > 0) {
      showToast({
        kind: globalWasDirty ? "warn" : "info",
        title: "模型已删除",
        message: `${removedId} 已删除，相关引用已回退到 ${DEFAULT_MODEL_NAME}。${reverted.join("；")}`,
      });
    }
  };

  if (!open) return null;

  const panel = (
    <section className={["global-config-drawer-panel", className].filter(Boolean).join(" ")} onClick={(event) => event.stopPropagation()}>
      <header className="global-config-drawer-head">
        <div className="panel-title">全局配置</div>
        <div className="row global-config-head-actions">
          <div className={`global-config-status global-config-status--inline is-${statusKind}`}>
            <span className="global-config-status-text">{statusText}</span>
          </div>
          <button className="btn-mini" type="button" disabled={!canReset} onClick={onResetGlobalConfig}>
            重置
          </button>
          <button className="btn-mini" type="button" disabled={!canRefresh} onClick={onRefreshGlobalConfig}>
            刷新
          </button>
          {!isSettings ? (
            <button className="btn-mini" type="button" disabled={actionPending || configStore.saving} onClick={onRequestClose}>
              关闭
            </button>
          ) : null}
        </div>
      </header>

      <div className={`global-config-drawer-body app-scrollbar${isSettings ? " is-settings" : ""}`}>
        {configStore.isDirty ? (
          <div className="global-config-topbar">
            <div className="global-config-dirty-badge mono">
              {`已修改 ${dirtyCount} 项`}
            </div>
          </div>
        ) : null}

        <section className="global-config-guide-entry global-config-local-entry">
          <div className="guide-entry-text">
            <div className="guide-entry-title">字体与字号</div>
            <div className="guide-entry-desc">切换全局字体样式与整体字号缩放，立即生效。</div>
          </div>
          <div className="typography-controls">
            <label className="typography-row">
              <span className="typography-label dim">字体</span>
              <SelectDropdown
                id="sel-ui-font-family"
                className="context-input mono"
                modelValue={typographyStore.fontFamilyPreset}
                options={typographyFontOptions}
                onUpdate:modelValue={(value) => typographyStore.setFontFamilyPreset(value)}
              />
            </label>
            <label className="typography-row">
              <span className="typography-label dim">字号</span>
              <SelectDropdown
                id="sel-ui-font-size"
                className="context-input mono"
                modelValue={typographyStore.fontSizePreset}
                options={typographySizeOptions}
                onUpdate:modelValue={(value) => typographyStore.setFontSizePreset(value)}
              />
            </label>
          </div>
        </section>

        <div className="global-config-grid">
          <section className="global-config-section">
            <label className={`global-row${isFieldDirty("model") ? " is-dirty" : ""}`}>
              <span className="context-label dim">模型</span>
              <div className="global-field-stack">
                <SelectDropdown
                  id="sel-global-model"
                  className="context-input mono"
                  modelValue={configStore.draft.model}
                  disabled={controlsDisabled}
                  options={modelOptions}
                  onUpdate:modelValue={(value) => configStore.setDraft({ model: normalizeModelId(value) || DEFAULT_MODEL_NAME })}
                />
                <div className="global-model-manage-hint">内置预设保留，可在下方追加自定义模型。</div>
              </div>
            </label>
            <div className={`global-row global-row-service-tier${isFieldDirty("fastModeEnabled") ? " is-dirty" : ""}`}>
              <span className="context-label dim">服务层级</span>
              <div className="global-field-stack service-tier-field">
                <div
                  id="service-tier-toggle"
                  className={`service-tier-segment${configStore.draft.fastModeEnabled ? " is-fast" : ""}${controlsDisabled ? " is-disabled" : ""}`}
                  role="radiogroup"
                  aria-label="服务层级"
                  aria-disabled={controlsDisabled ? "true" : "false"}
                  onKeyDown={onServiceTierKeyDown}
                >
                  <span className="service-tier-thumb" aria-hidden="true" />
                  <button
                    id="btn-service-tier-flex"
                    type="button"
                    className="service-tier-option mono"
                    role="radio"
                    aria-checked={!configStore.draft.fastModeEnabled ? "true" : "false"}
                    tabIndex={configStore.draft.fastModeEnabled ? -1 : 0}
                    disabled={controlsDisabled}
                    onClick={() => setServiceTier(false)}
                  >
                    标准
                  </button>
                  <button
                    id="btn-service-tier-fast"
                    type="button"
                    className="service-tier-option mono"
                    role="radio"
                    aria-checked={configStore.draft.fastModeEnabled ? "true" : "false"}
                    tabIndex={configStore.draft.fastModeEnabled ? 0 : -1}
                    disabled={controlsDisabled}
                    onClick={() => setServiceTier(true)}
                  >
                    快速
                  </button>
                </div>
              </div>
            </div>
            <div className="global-row">
              <span className="context-label dim">自定义模型</span>
              <div className="global-field-stack global-model-manager">
                <div className="global-model-add-row">
                  <SelectDropdown
                    id="sel-global-custom-model-available"
                    className="context-input mono"
                    modelValue={remoteModelPick}
                    disabled={!runtimeStore.serverId || modelCatalogStore.remoteLoadState === "loading" || modelCatalogStore.remoteIds.length === 0}
                    options={remoteModelOptions}
                    minPopoverWidth={0}
                    aria-label="可用模型"
                    onUpdate:modelValue={setRemoteModelPick}
                  />
                  <button className="btn-mini" type="button" disabled={!canRefreshRemoteModels} onClick={() => void modelCatalogStore.refreshRemoteModels()}>
                    刷新
                  </button>
                  <button className="btn-mini" type="button" disabled={!canAddRemoteModel} onClick={() => void onAddRemoteModel()}>
                    添加
                  </button>
                </div>
                {remoteModelStatusText ? <div className="global-model-manage-hint">{remoteModelStatusText}</div> : null}
                {modelCatalogStore.remoteErrorText ? (
                  <div className="global-field-error">
                    {`加载失败：${modelCatalogStore.remoteErrorText}`}
                  </div>
                ) : null}
                <div className="global-model-add-row">
                  <input
                    id="inp-global-custom-model"
                    className="context-input mono"
                    value={customModelInput}
                    placeholder="例如 deepseek-chat"
                    disabled={modelCatalogControlsDisabled}
                    onChange={(event) => setCustomModelInput(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void onAddCustomModel();
                      }
                    }}
                  />
                  <button className="btn-mini" type="button" disabled={!canAddCustomModel} onClick={() => void onAddCustomModel()}>
                    添加
                  </button>
                </div>
                {customModelHintText ? <div className="global-model-manage-hint">{customModelHintText}</div> : null}
                {modelCatalogStore.errorText ? (
                  <div className="global-field-error">
                    {`保存失败：${modelCatalogStore.errorText}`}
                  </div>
                ) : null}
                {modelCatalogStore.customIds.length > 0 ? (
                  <div className="global-model-list">
                    {modelCatalogStore.customIds.map((id) => (
                      <div key={id} className="global-model-item">
                        <span className="global-model-item-id mono">{id}</span>
                        <button
                          className="btn-mini"
                          type="button"
                          disabled={modelCatalogControlsDisabled}
                          onClick={() => void onRemoveCustomModel(id)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="global-model-empty">尚未添加自定义模型，当前下拉仅显示内置预设。</div>
                )}
              </div>
            </div>
          </section>

          <section className="global-config-section">
            <div className="global-row">
              <span className="context-label dim">上下文预设</span>
              <div className="global-field-stack">
                <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn-mini"
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() =>
                      configStore.setDraft({
                        modelContextWindow: CONTEXT_WINDOW_PRESET_400K,
                        modelAutoCompactTokenLimit: AUTO_COMPACT_TOKEN_LIMIT_PRESET_400K,
                      })
                    }
                  >
                    400K
                  </button>
                  <span className="dim mono">400000 / 360000</span>
                </div>
              </div>
            </div>
            <label className={`global-row${isFieldDirty("modelContextWindow") ? " is-dirty" : ""}`}>
              <span className="context-label dim">窗口上限</span>
              <div className="global-field-stack">
                <input
                  className={`context-input mono${modelContextWindowError ? " is-invalid" : ""}`}
                  inputMode="numeric"
                  value={formatOptionalPositiveIntegerInput(configStore.draft.modelContextWindow)}
                  placeholder="例如 400000"
                  disabled={controlsDisabled}
                  aria-invalid={modelContextWindowError ? "true" : "false"}
                  onChange={(event) => configStore.setDraft({ modelContextWindow: normalizeOptionalPositiveIntegerInput(event.currentTarget.value) })}
                />
                {modelContextWindowError ? <span className="global-field-error">{modelContextWindowError}</span> : null}
              </div>
            </label>
            <label className={`global-row${isFieldDirty("modelAutoCompactTokenLimit") ? " is-dirty" : ""}`}>
              <span className="context-label dim">压缩阈值</span>
              <div className="global-field-stack">
                <input
                  className={`context-input mono${modelAutoCompactTokenLimitError ? " is-invalid" : ""}`}
                  inputMode="numeric"
                  value={formatOptionalPositiveIntegerInput(configStore.draft.modelAutoCompactTokenLimit)}
                  placeholder="例如 360000"
                  disabled={controlsDisabled}
                  aria-invalid={modelAutoCompactTokenLimitError ? "true" : "false"}
                  onChange={(event) =>
                    configStore.setDraft({
                      modelAutoCompactTokenLimit: normalizeOptionalPositiveIntegerInput(event.currentTarget.value),
                    })
                  }
                />
                {modelAutoCompactTokenLimitError ? (
                  <span className="global-field-error">{modelAutoCompactTokenLimitError}</span>
                ) : null}
              </div>
            </label>
          </section>

          <section className="global-config-section">
            {configRequirementsSummaryText ? (
              <div className={`global-config-requirements-summary ${configRequirementsSummaryClass}`}>
                {configRequirementsSummaryText}
              </div>
            ) : null}
            <label className={`global-row${isFieldDirty("modelReasoningEffort") ? " is-dirty" : ""}`}>
              <span className="context-label dim">推理强度</span>
              <div className="global-field-stack">
                <SelectDropdown
                  id="sel-global-reasoning-effort"
                  className="context-input mono"
                  modelValue={configStore.draft.modelReasoningEffort}
                  disabled={controlsDisabled}
                  options={OFFICIAL_REASONING_EFFORT_OPTIONS}
                  onUpdate:modelValue={(value) => configStore.setDraft({ modelReasoningEffort: value })}
                />
              </div>
            </label>
            <label className={`global-row${isFieldDirty("modelReasoningSummary") ? " is-dirty" : ""}`}>
              <span className="context-label dim">思考摘要</span>
              <div className="global-field-stack">
                <SelectDropdown
                  id="sel-global-reasoning-summary"
                  className="context-input mono"
                  modelValue={configStore.draft.modelReasoningSummary}
                  disabled={controlsDisabled}
                  options={OFFICIAL_REASONING_SUMMARY_OPTIONS}
                  onUpdate:modelValue={(value) => configStore.setDraft({ modelReasoningSummary: value })}
                />
              </div>
            </label>
            <label className={`global-row${isFieldDirty("approvalPolicy") ? " is-dirty" : ""}`}>
              <span className="context-label dim">审批策略</span>
              <div className="global-field-stack">
                <SelectDropdown
                  id="sel-global-approval-policy"
                  className="context-input mono"
                  modelValue={approvalPolicySelectValue}
                  disabled={approvalPolicySelectDisabled}
                  options={approvalPolicyOptions}
                  onUpdate:modelValue={onApprovalPolicyChanged}
                />
                {approvalPolicyHintText ? <div className="global-model-manage-hint">{approvalPolicyHintText}</div> : null}
                {approvalPolicySelectValue === "granular" ? (
                  <div className="global-toggle-list">
                    {[
                      ["sandbox_approval", "沙箱审批"],
                      ["rules", "规则审批"],
                      ["skill_approval", "技能审批"],
                      ["request_permissions", "权限请求"],
                      ["mcp_elicitations", "MCP 输入请求"],
                    ].map(([key, title]) => (
                      <ToggleRow
                        key={key}
                        title={title}
                        note={key}
                        checked={Boolean(granularApprovalPolicy.granular[key as GranularApprovalFlag])}
                        disabled={controlsDisabled}
                        onChange={(checked) => onGranularApprovalFlagChanged(key as GranularApprovalFlag, checked)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </label>
            <label className={`global-row${isFieldDirty("approvalsReviewer") ? " is-dirty" : ""}`}>
              <span className="context-label dim">审批复核方</span>
              <div className="global-field-stack">
                <SelectDropdown
                  id="sel-global-approvals-reviewer"
                  className="context-input mono"
                  modelValue={configStore.draft.approvalsReviewer}
                  disabled={approvalsReviewerSelectDisabled}
                  options={approvalsReviewerOptions}
                  onUpdate:modelValue={(value) => configStore.setDraft({ approvalsReviewer: value as ApprovalsReviewer })}
                />
                {approvalsReviewerHintText ? <div className="global-model-manage-hint">{approvalsReviewerHintText}</div> : null}
              </div>
            </label>
            <label className={`global-row${isFieldDirty("sandboxMode") ? " is-dirty" : ""}`}>
              <span className="context-label dim">沙箱模式</span>
              <div className="global-field-stack">
                <SelectDropdown
                  id="sel-global-sandbox-mode"
                  className="context-input mono"
                  modelValue={configStore.draft.sandboxMode}
                  disabled={sandboxModeSelectDisabled}
                  options={sandboxModeOptions}
                  onUpdate:modelValue={(value) => configStore.setDraft({ sandboxMode: value as SandboxMode })}
                />
                {sandboxModeHintText ? <div className="global-model-manage-hint">{sandboxModeHintText}</div> : null}
              </div>
            </label>
          </section>

          <section className="global-config-section">
            <ToggleRow
              title="提权沙箱"
              note="启用后使用提权沙箱"
              checked={Boolean(configStore.draft.windowsElevatedSandboxEnabled)}
              disabled={controlsDisabled}
              dirty={isFieldDirty("windowsElevatedSandboxEnabled")}
              onChange={(checked) => configStore.setDraft({ windowsElevatedSandboxEnabled: checked })}
            />
            <ToggleRow
              title="统一执行"
              note="启用统一执行流程"
              checked={Boolean(configStore.draft.unifiedExecEnabled)}
              disabled={controlsDisabled}
              dirty={isFieldDirty("unifiedExecEnabled")}
              onChange={(checked) => configStore.setDraft({ unifiedExecEnabled: checked })}
            />
            <ToggleRow
              title="流式文件 Diff"
              note="启用 patchUpdated 文件变更流"
              checked={Boolean(configStore.draft.applyPatchStreamingEventsEnabled)}
              disabled={controlsDisabled}
              dirty={isFieldDirty("applyPatchStreamingEventsEnabled")}
              onChange={(checked) => configStore.setDraft({ applyPatchStreamingEventsEnabled: checked })}
            />
          </section>
        </div>

        <footer className="global-config-actions">
          <div className="global-config-actions-meta">
            <div className="global-config-actions-summary">{actionsSummary}</div>
            <div className="global-config-actions-hint">{actionsHint}</div>
          </div>
          <div className="global-config-actions-buttons">
            <button className="btn-mini" type="button" disabled={!canReset} onClick={onResetGlobalConfig}>
              放弃
            </button>
            <button className="btn-mini" type="button" disabled={!canSave} onClick={() => void saveGlobalConfigManually()}>
              保存
            </button>
          </div>
        </footer>
      </div>
    </section>
  );

  if (isSettings) return <div className="global-config-drawer-overlay is-settings">{panel}</div>;

  return (
    <div
      className="global-config-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="全局配置"
      onClick={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <div className="global-config-drawer-backdrop" onClick={onRequestClose} />
      {panel}
    </div>
  );
}
