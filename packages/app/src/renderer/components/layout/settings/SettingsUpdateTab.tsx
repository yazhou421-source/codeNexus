import { useEffect, useState } from "react";
import type { AppUpdateSnapshot } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { translate } from "../../../i18n/translate";

const DEFAULT_STATE: AppUpdateSnapshot = {
  status: "idle",
  currentVersion: "0.0.0",
  latestVersion: null,
  releaseName: null,
  releaseNotes: null,
  updateAvailable: false,
  downloaded: false,
  progress: null,
  errorMessage: null,
  checkedAt: null,
  isPackaged: false,
};

export default function SettingsUpdateTab() {
  const [state, setState] = useState<AppUpdateSnapshot>(DEFAULT_STATE);
  const [running, setRunning] = useState(false);
  const progress = Math.max(0, Math.min(100, Math.round(Number(state.progress?.percent ?? 0) || 0)));
  const disabled = running || !state.isPackaged || state.status === "checking" || state.status === "downloading";
  const actionLabel = running
    ? translate("settingsUpdate.processing")
    : state.status === "checking"
      ? translate("settingsUpdate.checking")
      : state.status === "downloading"
        ? translate("settingsUpdate.downloading")
        : state.status === "available"
          ? translate("settingsUpdate.download")
          : state.status === "downloaded"
            ? translate("settingsUpdate.install")
            : translate("settingsUpdate.check");
  const releaseSummary = [state.releaseName, state.releaseNotes].filter(Boolean).join("\n\n");

  useEffect(() => {
    let off: (() => void) | null = null;
    void (async () => {
      off = codexDesktop.app.onUpdateState(setState);
      setState(await codexDesktop.app.getUpdateState());
    })();
    return () => {
      off?.();
      off = null;
    };
  }, []);

  const primaryAction = async () => {
    if (disabled) return;
    setRunning(true);
    try {
      if (state.status === "available") {
        setState(await codexDesktop.app.downloadUpdate());
        return;
      }
      if (state.status === "downloaded") {
        await codexDesktop.app.installUpdate();
        return;
      }
      setState(await codexDesktop.app.checkForUpdates());
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="settings-card" aria-label={translate("settingsUpdate.aria")}>
      <header className="settings-card-head">
        <div className="settings-card-title">{translate("settingsUpdate.title")}</div>
        <div className="row settings-update-actions">
          <button className="btn-mini" type="button" disabled={disabled} onClick={() => void primaryAction()}>
            {actionLabel}
          </button>
        </div>
      </header>
      <div className="settings-card-body">
        <div className="settings-grid">
          <div className="settings-row">
            <span className="context-label dim">{translate("settingsUpdate.currentVersion")}</span>
            <span className="mono">{state.currentVersion}</span>
          </div>
          <div className="settings-row">
            <span className="context-label dim">{translate("settingsUpdate.latestVersion")}</span>
            <span className="mono">{state.latestVersion || translate("settingsUpdate.unknown")}</span>
          </div>
          <div className="settings-row">
            <span className="context-label dim">{translate("settingsUpdate.status")}</span>
            <span className="mono">{translate(`settingsUpdate.statuses.${state.status}`)}</span>
          </div>
          {state.status === "downloading" ? (
            <div className="settings-update-progress" aria-live="polite">
              <div className="settings-update-progress-track">
                <div className="settings-update-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="mono dim text-[12px]">{translate("settingsUpdate.progress", { percent: progress })}</div>
            </div>
          ) : null}
          {state.errorMessage ? <div className="dim text-[12px] leading-[1.25]">{state.errorMessage}</div> : null}
          {releaseSummary ? <div className="dim text-[12px] leading-[1.35] whitespace-pre-line">{releaseSummary}</div> : null}
          <div className="dim text-[12px] leading-[1.25]">{translate("settingsUpdate.description")}</div>
        </div>
      </div>
    </section>
  );
}
