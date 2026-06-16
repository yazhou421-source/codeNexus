import type { SandboxMode } from "../../stores/runtime.store";
import type { PlanDeltaExecUiState } from "../layout/types/chat.types";
import ComposerModelReasoningPicker from "../layout/composer/ComposerModelReasoningPicker";
import ComposerSandboxPicker from "../layout/composer/ComposerSandboxPicker";
import { translate } from "../../i18n/translate";

type Option = string | { value: string; label: string; disabled?: boolean };

type ChatPlanDeltaActionsProps = {
  execState: PlanDeltaExecUiState;
  modelOptions?: readonly Option[];
  reasoningEffortOptions?: readonly Option[];
  sandboxModeOptions?: readonly Option[];
  disabled?: boolean;
  embedded?: boolean;
  compact?: boolean;
  onExecutePlan?: () => void;
  onUpdateModel?: (value: string) => void;
  onUpdateReasoningEffort?: (value: string) => void;
  onUpdateSandboxMode?: (value: SandboxMode) => void;
  className?: string;
};

export default function ChatPlanDeltaActions({
  execState,
  modelOptions = [],
  reasoningEffortOptions = [],
  sandboxModeOptions = [],
  disabled = false,
  embedded = false,
  compact = false,
  onExecutePlan,
  onUpdateModel,
  onUpdateReasoningEffort,
  onUpdateSandboxMode,
  className,
}: ChatPlanDeltaActionsProps) {
  return (
    <div
      className={[
        "plan-delta-actions flex flex-wrap items-center justify-end gap-2",
        embedded ? "mt-0 border-t-0 pt-0" : "mt-3 border-t border-[var(--border)] pt-2.5",
        compact ? "plan-delta-actions--compact" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ComposerModelReasoningPicker
        model={execState.model}
        reasoningEffort={execState.reasoningEffort}
        modelOptions={modelOptions}
        reasoningEffortOptions={reasoningEffortOptions}
        aria-disabled={disabled ? "true" : undefined}
        onUpdateModel={onUpdateModel}
        onUpdateReasoningEffort={onUpdateReasoningEffort}
      />
      <ComposerSandboxPicker
        modelValue={execState.sandboxMode}
        options={sandboxModeOptions}
        tooltipText=""
        aria-disabled={disabled ? "true" : undefined}
        onUpdateModelValue={onUpdateSandboxMode}
      />
      <button
        className="plan-delta-execute-button !inline-flex !h-7 !items-center !justify-center !border !border-[color:var(--border-warning)] !bg-gradient-to-b !from-[color:var(--bg-warning-soft)] !to-[color:var(--button-bg)] !px-3 !tracking-[0.1px] !text-[color:var(--fg-warning)] !shadow-none transition-[border-color,background,box-shadow,color] duration-150 hover:!border-[color:var(--border-warning-hover)] hover:!to-[color:var(--button-bg-hover)] focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[color:var(--bg-warning-soft)] active:!translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        disabled={disabled}
        onClick={onExecutePlan}
      >
        <span>{execState.executing ? translate("chat.planActions.executing") : translate("chat.planActions.executePlan")}</span>
      </button>
    </div>
  );
}
