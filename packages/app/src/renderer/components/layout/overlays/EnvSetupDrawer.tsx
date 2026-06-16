import { useEffect, useRef, useState } from "react";
import type { CodexDiagnosticsResult } from "@codenexus/shared/ipc/contracts";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { translate } from "../../../i18n/translate";
import { useAppShellStore } from "../../../stores/appShell.store";

type EnvSetupDrawerProps = {
  mode?: "drawer" | "settings";
  className?: string;
};
type DiagItem = { ok: boolean; details?: string };

function diagText(item?: DiagItem) {
  if (!item) return translate("envSetup.unknown");
  const head = item.ok ? translate("envSetup.ok") : translate("envSetup.missing");
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
    ? translate("envSetup.processing")
    : !hasDiagnostics
      ? translate("envSetup.pending")
      : ready
        ? translate("envSetup.ready")
        : translate("envSetup.notReady");
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
      setLastResultText(translate("envSetup.checkFailed", { message }));
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
        <div className="panel-title">{translate("envSetup.title")}</div>
        <div className="row global-config-head-actions">
          <button className="btn-mini" type="button" disabled={busy} onClick={() => void refresh()}>
            {translate("envSetup.check")}
          </button>
          {!isSettings ? (
            <button ref={closeBtnRef} className="btn-mini" type="button" onClick={close}>
              {translate("common.close")}
            </button>
          ) : null}
        </div>
      </header>
      <div className={`global-config-drawer-body app-scrollbar${isSettings ? " is-settings" : ""}`}>
        <section className="panel">
          <div className="panel-head">
            <div className="panel-title">{translate("envSetup.results")}</div>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className={`status-chip mono ${statusChipClass}`}>{statusChipText}</span>
              {busy ? <span className="dim mono">{translate("envSetup.processingLong")}</span> : null}
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
              <div className="env-guide-title mono">{translate("envSetup.manualGuideTitle")}</div>
              <div className="env-guide-body">
                <div className="env-guide-text dim">
                  {missingNodeOrNpm ? translate("envSetup.missingNodeOrNpm") : translate("envSetup.missingCodex")}
                </div>
                <pre className="env-guide-cmd mono">npm i -g @openai/codex</pre>
                <div className="env-guide-text dim">{translate("envSetup.afterInstallHint")}</div>
                <pre className="env-guide-cmd mono">{`node -v\nnpm -v\ncodex --version`}</pre>
              </div>
            </div>
          ) : null}

          <div className="env-runtime-hint">
            <div className="env-runtime-hint-title mono">{translate("envSetup.hintTitle")}</div>
            <div className="env-runtime-hint-text dim">{translate("envSetup.runtimeHint")}</div>
            <pre className="env-guide-cmd mono">codex --version</pre>
          </div>

          {lastResultText ? <div className={`env-last-result mono ${lastResultClass}`}>{lastResultText}</div> : null}
          <div className="env-debug-hint mono dim">{translate("envSetup.debugHint")}</div>
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
      aria-label={translate("envSetup.aria")}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="global-config-drawer-backdrop" onClick={close} />
      {panel}
    </div>
  );
}
