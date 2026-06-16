import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MODEL_NAME, buildModelPickerOptions, normalizeModelId } from "@codenexus/shared/modelCatalog";
import type { UiLanguage } from "@codenexus/shared/localSettings";
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
import { translate } from "../../../i18n/translate";
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

const UI_LANGUAGE_OPTIONS: Array<{ value: UiLanguage; labelKey: string }> = [
  { value: "zh-CN", labelKey: "common.chinese" },
  { value: "en-US", labelKey: "common.english" },
];
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
      label: translate("globalConfig.currentValue", { label: labelFor(currentValue) }),
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
      ? translate("globalConfig.requirements.unsupportedOnly")
      : translate("globalConfig.requirements.noAllowedValues");
  }
  const allowedText = formatRestrictedValues(restriction.values, labels);
  return restriction.hasUnsupported
    ? translate("globalConfig.requirements.allowedWithUnsupported", { values: allowedText })
    : translate("globalConfig.requirements.allowed", { values: allowedText });
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
    () => UI_FONT_FAMILY_PRESET_OPTIONS.map((option) => ({ ...option, label: translate(option.label) })),
    [appShellStore.language]
  );
  const typographySizeOptions = useMemo(
    () => UI_FONT_SIZE_PRESET_OPTIONS.map((option) => ({ ...option, label: translate(option.label) })),
    [appShellStore.language]
  );
  const languageOptions = useMemo(
    () => UI_LANGUAGE_OPTIONS.map((option) => ({ value: option.value, label: translate(option.labelKey) })),
    [appShellStore.language]
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
      granular: translate("globalConfig.approvalPolicyGranular"),
    }),
    [appShellStore.language]
  );
  const approvalsReviewerLabels = useMemo<Record<string, string>>(
    () => ({
      user: translate("globalConfig.reviewerUser"),
      auto_review: "auto_review",
      guardian_subagent: "guardian_subagent",
    }),
    [appShellStore.language]
  );
  const sandboxModeLabels = useMemo<Record<string, string>>(
    () => ({
      "read-only": translate("globalConfig.sandboxReadOnly"),
      "workspace-write": translate("globalConfig.sandboxWorkspaceWrite"),
      "danger-full-access": translate("globalConfig.sandboxDangerFullAccess"),
    }),
    [appShellStore.language]
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
    if (configRequirementsStore.loadState === "loading") return translate("globalConfig.requirements.loading");
    if (configRequirementsStore.loadState === "error") {
      return configRequirementsStore.statusText || translate("globalConfig.requirements.reviewerLoadFailed");
    }
    if (!approvalsReviewerRestriction.hasRestrictions) return translate("globalConfig.requirements.reviewerDefault");
    if (!approvalsReviewerRestriction.values || approvalsReviewerRestriction.values.length === 0) {
      return approvalsReviewerRestriction.hasUnsupported
        ? translate("globalConfig.requirements.reviewerUnsupportedOnly")
        : translate("globalConfig.requirements.reviewerNoAllowed");
    }
    const suffix = approvalsReviewerRestriction.hasUnsupported
      ? translate("globalConfig.requirements.reviewerUnsupportedSuffix")
      : "";
    return translate("globalConfig.requirements.reviewerAllowed", {
      values: formatRestrictedValues(approvalsReviewerRestriction.values, approvalsReviewerLabels),
      suffix,
    });
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
      modelContextWindowError = translate("globalConfig.validation.fillContextWindow");
    } else if (modelContextWindow != null && autoCompactLimit == null) {
      modelAutoCompactTokenLimitError = translate("globalConfig.validation.fillAutoCompactLimit");
    } else if (modelContextWindow != null && autoCompactLimit != null && autoCompactLimit >= modelContextWindow) {
      modelAutoCompactTokenLimitError = translate("globalConfig.validation.autoCompactLessThanContext");
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
    ? translate("globalConfig.status.disconnected")
    : configStore.saving
      ? translate("globalConfig.status.saving")
      : configStore.loadState === "loading"
        ? translate("globalConfig.status.loading")
        : configStore.loadState === "error"
          ? configStore.statusText || translate("globalConfig.status.loadFailed")
          : validationError
            ? validationError
            : configStore.isDirty
              ? translate("globalConfig.status.dirty")
              : translate("globalConfig.status.synced");
  const actionsSummary = !runtimeStore.serverId
    ? translate("globalConfig.actionsSummary.disconnected")
    : configStore.saving
      ? translate("globalConfig.actionsSummary.saving")
      : configStore.isDirty
        ? translate("globalConfig.actionsSummary.dirty", { count: dirtyCount })
        : translate("globalConfig.actionsSummary.synced");
  const actionsHint = !runtimeStore.serverId
    ? translate("globalConfig.actionsHint.disconnected")
    : validationError
      ? translate("globalConfig.actionsHint.validation")
      : translate("globalConfig.actionsHint.saveManually");
  const configRequirementsSummaryText = (() => {
    if (!runtimeStore.serverId) return "";
    if (configRequirementsStore.loadState === "loading") return translate("globalConfig.requirements.loading");
    if (configRequirementsStore.loadState === "error") {
      return configRequirementsStore.statusText || translate("globalConfig.requirements.loadFailed");
    }
    if (!configRequirementsStore.requirements) {
      return configRequirementsStore.statusText || translate("globalConfig.requirements.none");
    }
    if (
      approvalPolicyRestriction.hasRestrictions ||
      approvalsReviewerRestriction.hasRestrictions ||
      sandboxModeRestriction.hasRestrictions
    ) {
      return translate("globalConfig.requirements.restricted");
    }
    return configRequirementsStore.statusText || translate("globalConfig.requirements.unrestricted");
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
    if (!runtimeStore.serverId) return translate("globalConfig.remoteModels.connectFirst");
    if (modelCatalogStore.remoteLoadState === "loading") return translate("globalConfig.remoteModels.loading");
    if (modelCatalogStore.remoteLoadState === "error") return translate("globalConfig.remoteModels.error");
    if (modelCatalogStore.remoteIds.length > 0) {
      return translate("globalConfig.remoteModels.loaded", { count: modelCatalogStore.remoteIds.length });
    }
    return translate("globalConfig.remoteModels.refreshHint");
  })();
  const remoteModelOptions = (() => {
    const hasServer = Boolean(runtimeStore.serverId);
    const loading = modelCatalogStore.remoteLoadState === "loading";
    const errored = modelCatalogStore.remoteLoadState === "error";
    let placeholder = translate("globalConfig.remoteModels.notLoaded");
    if (!hasServer) placeholder = translate("globalConfig.remoteModels.disconnected");
    else if (loading) placeholder = translate("globalConfig.remoteModels.loadingShort");
    else if (errored) placeholder = translate("globalConfig.remoteModels.errorShort");
    else if (modelCatalogStore.remoteIds.length > 0) placeholder = translate("globalConfig.remoteModels.choose");
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
    ? translate("globalConfig.customModel.addHint")
    : customModelExists
      ? translate("globalConfig.customModel.exists")
      : translate("globalConfig.customModel.addSuccessHint");

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
        const reason = validationError || translate("globalConfig.pending.saveRequired");
        const proceed = window.confirm(
          `${translate(`globalConfig.pending.${actionKey}Title`)}\n${translate("globalConfig.pending.unsavableWithReason", { reason })}`
        );
        if (!proceed) return;
        runtime.resetGlobalConfig();
        await callback();
        return;
      }
      const proceed = window.confirm(
        `${translate(`globalConfig.pending.${actionKey}Title`)}\n${translate(`globalConfig.pending.${actionKey}Message`)}`
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
      reverted.push(translate("globalConfig.customModel.currentReverted"));
    }
    if (normalizeModelId(configStore.draft.model) === removedId) {
      configStore.setDraft({ model: DEFAULT_MODEL_NAME });
      reverted.push(translate("globalConfig.customModel.globalReverted"));
      if (!globalWasDirty && runtimeStore.serverId && configStore.loadState === "ready" && !configStore.saving) {
        await runtime.saveGlobalConfig({ source: "auto", silentSuccessToast: true });
      } else if (globalWasDirty) {
        reverted.push(translate("globalConfig.customModel.globalSaveSkippedDirty"));
      }
    }
    if (reverted.length > 0) {
      showToast({
        kind: globalWasDirty ? "warn" : "info",
        title: translate("globalConfig.customModel.removeFallbackTitle"),
        message: translate("globalConfig.customModel.removeFallbackMessage", {
          model: removedId,
          fallback: DEFAULT_MODEL_NAME,
          details: reverted.join("；"),
        }),
      });
    }
  };

  if (!open) return null;

  const panel = (
    <section className={["global-config-drawer-panel", className].filter(Boolean).join(" ")} onClick={(event) => event.stopPropagation()}>
      <header className="global-config-drawer-head">
        <div className="panel-title">{translate("globalConfig.title")}</div>
        <div className="row global-config-head-actions">
          <div className={`global-config-status global-config-status--inline is-${statusKind}`}>
            <span className="global-config-status-text">{statusText}</span>
          </div>
          <button className="btn-mini" type="button" disabled={!canReset} onClick={onResetGlobalConfig}>
            {translate("common.reset")}
          </button>
          <button className="btn-mini" type="button" disabled={!canRefresh} onClick={onRefreshGlobalConfig}>
            {translate("common.refresh")}
          </button>
          {!isSettings ? (
            <button className="btn-mini" type="button" disabled={actionPending || configStore.saving} onClick={onRequestClose}>
              {translate("common.close")}
            </button>
          ) : null}
        </div>
      </header>

      <div className={`global-config-drawer-body app-scrollbar${isSettings ? " is-settings" : ""}`}>
        {configStore.isDirty ? (
          <div className="global-config-topbar">
            <div className="global-config-dirty-badge mono">
              {translate("globalConfig.dirtyCount", { count: dirtyCount })}
            </div>
          </div>
        ) : null}

        <section className="global-config-guide-entry global-config-local-entry">
          <div className="guide-entry-text">
            <div className="guide-entry-title">{translate("globalConfig.typographyTitle")}</div>
            <div className="guide-entry-desc">{translate("globalConfig.typographyDesc")}</div>
          </div>
          <div className="typography-controls">
            <label className="typography-row">
              <span className="typography-label dim">{translate("globalConfig.font")}</span>
              <SelectDropdown
                id="sel-ui-font-family"
                className="context-input mono"
                modelValue={typographyStore.fontFamilyPreset}
                options={typographyFontOptions}
                onUpdate:modelValue={(value) => typographyStore.setFontFamilyPreset(value)}
              />
            </label>
            <label className="typography-row">
              <span className="typography-label dim">{translate("globalConfig.fontSize")}</span>
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

        <section className="global-config-guide-entry global-config-local-entry">
          <div className="guide-entry-text">
            <div className="guide-entry-title">{translate("globalConfig.languageTitle")}</div>
            <div className="guide-entry-desc">{translate("globalConfig.languageDesc")}</div>
          </div>
          <div className="typography-controls">
            <label className="typography-row">
              <span className="typography-label dim">{translate("common.language")}</span>
              <SelectDropdown
                id="sel-ui-language"
                className="context-input mono"
                modelValue={appShellStore.language}
                options={languageOptions}
                onUpdate:modelValue={(value) => appShellStore.setLanguage(value as UiLanguage)}
              />
            </label>
          </div>
        </section>

        <div className="global-config-grid">
          <section className="global-config-section">
            <label className={`global-row${isFieldDirty("model") ? " is-dirty" : ""}`}>
              <span className="context-label dim">{translate("globalConfig.model")}</span>
              <div className="global-field-stack">
                <SelectDropdown
                  id="sel-global-model"
                  className="context-input mono"
                  modelValue={configStore.draft.model}
                  disabled={controlsDisabled}
                  options={modelOptions}
                  onUpdate:modelValue={(value) => configStore.setDraft({ model: normalizeModelId(value) || DEFAULT_MODEL_NAME })}
                />
                <div className="global-model-manage-hint">{translate("globalConfig.builtinModelHint")}</div>
              </div>
            </label>
            <div className={`global-row global-row-service-tier${isFieldDirty("fastModeEnabled") ? " is-dirty" : ""}`}>
              <span className="context-label dim">{translate("globalConfig.serviceTier")}</span>
              <div className="global-field-stack service-tier-field">
                <div
                  id="service-tier-toggle"
                  className={`service-tier-segment${configStore.draft.fastModeEnabled ? " is-fast" : ""}${controlsDisabled ? " is-disabled" : ""}`}
                  role="radiogroup"
                  aria-label={translate("globalConfig.serviceTier")}
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
                    {translate("globalConfig.standard")}
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
                    {translate("globalConfig.fast")}
                  </button>
                </div>
              </div>
            </div>
            <div className="global-row">
              <span className="context-label dim">{translate("globalConfig.customModels")}</span>
              <div className="global-field-stack global-model-manager">
                <div className="global-model-add-row">
                  <SelectDropdown
                    id="sel-global-custom-model-available"
                    className="context-input mono"
                    modelValue={remoteModelPick}
                    disabled={!runtimeStore.serverId || modelCatalogStore.remoteLoadState === "loading" || modelCatalogStore.remoteIds.length === 0}
                    options={remoteModelOptions}
                    minPopoverWidth={0}
                    aria-label={translate("globalConfig.availableModels")}
                    onUpdate:modelValue={setRemoteModelPick}
                  />
                  <button className="btn-mini" type="button" disabled={!canRefreshRemoteModels} onClick={() => void modelCatalogStore.refreshRemoteModels()}>
                    {translate("common.refresh")}
                  </button>
                  <button className="btn-mini" type="button" disabled={!canAddRemoteModel} onClick={() => void onAddRemoteModel()}>
                    {translate("common.add")}
                  </button>
                </div>
                {remoteModelStatusText ? <div className="global-model-manage-hint">{remoteModelStatusText}</div> : null}
                {modelCatalogStore.remoteErrorText ? (
                  <div className="global-field-error">
                    {translate("globalConfig.loadFailed", { message: modelCatalogStore.remoteErrorText })}
                  </div>
                ) : null}
                <div className="global-model-add-row">
                  <input
                    id="inp-global-custom-model"
                    className="context-input mono"
                    value={customModelInput}
                    placeholder={translate("globalConfig.customModelPlaceholder")}
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
                    {translate("common.add")}
                  </button>
                </div>
                {customModelHintText ? <div className="global-model-manage-hint">{customModelHintText}</div> : null}
                {modelCatalogStore.errorText ? (
                  <div className="global-field-error">
                    {translate("globalConfig.saveFailed", { message: modelCatalogStore.errorText })}
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
                          {translate("common.delete")}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="global-model-empty">{translate("globalConfig.noCustomModels")}</div>
                )}
              </div>
            </div>
          </section>

          <section className="global-config-section">
            <div className="global-row">
              <span className="context-label dim">{translate("globalConfig.contextPreset")}</span>
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
              <span className="context-label dim">{translate("globalConfig.contextWindow")}</span>
              <div className="global-field-stack">
                <input
                  className={`context-input mono${modelContextWindowError ? " is-invalid" : ""}`}
                  inputMode="numeric"
                  value={formatOptionalPositiveIntegerInput(configStore.draft.modelContextWindow)}
                  placeholder={translate("globalConfig.contextWindowPlaceholder")}
                  disabled={controlsDisabled}
                  aria-invalid={modelContextWindowError ? "true" : "false"}
                  onChange={(event) => configStore.setDraft({ modelContextWindow: normalizeOptionalPositiveIntegerInput(event.currentTarget.value) })}
                />
                {modelContextWindowError ? <span className="global-field-error">{modelContextWindowError}</span> : null}
              </div>
            </label>
            <label className={`global-row${isFieldDirty("modelAutoCompactTokenLimit") ? " is-dirty" : ""}`}>
              <span className="context-label dim">{translate("globalConfig.autoCompactLimit")}</span>
              <div className="global-field-stack">
                <input
                  className={`context-input mono${modelAutoCompactTokenLimitError ? " is-invalid" : ""}`}
                  inputMode="numeric"
                  value={formatOptionalPositiveIntegerInput(configStore.draft.modelAutoCompactTokenLimit)}
                  placeholder={translate("globalConfig.autoCompactLimitPlaceholder")}
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
              <span className="context-label dim">{translate("globalConfig.reasoningEffort")}</span>
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
              <span className="context-label dim">{translate("globalConfig.reasoningSummary")}</span>
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
              <span className="context-label dim">{translate("globalConfig.approvalPolicy")}</span>
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
                      ["sandbox_approval", "globalConfig.granularSandboxApproval"],
                      ["rules", "globalConfig.granularRules"],
                      ["skill_approval", "globalConfig.granularSkillApproval"],
                      ["request_permissions", "globalConfig.granularRequestPermissions"],
                      ["mcp_elicitations", "globalConfig.granularMcpElicitations"],
                    ].map(([key, titleKey]) => (
                      <ToggleRow
                        key={key}
                        title={translate(titleKey)}
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
              <span className="context-label dim">{translate("globalConfig.approvalsReviewer")}</span>
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
              <span className="context-label dim">{translate("globalConfig.sandboxMode")}</span>
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
              title={translate("globalConfig.elevatedSandbox")}
              note={translate("globalConfig.elevatedSandboxNote")}
              checked={Boolean(configStore.draft.windowsElevatedSandboxEnabled)}
              disabled={controlsDisabled}
              dirty={isFieldDirty("windowsElevatedSandboxEnabled")}
              onChange={(checked) => configStore.setDraft({ windowsElevatedSandboxEnabled: checked })}
            />
            <ToggleRow
              title={translate("globalConfig.unifiedExec")}
              note={translate("globalConfig.unifiedExecNote")}
              checked={Boolean(configStore.draft.unifiedExecEnabled)}
              disabled={controlsDisabled}
              dirty={isFieldDirty("unifiedExecEnabled")}
              onChange={(checked) => configStore.setDraft({ unifiedExecEnabled: checked })}
            />
            <ToggleRow
              title={translate("globalConfig.patchStream")}
              note={translate("globalConfig.patchStreamNote")}
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
              {translate("common.discard")}
            </button>
            <button className="btn-mini" type="button" disabled={!canSave} onClick={() => void saveGlobalConfigManually()}>
              {translate("common.save")}
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
      aria-label={translate("globalConfig.title")}
      onClick={(event) => {
        if (event.target === event.currentTarget) onRequestClose();
      }}
    >
      <div className="global-config-drawer-backdrop" onClick={onRequestClose} />
      {panel}
    </div>
  );
}
