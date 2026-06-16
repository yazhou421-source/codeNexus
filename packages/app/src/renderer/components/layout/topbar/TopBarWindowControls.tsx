import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppWindowState } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { useAppClosingStore } from "../../../stores/appClosing.store";

const DEFAULT_WINDOW_STATE: AppWindowState = {
  isMaximized: false,
  isMinimized: false,
  isFullScreen: false,
};

export default function TopBarWindowControls() {
  const { t } = useTranslation();
  const appClosingStore = useAppClosingStore();
  const [windowState, setWindowState] = useState<AppWindowState>(DEFAULT_WINDOW_STATE);
  const [closeInFlight, setCloseInFlight] = useState(false);
  const closeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windowExpanded = windowState.isMaximized || windowState.isFullScreen;

  const clearCloseResetTimer = useMemo(
    () => () => {
      if (!closeResetTimerRef.current) return;
      clearTimeout(closeResetTimerRef.current);
      closeResetTimerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      try {
        setWindowState(await codexDesktop.window.getState());
      } catch {}
    })();

    let stopWindowStateListener: (() => void) | null = null;
    try {
      stopWindowStateListener = codexDesktop.window.onState(setWindowState);
    } catch {}

    return () => {
      try {
        stopWindowStateListener?.();
      } catch {}
      clearCloseResetTimer();
    };
  }, [clearCloseResetTimer]);

  useEffect(() => {
    if (appClosingStore.visible) {
      clearCloseResetTimer();
      return;
    }
    setCloseInFlight(false);
  }, [appClosingStore.visible, clearCloseResetTimer]);

  function scheduleCloseReset() {
    clearCloseResetTimer();
    closeResetTimerRef.current = setTimeout(() => {
      closeResetTimerRef.current = null;
      if (!useAppClosingStore.getState().visible) setCloseInFlight(false);
    }, 2_500);
  }

  function onWindowMinimize() {
    void codexDesktop.window.minimize().catch((error) => {
      console.warn("[TopBarWindowControls] window minimize failed", error);
    });
  }

  function onWindowToggleMaximize() {
    void codexDesktop.window.toggleMaximize().catch((error) => {
      console.warn("[TopBarWindowControls] window maximize toggle failed", error);
    });
  }

  function onWindowClose() {
    if (closeInFlight || appClosingStore.visible) return;
    setCloseInFlight(true);
    void codexDesktop.window
      .close()
      .then(() => {
        scheduleCloseReset();
      })
      .catch((error) => {
        clearCloseResetTimer();
        setCloseInFlight(false);
        console.warn("[TopBarWindowControls] window close failed", error);
      });
  }

  return (
    <>
      <button id="btn-window-minimize" className="btn-icon" type="button" aria-label={t("topbarExtra.minimize")} onClick={onWindowMinimize}>
        <Minus aria-hidden="true" />
      </button>
      <button
        id="btn-window-maximize"
        className="btn-icon"
        type="button"
        aria-label={windowExpanded ? t("topbarExtra.restore") : t("topbarExtra.maximize")}
        onClick={onWindowToggleMaximize}
      >
        {windowExpanded ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}
      </button>
      <button
        id="btn-window-close"
        className="btn-icon danger"
        type="button"
        disabled={closeInFlight || appClosingStore.visible}
        aria-label={t("topbarExtra.close")}
        onClick={onWindowClose}
      >
        <X aria-hidden="true" />
      </button>
    </>
  );
}
