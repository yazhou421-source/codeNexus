import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useMemo, useRef, useState } from "react";
import TopBar from "../../components/layout/TopBar";
import CenterPane from "../../components/layout/CenterPane";
import BottomBar from "../../components/layout/BottomBar";
import DebugTimelineSidebar from "../../shared/shell/DebugTimelineSidebar";
import LeftSidebar from "../../components/layout/LeftSidebar";
import SettingsPage from "../../components/layout/SettingsPage";
import WorkspaceEditorPane from "../../components/layout/workspace/WorkspaceEditorPane";
import WorkspaceFilesSidebar from "../../components/layout/workspace/WorkspaceFilesSidebar";
import {
  allowsWorkspaceFilesSidebar,
  getFeatureByMainView,
  shouldShowDefaultLeftSidebar,
} from "../../features/registry";
import { useAppShellStore } from "../../stores/appShell.store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { useUiPrefsStore } from "../../stores/uiPrefs.store";
import { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";
import {
  CENTER_BASE_MIN_WIDTH_PX,
  CENTER_EDITOR_HARD_MIN_WIDTH_PX,
  CENTER_EDITOR_SASH_WIDTH_PX,
  CENTER_EDITOR_SOFT_MIN_WIDTH_PX,
  CENTER_TIMELINE_HARD_MIN_WIDTH_PX,
  CENTER_WITH_EDITOR_HARD_MIN_WIDTH_PX,
  resolveCenterWidths,
  resolveShellWidths,
} from "../../domain/layoutWidthBudget";
import { useMemoEditorResizeEffects } from "./codexEditorResize";

const UNIFIED_SIDEBAR_WIDTH_PX = 300;
const CENTER_EDITOR_KEYBOARD_STEP_PX = 20;

// Codex 运行模式整页外壳：TopBar + 主区（设置 / 功能工作台 / 聊天中心 + 侧栏 + 编辑器）+ BottomBar。
// 所有 codex 专属的布局/编辑器拖拽逻辑都收敛在本页，custom 页不再共享这些状态。
export default function CodexPage() {
  const appShellStore = useAppShellStore();
  const runtimeStore = useRuntimeStore();
  const uiPrefsStore = useUiPrefsStore();
  const workspaceFilesStore = useWorkspaceFilesStore();
  const mainRef = useRef<HTMLElement | null>(null);
  const [editorResizeState, setEditorResizeState] = useState<{
    startClientX: number;
    startWidthPx: number;
    previewWidthPx: number;
  } | null>(null);

  const settingsOpen = appShellStore.settingsOpen;
  const mainView = appShellStore.mainView;
  const activeFeature = getFeatureByMainView(mainView);
  const featureWorkspaceSidebar =
    settingsOpen || !appShellStore.leftSidebarVisible ? null : activeFeature?.workspaceSidebarComponent ?? null;
  const featureSettingsSidebar = settingsOpen ? null : activeFeature?.settingsSidebarComponent ?? null;
  const showLeftSidebar =
    !settingsOpen &&
    appShellStore.leftSidebarVisible &&
    !featureWorkspaceSidebar &&
    shouldShowDefaultLeftSidebar(mainView);
  const showLeftPane = Boolean(featureWorkspaceSidebar) || showLeftSidebar;
  const showDebugSidebar = !settingsOpen && uiPrefsStore.timelineDebugEnabled && mainView === "chat";
  const showFilesSidebar =
    !settingsOpen &&
    allowsWorkspaceFilesSidebar(mainView) &&
    Boolean(String(runtimeStore.workspacePath ?? "").trim()) &&
    appShellStore.filesSidebarVisible &&
    !showDebugSidebar;
  const showEditorPane = !settingsOpen && mainView === "chat" && workspaceFilesStore.hasOpenTabs;
  const centerHardMinWidthPx = showEditorPane ? CENTER_WITH_EDITOR_HARD_MIN_WIDTH_PX : CENTER_BASE_MIN_WIDTH_PX;

  const getMainWidthPx = () => mainRef.current?.getBoundingClientRect().width ?? window.innerWidth;
  const resolvedShellWidths = useMemo(
    () =>
      resolveShellWidths({
        containerWidth: getMainWidthPx(),
        leftVisible: showLeftPane,
        filesVisible: showFilesSidebar || showDebugSidebar || Boolean(featureSettingsSidebar),
        rightVisible: false,
        leftPreferredWidth: UNIFIED_SIDEBAR_WIDTH_PX,
        filesPreferredWidth: UNIFIED_SIDEBAR_WIDTH_PX,
        rightPreferredWidth: 0,
        centerHardMinWidth: centerHardMinWidthPx,
        prioritySide: "left",
      }),
    [showLeftPane, showFilesSidebar, showDebugSidebar, featureSettingsSidebar, centerHardMinWidthPx]
  );
  const resolvedCenterWidths = useMemo(
    () =>
      resolveCenterWidths({
        containerWidth: resolvedShellWidths.centerWidth,
        editorVisible: showEditorPane,
        editorPreferredWidth: editorResizeState?.previewWidthPx ?? appShellStore.centerEditorWidthPx,
      }),
    [resolvedShellWidths.centerWidth, showEditorPane, editorResizeState?.previewWidthPx, appShellStore.centerEditorWidthPx]
  );
  const effectiveEditorWidthPx = resolvedCenterWidths.editorWidth;
  const isEditorCompact = showEditorPane && effectiveEditorWidthPx < CENTER_EDITOR_SOFT_MIN_WIDTH_PX;

  const setEditorResizeGlobalStyles = (enabled: boolean) => {
    try {
      document.body.style.cursor = enabled ? "col-resize" : "";
      document.body.style.userSelect = enabled ? "none" : "";
      document.body.classList.toggle("is-resizing", enabled);
    } catch {}
  };

  const clampEditorPreferredWidthPx = (value: number) => {
    const totalWidth = resolvedShellWidths.centerWidth;
    const maxWidth = Math.max(
      CENTER_EDITOR_HARD_MIN_WIDTH_PX,
      totalWidth - CENTER_EDITOR_SASH_WIDTH_PX - CENTER_TIMELINE_HARD_MIN_WIDTH_PX
    );
    return Math.max(CENTER_EDITOR_HARD_MIN_WIDTH_PX, Math.min(Math.round(value), maxWidth));
  };

  useMemoEditorResizeEffects({
    showEditorPane,
    editorResizeState,
    setEditorResizeState,
    setEditorResizeGlobalStyles,
    clampEditorPreferredWidthPx,
    appShellStore,
    centerWidth: resolvedShellWidths.centerWidth,
  });

  const onEditorSashPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!showEditorPane || event.button !== 0) return;
    setEditorResizeState({
      startClientX: event.clientX,
      startWidthPx: effectiveEditorWidthPx,
      previewWidthPx: effectiveEditorWidthPx,
    });
    setEditorResizeGlobalStyles(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    event.preventDefault();
  };

  const onEditorSashKeydown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!showEditorPane) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const delta = event.key === "ArrowLeft" ? CENTER_EDITOR_KEYBOARD_STEP_PX : -CENTER_EDITOR_KEYBOARD_STEP_PX;
    appShellStore.setCenterEditorWidthPx(clampEditorPreferredWidthPx(effectiveEditorWidthPx + delta), {
      save: true,
    });
    event.preventDefault();
  };

  const FeatureWorkspaceSidebar = featureWorkspaceSidebar;
  const FeatureWorkbench = activeFeature?.workbenchComponent ?? null;
  const FeatureSettingsSidebar = featureSettingsSidebar;

  const mainClass = [
    "main",
    !settingsOpen && showEditorPane ? "has-editor" : "",
    showFilesSidebar || showDebugSidebar || Boolean(featureSettingsSidebar) ? "has-files-sidebar" : "",
    mainView === "image" && featureSettingsSidebar ? "has-image-sidebar" : "",
    mainView === "paper" && featureSettingsSidebar ? "has-paper-sidebar" : "",
    settingsOpen ? "has-settings" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const mainStyle = {
    "--left-sidebar-w": `${Math.max(0, Math.round(resolvedShellWidths.leftWidth))}px`,
    "--files-sidebar-w": `${Math.max(0, Math.round(resolvedShellWidths.filesWidth))}px`,
    "--center-editor-w": `${Math.max(0, Math.round(effectiveEditorWidthPx))}px`,
    "--center-editor-sash-w": `${CENTER_EDITOR_SASH_WIDTH_PX}px`,
  } as CSSProperties;

  return (
    <>
      <TopBar />
      <main ref={mainRef} className={mainClass} style={mainStyle}>
        {FeatureWorkspaceSidebar ? (
          <FeatureWorkspaceSidebar className="tasks-pane-host" />
        ) : showLeftSidebar ? (
          <LeftSidebar className="tasks-pane-host" />
        ) : null}

        <div className="center-content-host">
          {settingsOpen ? <SettingsPage /> : FeatureWorkbench ? <FeatureWorkbench /> : <CenterPane />}
        </div>

        {!settingsOpen && showEditorPane ? (
          <div
            className="center-workbench-sash"
            role="separator"
            aria-orientation="vertical"
            aria-label={"调整文件编辑器宽度"}
            aria-valuenow={Math.round(effectiveEditorWidthPx)}
            tabIndex={0}
            onPointerDown={onEditorSashPointerDown}
            onKeyDown={onEditorSashKeydown}
          />
        ) : null}
        {!settingsOpen && showEditorPane ? (
          <WorkspaceEditorPane className={`workspace-editor-pane-host${isEditorCompact ? " is-compact" : ""}`} />
        ) : null}

        {FeatureSettingsSidebar ? (
          <FeatureSettingsSidebar className="files-pane-host" />
        ) : showDebugSidebar ? (
          <DebugTimelineSidebar className="files-pane-host" />
        ) : showFilesSidebar ? (
          <WorkspaceFilesSidebar className="files-pane-host" />
        ) : null}
      </main>
      <BottomBar />
    </>
  );
}

