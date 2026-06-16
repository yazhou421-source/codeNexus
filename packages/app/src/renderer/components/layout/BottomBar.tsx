import { useEffect, useMemo, useState } from "react";
import { useAppShellStore } from "../../stores/appShell.store";
import CodexProfileSwitch from "./controls/CodexProfileSwitch";

function formatMinute(value: number) {
  const dt = new Date(value);
  const yyyy = String(dt.getFullYear());
  const MM = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
}

export default function BottomBar() {
  const appShellStore = useAppShellStore();
  const [now, setNow] = useState(Date.now());
  const isCustomMode = appShellStore.runtimeMode === "custom";

  useEffect(() => {
    let timerId: number | null = null;
    const tick = () => {
      setNow(Date.now());
      timerId = window.setTimeout(tick, Math.max(16, 60_000 - (Date.now() % 60_000) + 16));
    };
    tick();
    return () => {
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, []);

  const connectionLabel = useMemo(() => {
    if (appShellStore.serverConnState === "connected") return "已连接";
    if (appShellStore.serverConnState === "connecting") return "连接中";
    if (appShellStore.serverConnState === "failed") return "失败";
    return "离线";
  }, [appShellStore.serverConnState]);

  return (
    <footer className="bottom-bar" role="navigation" aria-label="底部栏">
      <div className="bottom-bar__left">
        <button className="bottom-bar__mode-switch mono" type="button" title="切换运行模式" onClick={() => appShellStore.openModeChooser()}>
          {isCustomMode ? "自定义模式" : "Codex 模式"}
        </button>
        {!isCustomMode ? <CodexProfileSwitch className="bottom-bar__profile-switch" /> : null}
      </div>
      <div className="bottom-bar__right">
        {!isCustomMode ? (
          <div className={`bottom-bar__conn mono is-${appShellStore.serverConnState}`}>
            <span className="bottom-bar__conn-icon" aria-hidden="true">
              <span className="bottom-bar__conn-dot" />
            </span>
            <span className="bottom-bar__conn-text">{connectionLabel}</span>
          </div>
        ) : null}
        <div className="bottom-bar__clock mono dim" aria-label={`当前时间 ${formatMinute(now)}`}>
          {formatMinute(now)}
        </div>
      </div>
    </footer>
  );
}
