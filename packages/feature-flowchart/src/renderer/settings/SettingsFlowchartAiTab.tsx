import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  MAX_FLOWCHART_AI_TIMEOUT_MS,
  MIN_FLOWCHART_AI_TIMEOUT_MS,
  cloneFlowchartAiSettings,
  normalizeFlowchartAiSettings,
  resolveFlowchartAiEndpointPreview,
  type LocalFlowchartAiSettings,
} from "../../settings";
import {
  getInitialFlowchartAiSettings,
  patchFlowchartAiSettings,
  readFlowchartAiSettings,
  showFlowchartToast,
} from "../runtimeBridge";

type SettingsFlowchartAiTabProps = {
  className?: string;
  children?: ReactNode;
};

function sameSettings(a: LocalFlowchartAiSettings, b: LocalFlowchartAiSettings) {
  return JSON.stringify(normalizeFlowchartAiSettings(a)) === JSON.stringify(normalizeFlowchartAiSettings(b));
}

export default function SettingsFlowchartAiTab({ className, children }: SettingsFlowchartAiTabProps) {
  const initial = useMemo(() => cloneFlowchartAiSettings(getInitialFlowchartAiSettings()), []);
  const [snapshot, setSnapshot] = useState<LocalFlowchartAiSettings>(initial);
  const [draft, setDraft] = useState<LocalFlowchartAiSettings>(initial);
  const [saving, setSaving] = useState(false);

  const normalizedDraft = useMemo(() => normalizeFlowchartAiSettings(draft), [draft]);
  const hasChanges = useMemo(() => !sameSettings(normalizedDraft, snapshot), [normalizedDraft, snapshot]);
  const isConfigured = Boolean(normalizedDraft.enabled && normalizedDraft.baseUrl && normalizedDraft.apiKey);
  const saveButtonText = saving
    ? "保存中..."
    : hasChanges
      ? "保存配置"
      : "配置已保存";
  const statusText = !normalizedDraft.enabled
    ? "已关闭"
    : !normalizedDraft.baseUrl
      ? "缺少服务地址"
      : !normalizedDraft.apiKey
        ? "缺少 API Key"
        : "已配置";
  const endpointPreview = resolveFlowchartAiEndpointPreview(normalizedDraft.baseUrl);

  const applySnapshot = (next: LocalFlowchartAiSettings) => {
    const normalized = cloneFlowchartAiSettings(next);
    setSnapshot(normalized);
    setDraft(normalized);
  };

  useEffect(() => {
    let alive = true;
    void readFlowchartAiSettings()
      .then((settings) => {
        if (alive) applySnapshot(settings);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const patch = (value: Partial<LocalFlowchartAiSettings>) => {
    setDraft((current) => ({ ...current, ...value }));
  };

  const normalizeDraftNumbers = () => {
    setDraft((current) => ({ ...current, timeoutMs: normalizeFlowchartAiSettings(current).timeoutMs }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const nextSettings = await patchFlowchartAiSettings(normalizedDraft);
      applySnapshot(nextSettings);
      showFlowchartToast({
        kind: "success",
        title: "保存成功",
        message: "流程图 AI 配置已更新。",
      });
    } catch (error: any) {
      showFlowchartToast({
        kind: "error",
        title: "保存失败",
        message: String(error?.message ?? error ?? "unknown error"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={["settings-card", className].filter(Boolean).join(" ")} aria-label="流程图 AI 设置">
      <header className="settings-card-head">
        <div className="settings-card-title">流程图 AI</div>
        <button className="btn-mini" type="button" disabled={saving || !hasChanges} onClick={() => void onSave()}>
          {saveButtonText}
        </button>
      </header>

      <div className="settings-card-body">
        <div className="settings-grid">
          <label className="settings-row">
            <span className="context-label dim">启用</span>
            <div className="settings-inline">
              <input
                id="chk-flowchart-ai-enabled"
                type="checkbox"
                checked={draft.enabled}
                disabled={saving}
                onChange={(event) => patch({ enabled: event.currentTarget.checked })}
              />
              <span className="dim mono">{draft.enabled ? "enabled" : "disabled"}</span>
            </div>
          </label>

          <label className="settings-row">
            <span className="context-label dim">服务地址</span>
            <input
              id="inp-flowchart-ai-base-url"
              className="context-input mono"
              type="text"
              value={draft.baseUrl ?? ""}
              placeholder="https://api.example.com/v1"
              disabled={saving}
              onChange={(event) => patch({ baseUrl: event.currentTarget.value })}
            />
          </label>

          <label className="settings-row">
            <span className="context-label dim">API Key</span>
            <input
              id="inp-flowchart-ai-api-key"
              className="context-input mono"
              type="password"
              autoComplete="off"
              value={draft.apiKey ?? ""}
              placeholder="sk-..."
              disabled={saving}
              onChange={(event) => patch({ apiKey: event.currentTarget.value })}
            />
          </label>

          <label className="settings-row">
            <span className="context-label dim">模型</span>
            <input
              id="inp-flowchart-ai-model"
              className="context-input mono"
              type="text"
              value={draft.model}
              placeholder="gpt-4o-mini"
              disabled={saving}
              onChange={(event) => patch({ model: event.currentTarget.value })}
            />
          </label>

          <label className="settings-row">
            <span className="context-label dim">超时</span>
            <div className="settings-inline">
              <input
                id="inp-flowchart-ai-timeout"
                className="context-input mono"
                type="number"
                min={MIN_FLOWCHART_AI_TIMEOUT_MS}
                max={MAX_FLOWCHART_AI_TIMEOUT_MS}
                step={1000}
                value={draft.timeoutMs}
                disabled={saving}
                onBlur={normalizeDraftNumbers}
                onChange={(event) => patch({ timeoutMs: Number(event.currentTarget.value) })}
              />
              <span className="dim mono">ms</span>
            </div>
          </label>

          <div className={`status-panel${isConfigured ? " is-ready" : ""}${!normalizedDraft.enabled ? " is-disabled" : ""}`}>
            <div className="status-row">
              <span className="dim">状态</span>
              <span className="mono">{statusText}</span>
            </div>
            <div className="status-row">
              <span className="dim">请求端点</span>
              <span className="mono">{endpointPreview}</span>
            </div>
            <div className="status-row">
              <span className="dim">模式</span>
              <span className="mono">generate / modify</span>
            </div>
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}
