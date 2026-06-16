import { Download, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppUpdateSnapshot } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../../../api/codexDesktopClient";

type TopBarUpdateNoticeProps = {
  className?: string;
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

function clampProgressPercent(value: unknown) {
  const percent = Number(value ?? 0);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export default function TopBarUpdateNotice({ className }: TopBarUpdateNoticeProps) {
  const [state, setState] = useState<AppUpdateSnapshot>(DEFAULT_STATE);
  const [actionRunning, setActionRunning] = useState(false);
  const visible = state.status === "available" || state.status === "downloading" || state.status === "downloaded";
  const progressPercent = clampProgressPercent(state.progress?.percent);

  useEffect(() => {
    let off: (() => void) | null = null;
    let mounted = true;
    void (async () => {
      off = codexDesktop.app.onUpdateState((next) => {
        if (mounted) setState(next);
      });
      const snapshot = await codexDesktop.app.getUpdateState();
      if (mounted) setState(snapshot);
    })();
    return () => {
      mounted = false;
      off?.();
    };
  }, []);

  const label = useMemo(() => {
    if (state.status === "downloading") return `下载中 ${progressPercent}%`;
    if (state.status === "downloaded") return "重启安装";
    return "检测到新版本";
  }, [progressPercent, state.status]);

  const ariaLabel = useMemo(() => {
    const version = String(state.latestVersion ?? "").trim();
    if (state.status === "downloaded") return "更新已下载，点击重启安装";
    if (state.status === "downloading") return `更新下载中，进度 ${progressPercent}%`;
    return version ? `检测到新版本 ${version}，点击下载更新` : "检测到新版本，点击下载更新";
  }, [progressPercent, state.latestVersion, state.status]);

  async function onClick() {
    if (actionRunning || state.status === "downloading") return;
    setActionRunning(true);
    try {
      if (state.status === "downloaded") {
        await codexDesktop.app.installUpdate();
        return;
      }
      if (state.status === "available") {
        setState(await codexDesktop.app.downloadUpdate());
      }
    } finally {
      setActionRunning(false);
    }
  }

  if (!visible) return null;

  const NoticeIcon = state.status === "downloaded" ? RotateCcw : state.status === "downloading" ? LoaderCircle : Download;

  return (
    <button
      className={[
        "topbar-update-notice",
        state.status === "downloading" ? "is-downloading" : "",
        state.status === "downloaded" ? "is-downloaded" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      disabled={actionRunning || state.status === "downloading"}
      aria-label={ariaLabel}
      onClick={() => void onClick()}
    >
      <NoticeIcon className="topbar-update-notice__icon" aria-hidden="true" />
      <span className="topbar-update-notice__text" aria-live="polite">
        {label}
      </span>
    </button>
  );
}
