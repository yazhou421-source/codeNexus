import type { HTMLAttributes } from "react";
import SelectDropdown from "../../ui/SelectDropdown";
import type { SandboxMode } from "../../../stores/runtime.store";

type Option = string | { value: string; label: string; disabled?: boolean };

export type ComposerSandboxPickerProps = HTMLAttributes<HTMLDivElement> & {
  modelValue?: SandboxMode | string;
  options?: readonly Option[];
  tooltipText?: string;
  interactionOwnerId?: string;
  onUpdateModelValue?: (value: SandboxMode) => void;
  "onUpdate:modelValue"?: (value: SandboxMode) => void;
};

export default function ComposerSandboxPicker({
  modelValue = "workspace-write",
  options = [
    { value: "read-only", label: "read-only" },
    { value: "workspace-write", label: "workspace-write" },
    { value: "danger-full-access", label: "danger-full-access" },
  ],
  tooltipText = "",
  interactionOwnerId = "",
  onUpdateModelValue,
  "onUpdate:modelValue": onUpdateModelValueColon,
  className,
  ...props
}: ComposerSandboxPickerProps) {
  return (
    <div {...props} className={["composer-sandbox-picker", className].filter(Boolean).join(" ")} title={tooltipText}>
      <SelectDropdown
        className="btn-mini"
        modelValue={String(modelValue)}
        options={options}
        ariaLabel="Sandbox mode"
        minPopoverWidth={176}
        popoverOwnerId={interactionOwnerId}
        onValueChange={(value) => {
          const mode = value as SandboxMode;
          onUpdateModelValue?.(mode);
          onUpdateModelValueColon?.(mode);
        }}
      />
    </div>
  );
}
