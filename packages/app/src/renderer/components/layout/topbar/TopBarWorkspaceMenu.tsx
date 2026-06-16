import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { useRuntimeStore } from "../../../stores/runtime.store";

type TopBarWorkspaceMenuProps = {
  className?: string;
  open?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
};

function basenameFromWorkspacePath(pathValue: string) {
  const normalized = pathValue.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || pathValue;
}

export default function TopBarWorkspaceMenu({ className, open = false, onToggle, onClose }: TopBarWorkspaceMenuProps) {
  const { t } = useTranslation();
  const runtime = getRuntimeOrchestrator();
  const runtimeStore = useRuntimeStore();
  const workspacePath = String(runtimeStore.workspacePath ?? "").trim();
  const workspaceName = workspacePath ? basenameFromWorkspacePath(workspacePath) : t("topbarExtra.noWorkspace");
  const workspaceMenuActionLabel = workspacePath ? t("topbarExtra.changeWorkspace") : t("topbarExtra.selectWorkspace");

  async function onSelectWorkspace() {
    onClose?.();
    await runtime.selectWorkspace();
  }

  return (
    <div className={className}>
      <button
        id="btn-workspace"
        className={`topbar-pill topbar-pill--workspace${open ? " is-active" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.();
        }}
      >
        <span className="topbar-pill-caption">{t("topbarExtra.workspace")}</span>
        <span className={`topbar-pill-value topbar-pill-value--workspace${workspacePath ? "" : " dim"}`}>{workspaceName}</span>
        <ChevronDown className="topbar-pill-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="topbar-menu-shell topbar-menu-shell--workspace" onClick={(event) => event.stopPropagation()}>
          <div className="topbar-dropdown app-scrollbar topbar-menu topbar-menu--workspace" role="menu" aria-label={t("topbarExtra.workspaceMenu")}>
            <div className="workspace-menu-head">
              <div className="topbar-menu-heading">{t("topbarExtra.currentWorkspace")}</div>
              <button id="btn-workspace-menu-select" className="btn-mini workspace-menu-select" type="button" role="menuitem" onClick={() => void onSelectWorkspace()}>
                {workspaceMenuActionLabel}
              </button>
            </div>
            <div className={`workspace-path-inline mono${workspacePath ? "" : " dim"}`}>
              {workspacePath || t("topbarExtra.noWorkspaceFull")}
            </div>
            <div className="topbar-menu-note">{t("topbarExtra.workspaceNote")}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
