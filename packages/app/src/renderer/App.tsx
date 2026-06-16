import { useEffect } from "react";
import AppRouter from "./app/AppRouter";
import AppClosingOverlay from "./components/layout/overlays/AppClosingOverlay";
import GoalShutdownCountdownOverlay from "./components/layout/overlays/GoalShutdownCountdownOverlay";
import { codexDesktop } from "./api/codexDesktopClient";
import { useAppClosingStore } from "./stores/appClosing.store";
import { useAppShellStore } from "./stores/appShell.store";
import { useGoalShutdownStore } from "./stores/goalShutdown.store";
import { useNotificationSoundStore } from "./stores/notificationSound.store";
import { useRuntimeStore } from "./stores/runtime.store";
import { useUiPrefsStore } from "./stores/uiPrefs.store";
import { useModelCatalogStore } from "./stores/modelCatalog.store";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";

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

// 应用根组件：只负责初始化副作用、全局 overlay 与顶层页面路由。
// 具体的 codex / custom 外壳分别由 CodexPage / CustomPage 拥有（见 AppRouter）。
export default function App() {
  const appShellStore = useAppShellStore();
  const appClosingStore = useAppClosingStore();
  const goalShutdownStore = useGoalShutdownStore();
  const runtimeStore = useRuntimeStore();
  const uiPrefsStore = useUiPrefsStore();
  const notificationSoundStore = useNotificationSoundStore();
  const modelCatalogStore = useModelCatalogStore();

  useEffect(() => {
    appShellStore.initLocalSettings();
    runtimeStore.initLocalDraftState();
    notificationSoundStore.initLocalSettings();
    goalShutdownStore.initLocalSettings();
    modelCatalogStore.initLocalSettings();
    appClosingStore.initBridge();
    void notificationSoundStore.refreshAvailable();
  }, []);

  useEffect(() => {
    const onWindowKeydown = (event: KeyboardEvent) => {
      if (!isToggleDebugTimelineShortcut(event)) return;
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
  }, [uiPrefsStore]);

  useEffect(() => {
    if (appClosingStore.phase !== "preparing") return;
    void runtimeStore.flushPendingComposeStateSaves().catch((error: unknown) => {
      console.warn("[App] flush pending compose state saves failed", error);
    });
  }, [appClosingStore.phase, runtimeStore]);

  return (
    <div className="app-shell">
      <AppRouter />
      <div className="app-overlays">
        {appClosingStore.visible ? <AppClosingOverlay /> : null}
        {goalShutdownStore.visible ? <GoalShutdownCountdownOverlay /> : null}
      </div>
    </div>
  );
}
