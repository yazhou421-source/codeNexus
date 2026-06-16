import {
  BookOpen,
  Image as ImageIcon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Workflow,
} from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { MainView } from "@codenexus/shared/localSettings";
import { isFeatureMainView } from "../../features/registry";
import { useAppShellStore } from "../../stores/appShell.store";
import { useRuntimeStore } from "../../stores/runtime.store";
import { useWorkspaceFilesStore } from "../../stores/workspaceFiles.store";
import TopBarGoalSummary from "./topbar/TopBarGoalSummary";
import TopBarPlanSummary from "./topbar/TopBarPlanSummary";
import TopBarThemeSwitch from "./topbar/TopBarThemeSwitch";
import TopBarUpdateNotice from "./topbar/TopBarUpdateNotice";
import TopBarWindowControls from "./topbar/TopBarWindowControls";
import TopBarWorkspaceButton from "./topbar/TopBarWorkspaceButton";
import "./topbar/topbar.css";

const MAIN_VIEWS: Array<{ id: MainView; labelKey: string; icon: typeof MessageSquare }> = [
  { id: "chat", labelKey: "topbar.chat", icon: MessageSquare },
  { id: "image", labelKey: "topbar.image", icon: ImageIcon },
  { id: "flowchart", labelKey: "topbar.flowchart", icon: Workflow },
  { id: "paper", labelKey: "topbar.paper", icon: BookOpen },
];

export default function TopBar() {
  const { t } = useTranslation();
  const appShellStore = useAppShellStore();
  const runtimeStore = useRuntimeStore();
  const workspaceFilesStore = useWorkspaceFilesStore();
  const rightStackRef = useRef<HTMLDivElement | null>(null);
  const previousRightStackLeftRef = useRef<number | null>(null);
  const rightStackAnimationFrameRef = useRef(0);
  const rightStackAnimationTimerRef = useRef(0);

  const hasWorkspace = Boolean(String(runtimeStore.workspacePath ?? "").trim());
  const filesPaneVisible =
    hasWorkspace &&
    !appShellStore.settingsOpen &&
    appShellStore.mainView === "chat" &&
    appShellStore.filesSidebarVisible;

  const mainViewClass = useMemo(
    () =>
      [
        "topbar-mainview-switch",
        appShellStore.mainView === "chat" ? "is-chat" : "",
        appShellStore.mainView === "image" ? "is-image" : "",
        appShellStore.mainView === "flowchart" ? "is-flowchart" : "",
        appShellStore.mainView === "paper" ? "is-paper" : "",
      ]
        .filter(Boolean)
        .join(" "),
    [appShellStore.mainView],
  );

  const threadPaneTitle = useMemo(() => {
    if (appShellStore.settingsOpen) return t("topbar.threadPanelHiddenInSettings");
    if (appShellStore.mainView === "image") {
      return appShellStore.leftSidebarVisible ? t("topbar.closeImageWorkspacePanel") : t("topbar.openImageWorkspacePanel");
    }
    if (appShellStore.mainView === "flowchart") return t("topbar.threadPanelHiddenInFlowchart");
    if (appShellStore.mainView === "paper") {
      return appShellStore.leftSidebarVisible ? t("topbar.closePaperWorkspacePanel") : t("topbar.openPaperWorkspacePanel");
    }
    return appShellStore.leftSidebarVisible ? t("topbar.closeThreadPanel") : t("topbar.openThreadPanel");
  }, [appShellStore.leftSidebarVisible, appShellStore.mainView, appShellStore.settingsOpen, t]);

  const filesPaneTitle = useMemo(() => {
    if (!hasWorkspace) return t("topbar.chooseWorkspaceBeforeFiles");
    if (appShellStore.settingsOpen) return t("topbar.filesPanelHiddenInSettings");
    if (appShellStore.mainView === "image") return t("topbar.filesPanelHiddenInImage");
    if (appShellStore.mainView === "flowchart") return t("topbar.filesPanelHiddenInFlowchart");
    if (appShellStore.mainView === "paper") return t("topbar.filesPanelHiddenInPaper");
    return filesPaneVisible ? t("topbar.closeFilesPanel") : t("topbar.openFilesPanel");
  }, [appShellStore.mainView, appShellStore.settingsOpen, filesPaneVisible, hasWorkspace, t]);

  const clearRightStackLayoutAnimation = useCallback(() => {
    if (rightStackAnimationFrameRef.current) {
      window.cancelAnimationFrame(rightStackAnimationFrameRef.current);
      rightStackAnimationFrameRef.current = 0;
    }
    if (rightStackAnimationTimerRef.current) {
      window.clearTimeout(rightStackAnimationTimerRef.current);
      rightStackAnimationTimerRef.current = 0;
    }

    const rightStack = rightStackRef.current;
    if (!rightStack) return;
    rightStack.classList.remove("is-layout-animating");
    rightStack.style.transition = "";
    rightStack.style.transform = "";
  }, []);

  useLayoutEffect(() => {
    const rightStack = rightStackRef.current;
    const previousLeft = previousRightStackLeftRef.current;
    const reducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (rightStack && previousLeft != null && !reducedMotion) {
      const nextLeft = rightStack.getBoundingClientRect().left;
      const deltaX = previousLeft - nextLeft;
      if (Math.abs(deltaX) >= 1) {
        clearRightStackLayoutAnimation();
        rightStack.style.transition = "none";
        rightStack.style.transform = `translateX(${deltaX}px)`;
        void rightStack.offsetWidth;

        rightStackAnimationFrameRef.current = window.requestAnimationFrame(() => {
          rightStackAnimationFrameRef.current = 0;
          rightStack.classList.add("is-layout-animating");
          rightStack.style.transition = "";
          rightStack.style.transform = "translateX(0)";
          rightStackAnimationTimerRef.current = window.setTimeout(() => {
            rightStackAnimationTimerRef.current = 0;
            rightStack.classList.remove("is-layout-animating");
            rightStack.style.transition = "";
            rightStack.style.transform = "";
          }, 240);
        });
      }
    }

    previousRightStackLeftRef.current = null;
    return () => {
      previousRightStackLeftRef.current = rightStackRef.current?.getBoundingClientRect().left ?? null;
    };
  }, [clearRightStackLayoutAnimation, runtimeStore.workspacePath]);

  useLayoutEffect(() => () => clearRightStackLayoutAnimation(), [clearRightStackLayoutAnimation]);

  const setMainView = (next: MainView) => {
    if (isFeatureMainView(next)) {
      appShellStore.openFeatureWorkbench(next);
      return;
    }
    appShellStore.setMainView(next);
    if (appShellStore.settingsOpen) appShellStore.closeSettings();
  };

  const toggleThreadPane = () => {
    if (appShellStore.settingsOpen || appShellStore.mainView === "flowchart") return;
    appShellStore.toggleLeftSidebarVisible();
  };

  const toggleFilesPane = async () => {
    if (!hasWorkspace || appShellStore.settingsOpen || appShellStore.mainView !== "chat") return;
    if (filesPaneVisible) {
      const confirmed = await workspaceFilesStore.prepareToHidePane();
      if (!confirmed) return;
      appShellStore.setFilesSidebarVisible(false);
      return;
    }
    appShellStore.setFilesSidebarVisible(true);
  };

  return (
    <div className="topbar-wrap">
      <header className="topbar">
        <div className="topbar-left row">
          <TopBarWorkspaceButton />

          <div className={mainViewClass} aria-label={t("topbar.mainView")}>
            {MAIN_VIEWS.map((view) => {
              const Icon = view.icon;
              const active = appShellStore.mainView === view.id;
              return (
                <button
                  key={view.id}
                  className={`topbar-mainview-btn${active ? " is-active" : ""}`}
                  type="button"
                  aria-label={t(view.labelKey)}
                  onClick={() => setMainView(view.id)}
                >
                  <Icon className="topbar-mainview-icon" aria-hidden="true" />
                  <span>{t(view.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="topbar-center-stack">
          <TopBarGoalSummary />
          <TopBarPlanSummary />
        </div>

        <div ref={rightStackRef} className="topbar-right-stack">
          <div className="row topbar-controls topbar-controls--sleek">
            <div className="control-group control-group-panes" aria-label={t("topbar.panels")}>
              <button
                id="btn-toggle-thread-pane"
                className={`btn-icon${appShellStore.leftSidebarVisible ? " is-active" : ""}`}
                type="button"
                disabled={appShellStore.settingsOpen || appShellStore.mainView === "flowchart"}
                aria-label={threadPaneTitle}
                aria-pressed={appShellStore.leftSidebarVisible}
                onClick={toggleThreadPane}
              >
                {appShellStore.leftSidebarVisible ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
              </button>
              <button
                id="btn-toggle-files-pane"
                className={`btn-icon${filesPaneVisible ? " is-active" : ""}`}
                type="button"
                disabled={!hasWorkspace || appShellStore.settingsOpen}
                aria-label={filesPaneTitle}
                aria-pressed={filesPaneVisible}
                onClick={() => void toggleFilesPane()}
              >
                {filesPaneVisible ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
              </button>
              <button
                id="btn-open-settings"
                className={`btn-icon${appShellStore.settingsOpen ? " is-active" : ""}`}
                type="button"
                aria-label={t("topbar.openSettings")}
                aria-pressed={appShellStore.settingsOpen}
                onClick={() => appShellStore.openSettings("global")}
              >
                <Settings aria-hidden="true" />
              </button>
            </div>
            <div className="topbar-control-divider" aria-hidden="true" />
            <div className="control-group control-group-actions">
              <TopBarUpdateNotice />
              <TopBarThemeSwitch />
            </div>

            <div className="control-group control-group-window">
              <TopBarWindowControls />
            </div>
          </div>
        </div>
      </header>
    </div>
  );
}
