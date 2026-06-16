import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { useRuntimeStore } from "../../../stores/runtime.store";

type TopBarWorkspaceButtonProps = {
  className?: string;
};

export default function TopBarWorkspaceButton({ className }: TopBarWorkspaceButtonProps) {
  const { t } = useTranslation();
  const runtimeStore = useRuntimeStore();
  const workspacePath = String(runtimeStore.workspacePath ?? "").trim();
  const workspaceButtonLabel = workspacePath ? basenameFromPath(workspacePath) || workspacePath : t("topbarExtra.selectWorkspace");
  const workspaceButtonTitle = workspacePath || t("topbarExtra.selectWorkspace");

  return (
    <button
      id="btn-workspace-select"
      className={["btn-mini topbar-workspace-select", className].filter(Boolean).join(" ")}
      type="button"
      aria-label={workspaceButtonTitle}
      onClick={() => void getRuntimeOrchestrator().selectWorkspace()}
    >
      <FolderOpen className="topbar-workspace-select__icon" aria-hidden="true" />
      <span className="topbar-workspace-select__label">{workspaceButtonLabel}</span>
    </button>
  );
}
