import { ChevronDown } from "lucide-react";
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
  const runtime = getRuntimeOrchestrator();
  const runtimeStore = useRuntimeStore();
  const workspacePath = String(runtimeStore.workspacePath ?? "").trim();
  const workspaceName = workspacePath ? basenameFromWorkspacePath(workspacePath) : "未选择";
  const workspaceMenuActionLabel = workspacePath ? "更换工作区" : "选择工作区";

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
        <span className="topbar-pill-caption">工作区</span>
        <span className={`topbar-pill-value topbar-pill-value--workspace${workspacePath ? "" : " dim"}`}>{workspaceName}</span>
        <ChevronDown className="topbar-pill-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="topbar-menu-shell topbar-menu-shell--workspace" onClick={(event) => event.stopPropagation()}>
          <div className="topbar-dropdown app-scrollbar topbar-menu topbar-menu--workspace" role="menu" aria-label="工作区菜单">
            <div className="workspace-menu-head">
              <div className="topbar-menu-heading">当前工作区</div>
              <button id="btn-workspace-menu-select" className="btn-mini workspace-menu-select" type="button" role="menuitem" onClick={() => void onSelectWorkspace()}>
                {workspaceMenuActionLabel}
              </button>
            </div>
            <div className={`workspace-path-inline mono${workspacePath ? "" : " dim"}`}>
              {workspacePath || "未选择工作区"}
            </div>
            <div className="topbar-menu-note">绑定当前任务目录，并驱动文件面板与动态工具</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
