import { useAppShellStore } from "../../stores/appShell.store";
import type { RuntimeMode } from "@codenexus/shared/localSettings";

export default function RuntimeModeChooser() {
  const appShellStore = useAppShellStore();
  const canCancel = appShellStore.runtimeMode !== null;
  const choose = (mode: RuntimeMode) => appShellStore.setRuntimeMode(mode);

  return (
    <div className="mode-chooser" role="dialog" aria-modal="true" aria-labelledby="runtime-mode-chooser-title">
      <div className="mode-chooser__panel">
        <header className="mode-chooser__head">
          <h1 id="runtime-mode-chooser-title">选择运行模式</h1>
          <p>CodeNexus 正在逐步脱离 codex-app-server。你可以继续使用稳定的旧版，或体验直连自定义 provider 的新版。</p>
        </header>
        <div className="mode-chooser__cards">
          <button className="mode-card" type="button" onClick={() => choose("codex")}>
            <span className="mode-card__badge">稳定</span>
            <h2>旧版 · Codex App Server</h2>
            <p>通过本地 codex app-server 运行，拥有完整的审批 / 工作区 / MCP / 技能能力。</p>
          </button>
          <button className="mode-card mode-card--accent" type="button" onClick={() => choose("custom")}>
            <span className="mode-card__badge">实验</span>
            <h2>新版 · 自定义 Provider</h2>
            <p>直连 OpenAI 兼容接口（Claude / Gemini 后续支持），不依赖 codex-app-server。</p>
          </button>
        </div>
        {canCancel ? (
          <footer className="mode-chooser__foot">
            <button className="mode-chooser__cancel" type="button" onClick={() => appShellStore.closeModeChooser()}>
              取消
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
