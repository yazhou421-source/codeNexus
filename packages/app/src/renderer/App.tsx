import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./components/layout/TopBar";
import CenterPane from "./components/layout/CenterPane";
import BottomBar from "./components/layout/BottomBar";
import RuntimeModeChooser from "./components/custom/RuntimeModeChooser";
import CustomWorkbench from "./components/custom/CustomWorkbench";
import AppClosingOverlay from "./components/layout/overlays/AppClosingOverlay";
import DebugTimelineSidebar from "./components/layout/debug/DebugTimelineSidebar";
import GoalShutdownCountdownOverlay from "./components/layout/overlays/GoalShutdownCountdownOverlay";
import LeftSidebar from "./components/layout/LeftSidebar";
import SettingsPage from "./components/layout/SettingsPage";
import WorkspaceEditorPane from "./components/layout/workspace/WorkspaceEditorPane";
import WorkspaceFilesSidebar from "./components/layout/workspace/WorkspaceFilesSidebar";
import {
  allowsWorkspaceFilesSidebar,
  getFeatureByMainView,
  shouldShowDefaultLeftSidebar,
} from "./features/registry";
import { codexDesktop } from "./api/codexDesktopClient";
import { useAppClosingStore } from "./stores/appClosing.store";
import { useAppShellStore } from "./stores/appShell.store";
import { useGoalShutdownStore } from "./stores/goalShutdown.store";
import { useNotificationSoundStore } from "./stores/notificationSound.store";
import { useRuntimeStore } from "./stores/runtime.store";
import { useUiPrefsStore } from "./stores/uiPrefs.store";
import { useModelCatalogStore } from "./stores/modelCatalog.store";
import { useWorkspaceFilesStore } from "./stores/workspaceFiles.store";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";
import {
  CENTER_BASE_MIN_WIDTH_PX,
  CENTER_EDITOR_HARD_MIN_WIDTH_PX,
  CENTER_EDITOR_SASH_WIDTH_PX,
  CENTER_EDITOR_SOFT_MIN_WIDTH_PX,
  CENTER_TIMELINE_HARD_MIN_WIDTH_PX,
  CENTER_WITH_EDITOR_HARD_MIN_WIDTH_PX,
  resolveCenterWidths,
  resolveShellWidths,
} from "./domain/layoutWidthBudget";

const UNIFIED_SIDEBAR_WIDTH_PX = 300;
const CENTER_EDITOR_KEYBOARD_STEP_PX = 20;

function isToggleDebugTimelineShortcut(event: KeyboardEvent) {
  if (event.isComposing) return false;
  if (!(event.ctrlKey || event.metaKey) || !event.altKey) return false;
  return event.code === "KeyJ";
}

function applyWindowStateToDocument(state: AppWindowState) {
  const windowMode = state.isFullScreen ? "fullscreen" : state.isMaximized ? "maximized" : "normal";
  try {
    document.documentElement.dataset.window = windowMode;
  } catch {}
}

export default function App() {
  const appShellStore = useAppShellStore();
  const appClosingStore = useAppClosingStore();
  const goalShutdownStore = useGoalShutdownStore();
  const runtimeStore = useRuntimeStore();
  const uiPrefsStore = useUiPrefsStore();
  const notificationSoundStore = useNotificationSoundStore();
  const modelCatalogStore = useModelCatalogStore();
  const workspaceFilesStore = useWorkspaceFilesStore();
  const mainRef = useRef<HTMLElement | null>(null);
  const [editorResizeState, setEditorResizeState] = useState<{
    startClientX: number;
    startWidthPx: number;
    previewWidthPx: number;
  } | null>(null);

  useEffect(() => {
    appShellStore.initLocalSettings();
    runtimeStore.initLocalDraftState();
    notificationSoundStore.initLocalSettings();
    goalShutdownStore.initLocalSettings();
    modelCatalogStore.initLocalSettings();
    appClosingStore.initBridge();
    void notificationSoundStore.refreshAvailable();
  }, []);

  const settingsOpen = appShellStore.settingsOpen;
  const mainView = appShellStore.mainView;
  const isCustomMode = appShellStore.runtimeMode === "custom";
  const showModeChooser = appShellStore.runtimeMode === null || appShellStore.modeChooserOpen;
  const activeFeature = getFeatureByMainView(mainView);
  const featureWorkspaceSidebar =
    isCustomMode || settingsOpen || !appShellStore.leftSidebarVisible
      ? null
      : activeFeature?.workspaceSidebarComponent ?? null;
  const featureSettingsSidebar =
    isCustomMode || settingsOpen ? null : activeFeature?.settingsSidebarComponent ?? null;
  const showLeftSidebar =
    !isCustomMode &&
    !settingsOpen &&
    appShellStore.leftSidebarVisible &&
    !featureWorkspaceSidebar &&
    shouldShowDefaultLeftSidebar(mainView);
  const showLeftPane = Boolean(featureWorkspaceSidebar) || showLeftSidebar;
  const showDebugSidebar =
    !settingsOpen && uiPrefsStore.timelineDebugEnabled && (isCustomMode || mainView === "chat");
  const showFilesSidebar =
    !isCustomMode &&
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

  useEffect(() => {
    const onWindowKeydown = (event: KeyboardEvent) => {
      if (!isCustomMode || !isToggleDebugTimelineShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      uiPrefsStore.toggleTimelineDebugEnabled();
    };
    window.addEventListener("keydown", onWindowKeydown);

    void (async () => {
      try {
        applyWindowStateToDocument(await codexDesktop.window.getState());
      } catch {}
    })();

    let stopWindowStateListener: (() => void) | null = null;
    try {
      stopWindowStateListener = codexDesktop.window.onState((payload) => {
        applyWindowStateToDocument(payload);
      });
    } catch {}

    return () => {
      window.removeEventListener("keydown", onWindowKeydown);
      try {
        stopWindowStateListener?.();
      } catch {}
    };
  }, [isCustomMode, uiPrefsStore]);

  useEffect(() => {
    if (appClosingStore.phase !== "preparing") return;
    void runtimeStore.flushPendingComposeStateSaves().catch((error: unknown) => {
      console.warn("[App] flush pending compose state saves failed", error);
    });
  }, [appClosingStore.phase, runtimeStore]);

  useEffect(() => {
    if (showEditorPane) return;
    setEditorResizeState(null);
    setEditorResizeGlobalStyles(false);
  }, [showEditorPane]);

  useEffect(() => {
    if (!editorResizeState) return;
    const onPointerMove = (event: PointerEvent) => {
      setEditorResizeState((state) => {
        if (!state) return state;
        const deltaX = state.startClientX - event.clientX;
        return { ...state, previewWidthPx: clampEditorPreferredWidthPx(state.startWidthPx + deltaX) };
      });
    };
    const onPointerUp = () => {
      setEditorResizeState((state) => {
        if (state) {
          appShellStore.setCenterEditorWidthPx(clampEditorPreferredWidthPx(state.previewWidthPx), { save: true });
        }
        return null;
      });
      setEditorResizeGlobalStyles(false);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      setEditorResizeGlobalStyles(false);
    };
  }, [editorResizeState, appShellStore, resolvedShellWidths.centerWidth]);

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
    <div className="app-shell">
      <TopBar />
      <main ref={mainRef} className={mainClass} style={mainStyle}>
        {FeatureWorkspaceSidebar ? (
          <FeatureWorkspaceSidebar className="tasks-pane-host" />
        ) : showLeftSidebar ? (
          <LeftSidebar className="tasks-pane-host" />
        ) : null}

        <div className="center-content-host">
          {settingsOpen ? (
            <SettingsPage />
          ) : isCustomMode ? (
            <CustomWorkbench />
          ) : FeatureWorkbench ? (
            <FeatureWorkbench />
          ) : (
            <CenterPane />
          )}
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
      <div className="app-overlays">
        {appClosingStore.visible ? <AppClosingOverlay /> : null}
        {goalShutdownStore.visible ? <GoalShutdownCountdownOverlay /> : null}
        {showModeChooser ? <RuntimeModeChooser /> : null}
      </div>
    </div>
  );
}
