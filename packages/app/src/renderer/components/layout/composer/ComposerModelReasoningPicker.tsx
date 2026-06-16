import type { HTMLAttributes } from "react";
import SelectDropdown from "../../ui/SelectDropdown";

type Option = string | { value: string; label: string; disabled?: boolean };

export type ComposerModelReasoningPickerProps = HTMLAttributes<HTMLDivElement> & {
  model?: string;
  reasoningEffort?: string;
  modelOptions?: readonly Option[];
  reasoningEffortOptions?: readonly Option[];
  interactionOwnerId?: string;
  onUpdateModel?: (value: string) => void;
  onUpdateReasoningEffort?: (value: string) => void;
  "onUpdate:model"?: (value: string) => void;
  "onUpdate:reasoningEffort"?: (value: string) => void;
};

export default function ComposerModelReasoningPicker({
  model = "",
  reasoningEffort = "medium",
  modelOptions = [],
  reasoningEffortOptions = ["low", "medium", "high", "xhigh"],
  interactionOwnerId = "",
  onUpdateModel,
  onUpdateReasoningEffort,
  "onUpdate:model": onUpdateModelColon,
  "onUpdate:reasoningEffort": onUpdateReasoningEffortColon,
  className,
  ...props
}: ComposerModelReasoningPickerProps) {
  return (
    <div {...props} className={["composer-model-reasoning-picker inline-flex items-center gap-2", className].filter(Boolean).join(" ")}>
      <SelectDropdown
        className="btn-mini"
        modelValue={model}
        options={modelOptions.length > 0 ? modelOptions : [model || "gpt-5.1-codex"]}
        ariaLabel="Model"
        minPopoverWidth={180}
        popoverOwnerId={interactionOwnerId}
        onValueChange={(value) => {
          onUpdateModel?.(value);
          onUpdateModelColon?.(value);
        }}
      />
      <SelectDropdown
        className="btn-mini"
        modelValue={reasoningEffort}
        options={reasoningEffortOptions}
        ariaLabel="Reasoning effort"
        minPopoverWidth={120}
        popoverOwnerId={interactionOwnerId}
        onValueChange={(value) => {
          onUpdateReasoningEffort?.(value);
          onUpdateReasoningEffortColon?.(value);
        }}
      />
    </div>
  );
}
