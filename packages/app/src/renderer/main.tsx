import "./tailwind.css";
import "./styles/index.css";

import { createRoot } from "react-dom/client";
import { Suspense } from "react";
import App from "./App";
import { initRuntimeOrchestrator } from "./domain/runtimeOrchestrator";
import { installFeatureRuntimeBridges, FEATURE_SETTINGS_TAB_KEYS, type AppSettingsTab } from "./features/registry";
import { loadUserLocalSettings } from "./domain/localSettings";
import { loadLocalDraftState } from "./domain/localDraftState";
import { loadLocalMessageOutbox } from "./domain/localMessageOutbox";
import { useThemeStore } from "./stores/theme.store";
import { useTypographyStore } from "./stores/typography.store";
import { useAppShellStore } from "./stores/appShell.store";
import { useRuntimeStore } from "./stores/runtime.store";
import { useMessageQueueStore } from "./stores/messageQueue.store";
import { useCodexProfilesStore } from "./stores/codexProfiles.store";
import { useCodexSkillRootsStore } from "./stores/codexSkillRoots.store";
import { showToast, type ToastKind } from "./ui/toast";

async function bootstrap() {
  const storeScope = {};
  try {
    await loadUserLocalSettings();
  } catch (error) {
    console.warn("[bootstrap] loadUserLocalSettings failed", error);
  }

  useThemeStore.getState().initTheme();
  useTypographyStore.getState().initTypography();

  const runtimeStore = useRuntimeStore.getState();
  const disposeFeatureRuntimeBridges = installFeatureRuntimeBridges({
    getWorkspacePath: () => useRuntimeStore.getState().workspacePath,
    watchWorkspacePath: (listener) => {
      listener(String(useRuntimeStore.getState().workspacePath ?? ""));
      const unsubscribe = useRuntimeStore.subscribe((state) => listener(String(state.workspacePath ?? "")));
      return unsubscribe;
    },
  });
  const messageQueueStore = useMessageQueueStore.getState();

  const [draftState, messageOutbox] = await Promise.all([loadLocalDraftState(), loadLocalMessageOutbox()]);

  runtimeStore.hydrateFromLocalDraftState(draftState);
  messageQueueStore.hydrateFromLocalMessageOutbox(messageOutbox);
  void useCodexProfilesStore.getState().refresh();
  void useCodexSkillRootsStore.getState().refresh();

  const runtime = initRuntimeOrchestrator(storeScope);
  const container = document.getElementById("app");
  if (!container) throw new Error("Missing #app mount node");
  const root = createRoot(container);
  root.render(
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );

  const appShellStore = useAppShellStore.getState();
  const handleFeatureToast = (evt: Event) => {
    const detail = (evt as CustomEvent<{ kind?: ToastKind; title?: string; message?: string }>).detail;
    const message = String(detail?.message ?? "").trim();
    if (!message) return;
    showToast({ kind: detail?.kind, title: detail?.title, message });
  };
  window.addEventListener("codenexus:toast", handleFeatureToast);
  const openSettingsTabs = new Set<AppSettingsTab>([
    "global",
    "profiles",
    "sound",
    "env",
    "integrations",
    "update",
    ...FEATURE_SETTINGS_TAB_KEYS,
  ]);
  const toOpenSettingsTab = (value: unknown): AppSettingsTab | undefined => {
    const tab = String(value ?? "").trim();
    return openSettingsTabs.has(tab as AppSettingsTab) ? (tab as AppSettingsTab) : undefined;
  };
  const handleFeatureOpenSettings = (evt: Event) => {
    const tab = toOpenSettingsTab((evt as CustomEvent<{ tab?: string }>).detail?.tab);
    appShellStore.openSettings(tab);
  };
  window.addEventListener("codenexus:open-settings", handleFeatureOpenSettings);

  const windowControlsOverlay = (navigator as any).windowControlsOverlay as
    | {
        visible?: boolean;
        getTitlebarAreaRect?: () => DOMRect;
        addEventListener?: (type: string, cb: (evt?: any) => void) => void;
      }
    | undefined;

  if (windowControlsOverlay?.addEventListener) {
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (retryTimer != null) return;
      if (retryCount >= 8) return;
      retryCount += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        applyWindowControlsPadding();
      }, 180);
    };

    const applyWindowControlsPadding = (evt?: any) => {
      if (windowControlsOverlay.visible === false) {
        document.documentElement.style.setProperty("--window-controls-pad", "0px");
        return;
      }

      const rect: DOMRect | undefined = evt?.titlebarAreaRect ?? windowControlsOverlay.getTitlebarAreaRect?.();
      if (!rect) {
        document.documentElement.style.setProperty("--window-controls-pad", "200px");
        scheduleRetry();
        return;
      }

      retryCount = 0;
      const rightPadPx = Math.max(0, Math.round(window.innerWidth - (rect.x + rect.width)));
      document.documentElement.style.setProperty("--window-controls-pad", `${rightPadPx}px`);
      if (rect.height > 0) {
        document.documentElement.style.setProperty("--topbar-h", `${Math.round(rect.height)}px`);
      }
    };

    windowControlsOverlay.addEventListener("geometrychange", applyWindowControlsPadding);
    window.addEventListener("resize", applyWindowControlsPadding);
    applyWindowControlsPadding();
  }

  window.addEventListener(
    "unload",
    () => {
      window.removeEventListener("codenexus:toast", handleFeatureToast);
      window.removeEventListener("codenexus:open-settings", handleFeatureOpenSettings);
      disposeFeatureRuntimeBridges();
      runtime.dispose();
      root.unmount();
    },
    { once: true }
  );
}

void bootstrap();
