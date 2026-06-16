import CustomWorkbench from "./workbench/CustomWorkbench";
import DebugTimelineSidebar from "../../shared/shell/DebugTimelineSidebar";
import { useUiPrefsStore } from "../../stores/uiPrefs.store";
import CustomTopBar from "./shell/CustomTopBar";
import CustomBottomBar from "./shell/CustomBottomBar";

// 自定义运行模式整页外壳：custom 专属顶栏 + 工作台主体（可选调试侧栏）+ custom 底栏。
// 不再渲染 codex 的 TopBar / BottomBar / SettingsPage。
export default function CustomPage() {
  const uiPrefsStore = useUiPrefsStore();
  const showDebugSidebar = uiPrefsStore.timelineDebugEnabled;

  const mainClass = ["main", showDebugSidebar ? "has-files-sidebar" : ""].filter(Boolean).join(" ");

  return (
    <>
      <CustomTopBar />
      <main className={mainClass}>
        <div className="center-content-host">
          <CustomWorkbench />
        </div>
        {showDebugSidebar ? <DebugTimelineSidebar className="files-pane-host" /> : null}
      </main>
      <CustomBottomBar />
    </>
  );
}
