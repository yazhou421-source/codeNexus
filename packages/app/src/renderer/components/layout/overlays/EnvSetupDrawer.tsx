import { useEffect, useRef, useState } from "react";
import type { CodexDiagnosticsResult } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { useAppShellStore } from "../../../stores/appShell.store";

type EnvSetupDrawerProps = {
  mode?: "drawer" | "settings";
  className?: string;
};
type DiagItem = { ok: boolean; details?: string };

function diagText(item?: DiagItem) {
  if (!item) return "未知";
  const head = item.ok ? "正常" : "缺失";
  const details = String(item.details ?? "").trim();
  return details ? `${head}\n${details}` : head;
}

function diagItemClass(ok?: boolean) {
  if (ok === true) return "is-ok";
  if (ok === false) return "is-missing";
  return "is-unknown";
}

export default function EnvSetupDrawer({ mode = "drawer", className }: EnvSetupDrawerProps) {
  const appShellStore = useAppShellStore();
  const isSettings = mode === "settings";
  const open = isSettings || appShellStore.envSetupDrawerOpen;
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<Partial<CodexDiagnosticsResult>>({});
  const [lastResultText, setLastResultText] = useState("");
  const [lastResultKind, setLastResultKind] = useState<"info" | "warn" | "error">("info");
  const hasDiagnostics = Boolean(diag.codex || diag.node || diag.npm);
  const ready = Boolean(diag.codex?.ok && diag.node?.ok && diag.npm?.ok);
  const missingNodeOrNpm = diag.node?.ok === false || diag.npm?.ok === false;
  const showManualGuide = !busy && hasDiagnostics && !ready;
  const statusChipText = busy
    ? "处理中"
    : !hasDiagnostics
      ? "待检测"
      : ready
        ? "已就绪"
        : "未就绪";
  const statusChipClass = busy || !hasDiagnostics ? "warn" : ready ? "success" : "error";
  const lastResultClass =
    lastResultKind === "error" ? "is-error" : lastResultKind === "warn" ? "is-warn" : "is-info";

  const close = () => {
    if (isSettings) return;
    appShellStore.setEnvSetupDrawerOpen(false);
  };
  const refresh = async () => {
    setBusy(true);
    setLastResultText("");
    try {
      console.info("[EnvSetup] diagnostics: start");
      const res = await codexDesktop.codexServer.getDiagnostics();
      setDiag(res);
      console.info("[EnvSetup] diagnostics:", {
        codex: res.codex.ok,
        node: res.node.ok,
        npm: res.npm.ok,
      });
    } catch (err: any) {
      const message = String(err?.message ?? err ?? "unknown error");
      setLastResultKind("error");
      setLastResultText(`检测失败：${message}`);
      console.error("[EnvSetup] diagnostics: error:", message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void refresh();
    requestAnimationFrame(() => closeBtnRef.current?.focus());
  }, [open]);

  if (!open) return null;

  const panel = (
    <section className={["global-config-drawer-panel", className].filter(Boolean).join(" ")} onClick={(event) => event.stopPropagation()}>
      <header className="global-config-drawer-head">
        <div className="panel-title">环境检测</div>
        <div className="row global-config-head-actions">
          <button className="btn-mini" type="button" disabled={busy} onClick={() => void refresh()}>
            检测
          </button>
          {!isSettings ? (
            <button ref={closeBtnRef} className="btn-mini" type="button" onClick={close}>
              关闭
            </button>
          ) : null}
        </div>
      </header>
      <div className={`global-config-drawer-body app-scrollbar${isSettings ? " is-settings" : ""}`}>
        <section className="panel">
          <div className="panel-head">
            <div className="panel-title">检测结果</div>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className={`status-chip mono ${statusChipClass}`}>{statusChipText}</span>
              {busy ? <span className="dim mono">处理中…</span> : null}
            </div>
          </div>

          <div className="env-diag-grid">
            {(["codex", "node", "npm"] as const).map((key) => (
              <div key={key} className={`env-diag-item ${diagItemClass(diag[key]?.ok)}`}>
                <div className="env-diag-key mono">{key}</div>
                <div className="env-diag-val mono">{diagText(diag[key])}</div>
              </div>
            ))}
          </div>

          {showManualGuide ? (
            <div className="env-guide">
              <div className="env-guide-title mono">手动安装指引</div>
              <div className="env-guide-body">
                <div className="env-guide-text dim">
                  {missingNodeOrNpm
                    ? "未检测到 Node.js / npm。请先安装 Node.js LTS（包含 npm）。"
                    : "未检测到 codex。请使用 npm 全局安装 @openai/codex。"}
                </div>
                <pre className="env-guide-cmd mono">npm i -g @openai/codex</pre>
                <div className="env-guide-text dim">安装后如仍显示“缺失”，建议重启终端或重启本应用，再点击“检测”。</div>
                <pre className="env-guide-cmd mono">{`node -v\nnpm -v\ncodex --version`}</pre>
              </div>
            </div>
          ) : null}

          <div className="env-runtime-hint">
            <div className="env-runtime-hint-title mono">提示</div>
            <div className="env-runtime-hint-text dim">当前环境检测只保证环境齐全（能在本机找到 codex/node/npm），不保证 codex 一定能在应用内正常启动。如果仍然无法使用，请在 CMD 中使用 codex 自检是否可以正常运行：</div>
            <pre className="env-guide-cmd mono">codex --version</pre>
          </div>

          {lastResultText ? <div className={`env-last-result mono ${lastResultClass}`}>{lastResultText}</div> : null}
          <div className="env-debug-hint mono dim">调试日志请打开开发者工具（DevTools）控制台查看。</div>
        </section>
      </div>
    </section>
  );

  if (isSettings) return <div className="global-config-drawer-overlay is-settings">{panel}</div>;
  return (
    <div
      className="global-config-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="环境检测"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="global-config-drawer-backdrop" onClick={close} />
      {panel}
    </div>
  );
}
