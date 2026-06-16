import TopBar from "../../components/layout/TopBar";
import BottomBar from "../../components/layout/BottomBar";
import CustomWorkbench from "../../components/custom/CustomWorkbench";
import DebugTimelineSidebar from "../../components/layout/debug/DebugTimelineSidebar";
import SettingsPage from "../../components/layout/SettingsPage";
import { useAppShellStore } from "../../stores/appShell.store";
import { useUiPrefsStore } from "../../stores/uiPrefs.store";

// 自定义运行模式整页外壳。Step 2 阶段先沿用全局 TopBar/BottomBar 以保持行为不变，
// Step 3 会把 codex 外壳从本页剥离、换成 custom 专属轻量外壳。
export default function CustomPage() {
  const appShellStore = useAppShellStore();
  const uiPrefsStore = useUiPrefsStore();
  const settingsOpen = appShellStore.settingsOpen;
  const showDebugSidebar = !settingsOpen && uiPrefsStore.timelineDebugEnabled;

  const mainClass = ["main", showDebugSidebar ? "has-files-sidebar" : "", settingsOpen ? "has-settings" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <TopBar />
      <main className={mainClass}>
        <div className="center-content-host">{settingsOpen ? <SettingsPage /> : <CustomWorkbench />}</div>
        {showDebugSidebar ? <DebugTimelineSidebar className="files-pane-host" /> : null}
      </main>
      <BottomBar />
    </>
  );
}
