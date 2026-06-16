import RuntimeModeChooser from "../shared/shell/RuntimeModeChooser";
import CodexPage from "../pages/codex/CodexPage";
import CustomPage from "../pages/custom/CustomPage";
import { useAppShellStore } from "../stores/appShell.store";

// 顶层页面路由：runtimeMode 决定渲染哪一页，取代旧的 either/or 内联分支。
// - null（未选择）→ 整页模式选择器
// - codex → CodexPage（自带 codex 外壳）
// - custom → CustomPage（自带 custom 外壳）
// modeChooserOpen 仅用于"切换模式"时叠加的选择器 overlay（保留已记忆的 runtimeMode）。
export default function AppRouter() {
  const appShellStore = useAppShellStore();
  const runtimeMode = appShellStore.runtimeMode;

  if (runtimeMode === null) {
    return <RuntimeModeChooser />;
  }

  return (
    <>
      {runtimeMode === "custom" ? <CustomPage /> : <CodexPage />}
      {appShellStore.modeChooserOpen ? <RuntimeModeChooser /> : null}
    </>
  );
}
