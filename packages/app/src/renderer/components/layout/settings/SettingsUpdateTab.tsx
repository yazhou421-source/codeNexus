import { useEffect, useState } from "react";
import type { AppUpdateSnapshot } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../../../api/codexDesktopClient";

const UPDATE_STATUS_TEXT: Record<string, string> = {
  unsupported: "开发模式不可用",
  idle: "待检查",
  checking: "正在检查",
  available: "发现新版本",
  not_available: "已是最新版本",
  downloading: "正在下载",
  downloaded: "已下载，等待安装",
  error: "更新失败",
};

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
    ? "处理中..."
    : state.status === "checking"
      ? "检查中..."
      : state.status === "downloading"
        ? "下载中..."
        : state.status === "available"
          ? "下载更新"
          : state.status === "downloaded"
            ? "重启安装"
            : "检查更新";
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
    <section className="settings-card" aria-label="应用更新设置">
      <header className="settings-card-head">
        <div className="settings-card-title">应用更新</div>
        <div className="row settings-update-actions">
          <button className="btn-mini" type="button" disabled={disabled} onClick={() => void primaryAction()}>
            {actionLabel}
          </button>
        </div>
      </header>
      <div className="settings-card-body">
        <div className="settings-grid">
          <div className="settings-row">
            <span className="context-label dim">当前版本</span>
            <span className="mono">{state.currentVersion}</span>
          </div>
          <div className="settings-row">
            <span className="context-label dim">最新版本</span>
            <span className="mono">{state.latestVersion || "未知"}</span>
          </div>
          <div className="settings-row">
            <span className="context-label dim">状态</span>
            <span className="mono">{UPDATE_STATUS_TEXT[state.status] ?? state.status}</span>
          </div>
          {state.status === "downloading" ? (
            <div className="settings-update-progress" aria-live="polite">
              <div className="settings-update-progress-track">
                <div className="settings-update-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="mono dim text-[12px]">{`下载进度 ${progress}%`}</div>
            </div>
          ) : null}
          {state.errorMessage ? <div className="dim text-[12px] leading-[1.25]">{state.errorMessage}</div> : null}
          {releaseSummary ? <div className="dim text-[12px] leading-[1.35] whitespace-pre-line">{releaseSummary}</div> : null}
          <div className="dim text-[12px] leading-[1.25]">应用启动后会自动检查 GitHub Releases。发现新版本后，需要手动下载并重启安装。</div>
        </div>
      </div>
    </section>
  );
}
