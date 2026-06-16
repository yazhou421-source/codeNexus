import { ScrollText } from "lucide-react";
import TopBarThemeSwitch from "../../../components/layout/topbar/TopBarThemeSwitch";
import TopBarUpdateNotice from "../../../components/layout/topbar/TopBarUpdateNotice";
import TopBarWindowControls from "../../../components/layout/topbar/TopBarWindowControls";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useUiPrefsStore } from "../../../stores/uiPrefs.store";
import ModeSwitchButton from "../../../shared/shell/ModeSwitchButton";

// 自定义运行模式的轻量顶栏：仅保留 OS 窗口 chrome、主题、调试日志开关与切换模式入口，
// 不渲染 codex 的主视图切换 / 工作区 / 设置齿轮等 codex 专属控件。
export default function CustomTopBar() {
  const appShellStore = useAppShellStore();
  const uiPrefsStore = useUiPrefsStore();

  return (
    <div className="topbar-wrap">
      <header className="topbar topbar--custom">
        <div className="topbar-left row">
          <span className="topbar-custom-title">
            <strong>自定义运行时</strong>
            <span className="topbar-custom-tag">实验 · 不依赖 codex-app-server</span>
          </span>
        </div>

        <div className="topbar-right-stack">
          <div className="row topbar-controls topbar-controls--sleek">
            <div className="control-group control-group-actions">
              <button
                type="button"
                className={`btn-icon${uiPrefsStore.timelineDebugEnabled ? " is-active" : ""}`}
                aria-label="调试日志"
                aria-pressed={uiPrefsStore.timelineDebugEnabled}
                onClick={() => uiPrefsStore.toggleTimelineDebugEnabled()}
              >
                <ScrollText aria-hidden="true" />
              </button>
              <TopBarUpdateNotice />
              <TopBarThemeSwitch />
            </div>
            <ModeSwitchButton runtimeMode={appShellStore.runtimeMode} onSwitch={() => appShellStore.openModeChooser()} />
            <div className="control-group control-group-window">
              <TopBarWindowControls />
            </div>
          </div>
        </div>
      </header>
    </div>
  );
}
