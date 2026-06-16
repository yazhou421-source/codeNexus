import { useAppShellStore } from "../../../stores/appShell.store";
import Clock from "../../../shared/shell/Clock";
import ModeSwitchButton from "../../../shared/shell/ModeSwitchButton";

// 自定义运行模式底栏：仅切换模式入口 + 时钟（无 codex 连接指示 / profile 切换）。
export default function CustomBottomBar() {
  const appShellStore = useAppShellStore();
  return (
    <footer className="bottom-bar" role="navigation" aria-label="底部栏">
      <div className="bottom-bar__left">
        <ModeSwitchButton
          runtimeMode={appShellStore.runtimeMode}
          onSwitch={() => appShellStore.openModeChooser()}
          className="bottom-bar__mode-switch"
        />
      </div>
      <div className="bottom-bar__right">
        <Clock className="bottom-bar__clock" />
      </div>
    </footer>
  );
}
