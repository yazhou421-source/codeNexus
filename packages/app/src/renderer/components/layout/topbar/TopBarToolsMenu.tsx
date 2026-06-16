import { SlidersHorizontal } from "lucide-react";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { showToast } from "../../../ui/toast";

type TopBarToolsMenuProps = {
  className?: string;
  open?: boolean;
  onToggle?: () => void;
};

export default function TopBarToolsMenu({ className, open = false, onToggle }: TopBarToolsMenuProps) {
  const runtime = getRuntimeOrchestrator();

  const onContextActionComingSoon = () => {
    showToast({
      kind: "info",
      title: "撤回最近 N 轮",
      message: "正在开发中，暂时无法使用...",
      timeoutMs: 4500,
    });
  };

  return (
    <div className={className}>
      <div className={`topbar-single-switch${open ? " is-open" : ""}`}>
        <span className="topbar-single-switch-thumb" aria-hidden="true" />
        <button
          id="btn-topbar-tools"
          className="topbar-single-switch-option"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="工具"
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span className="topbar-right-switch-label">工具</span>
        </button>
      </div>

      {open ? (
        <div className="topbar-menu-shell topbar-menu-shell--tools" onClick={(event) => event.stopPropagation()}>
          <div className="topbar-dropdown topbar-menu app-scrollbar" role="menu" aria-label="工具菜单">
            <div className="topbar-menu-section">
              <div className="topbar-menu-heading">上下文操作</div>
              <button id="btn-topbar-rollback" className="btn-mini !justify-start" type="button" onClick={onContextActionComingSoon}>
                撤回最近 N 轮
              </button>
              <div className="topbar-menu-note">撤回功能开发中，暂不可用。</div>
              <button className="btn-mini !justify-start" id="btn-topbar-memory-enable" type="button" onClick={() => void runtime.setCurrentThreadMemoryMode("enabled")}>
                启用当前线程记忆
              </button>
              <button className="btn-mini !justify-start" id="btn-topbar-memory-disable" type="button" onClick={() => void runtime.setCurrentThreadMemoryMode("disabled")}>
                关闭当前线程记忆
              </button>
              <button className="btn-mini !justify-start danger" id="btn-topbar-memory-reset" type="button" onClick={() => void runtime.resetCodexMemory()}>
                重置 Codex 记忆
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
