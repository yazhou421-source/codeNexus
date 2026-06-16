import { useMemo } from "react";
import { useAppShellStore } from "../../stores/appShell.store";
import CodexProfileSwitch from "./controls/CodexProfileSwitch";
import Clock from "../../shared/shell/Clock";
import ModeSwitchButton from "../../shared/shell/ModeSwitchButton";

// Codex 运行模式底栏：切换模式 + profile 切换 + 连接状态指示 + 时钟。
// custom 模式有独立的 CustomBottomBar，本组件不再做 isCustomMode 分支。
export default function BottomBar() {
  const appShellStore = useAppShellStore();

  const connectionLabel = useMemo(() => {
    if (appShellStore.serverConnState === "connected") return "已连接";
    if (appShellStore.serverConnState === "connecting") return "连接中";
    if (appShellStore.serverConnState === "failed") return "失败";
    return "离线";
  }, [appShellStore.serverConnState]);

  return (
    <footer className="bottom-bar" role="navigation" aria-label="底部栏">
      <div className="bottom-bar__left">
        <ModeSwitchButton
          runtimeMode={appShellStore.runtimeMode}
          onSwitch={() => appShellStore.openModeChooser()}
          className="bottom-bar__mode-switch"
        />
        <CodexProfileSwitch className="bottom-bar__profile-switch" />
      </div>
      <div className="bottom-bar__right">
        <div className={`bottom-bar__conn mono is-${appShellStore.serverConnState}`}>
          <span className="bottom-bar__conn-icon" aria-hidden="true">
            <span className="bottom-bar__conn-dot" />
          </span>
          <span className="bottom-bar__conn-text">{connectionLabel}</span>
        </div>
        <Clock className="bottom-bar__clock" />
      </div>
    </footer>
  );
}
