import { useMemo, useState } from "react";
import {
  MAX_IMAGE_GENERATION_MAX_IMAGES,
  MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION,
  MAX_IMAGE_GENERATION_TIMEOUT_MS,
  MIN_IMAGE_GENERATION_MAX_IMAGES,
  MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION,
  MIN_IMAGE_GENERATION_TIMEOUT_MS,
  cloneImageGenerationSettings,
  normalizeImageGenerationSettings,
  resolveImageGenerationEndpointPreview,
  type LocalImageGenerationSettings,
} from "@codenexus/feature-imagegen/settings";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../../../domain/localSettings";
import { showToast } from "../../../ui/toast";

function clampNumber(value: unknown, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export default function SettingsImageGenerationTab() {
  const initial = useMemo(() => cloneImageGenerationSettings(getCachedUserLocalSettings().settings.imageGeneration), []);
  const [snapshot, setSnapshot] = useState<LocalImageGenerationSettings>(initial);
  const [draft, setDraft] = useState<LocalImageGenerationSettings>(initial);
  const [saving, setSaving] = useState(false);
  const normalized = normalizeImageGenerationSettings(draft);
  const dirty = JSON.stringify(normalized) !== JSON.stringify(snapshot);
  const configured = Boolean(normalized.enabled && normalized.baseUrl && normalized.apiKey);
  const saveButtonText = saving
    ? "保存中..."
    : dirty
      ? "保存配置"
      : "配置已保存";
  const statusText = !normalized.enabled
    ? "已关闭"
    : !normalized.baseUrl
      ? "缺少服务地址"
      : !normalized.apiKey
        ? "缺少 API Key"
        : "已配置";
  const patch = (next: Partial<LocalImageGenerationSettings>) => setDraft((prev) => ({ ...prev, ...next }));
  const normalizeDraftNumbers = () => {
    const next = normalizeImageGenerationSettings(draft);
    patch({
      outputCompression: next.outputCompression,
      timeoutMs: next.timeoutMs,
      maxImages: next.maxImages,
    });
  };
  const save = async () => {
    setSaving(true);
    try {
      const result = await patchUserLocalSettings({ imageGeneration: normalized });
      const next = cloneImageGenerationSettings(result.settings.imageGeneration);
      setSnapshot(next);
      setDraft(next);
      showToast({
        kind: "success",
        title: "保存成功",
        message: "图片生成配置已更新。",
      });
    } catch (error: any) {
      showToast({
        kind: "error",
        title: "保存失败",
        message: String(error?.message ?? error ?? "unknown error"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-card" aria-label="图片生成设置">
      <header className="settings-card-head">
        <div className="settings-card-title">图片生成</div>
        <button className="btn-mini" type="button" disabled={saving || !dirty} onClick={() => void save()}>
          {saveButtonText}
        </button>
      </header>
      <div className="settings-card-body">
        <div className="settings-grid">
          <label className="settings-row">
            <span className="context-label dim">启用</span>
            <div className="settings-inline">
              <input
                id="chk-image-generation-enabled"
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
              id="inp-image-generation-base-url"
              className="context-input mono"
              type="text"
              value={draft.baseUrl ?? ""}
              disabled={saving}
              placeholder="https://api.example.com/v1"
              onChange={(event) => patch({ baseUrl: event.currentTarget.value })}
            />
          </label>
          <label className="settings-row">
            <span className="context-label dim">API Key</span>
            <input
              id="inp-image-generation-api-key"
              className="context-input mono"
              type="password"
              autoComplete="off"
              value={draft.apiKey ?? ""}
              disabled={saving}
              placeholder="sk-..."
              onChange={(event) => patch({ apiKey: event.currentTarget.value })}
            />
          </label>
          <label className="settings-row">
            <span className="context-label dim">模型</span>
            <input
              id="inp-image-generation-model"
              className="context-input mono"
              type="text"
              value={draft.model ?? ""}
              disabled={saving}
              placeholder="gpt-image-2"
              onChange={(event) => patch({ model: event.currentTarget.value })}
            />
          </label>
          <label className="settings-row">
            <span className="context-label dim">默认尺寸</span>
            <select
              id="sel-image-generation-size"
              className="context-input mono"
              value={draft.defaultSize}
              disabled={saving}
              onChange={(event) => patch({ defaultSize: event.currentTarget.value as any })}
            >
              {["1024x1024", "1024x1536", "1536x1024", "auto"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span className="context-label dim">默认质量</span>
            <select
              id="sel-image-generation-quality"
              className="context-input mono"
              value={draft.defaultQuality}
              disabled={saving}
              onChange={(event) => patch({ defaultQuality: event.currentTarget.value as any })}
            >
              {["auto", "low", "medium", "high"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span className="context-label dim">输出格式</span>
            <select
              id="sel-image-generation-output-format"
              className="context-input mono"
              value={draft.outputFormat}
              disabled={saving}
              onChange={(event) => patch({ outputFormat: event.currentTarget.value as any })}
            >
              {["png", "jpeg", "webp"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span className="context-label dim">默认背景</span>
            <select
              id="sel-image-generation-background"
              className="context-input mono"
              value={draft.defaultBackground}
              disabled={saving}
              onChange={(event) => patch({ defaultBackground: event.currentTarget.value as any })}
            >
              {["auto", "transparent", "opaque"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span className="context-label dim">审核级别</span>
            <select
              id="sel-image-generation-moderation"
              className="context-input mono"
              value={draft.defaultModeration}
              disabled={saving}
              onChange={(event) => patch({ defaultModeration: event.currentTarget.value as any })}
            >
              {["auto", "low"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span className="context-label dim">输出压缩</span>
            <div className="settings-inline">
              <input
                id="inp-image-generation-output-compression"
                className="context-input mono"
                type="number"
                min={MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION}
                max={MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION}
                step="1"
                value={draft.outputCompression}
                disabled={saving}
                onChange={(event) =>
                  patch({
                    outputCompression: clampNumber(
                      event.currentTarget.value,
                      MIN_IMAGE_GENERATION_OUTPUT_COMPRESSION,
                      MAX_IMAGE_GENERATION_OUTPUT_COMPRESSION
                    ),
                  })
                }
                onBlur={normalizeDraftNumbers}
              />
              <span className="dim mono">jpeg/webp</span>
            </div>
          </label>
          <label className="settings-row">
            <span className="context-label dim">超时</span>
            <div className="settings-inline">
              <input
                id="inp-image-generation-timeout"
                className="context-input mono"
                type="number"
                min={MIN_IMAGE_GENERATION_TIMEOUT_MS}
                max={MAX_IMAGE_GENERATION_TIMEOUT_MS}
                step="1000"
                value={draft.timeoutMs}
                disabled={saving}
                onChange={(event) =>
                  patch({
                    timeoutMs: clampNumber(
                      event.currentTarget.value,
                      MIN_IMAGE_GENERATION_TIMEOUT_MS,
                      MAX_IMAGE_GENERATION_TIMEOUT_MS
                    ),
                  })
                }
                onBlur={normalizeDraftNumbers}
              />
              <span className="dim mono">ms</span>
            </div>
          </label>
          <label className="settings-row">
            <span className="context-label dim">图片数量</span>
            <div className="settings-inline">
              <input
                id="inp-image-generation-max-images"
                className="context-input mono"
                type="number"
                min={MIN_IMAGE_GENERATION_MAX_IMAGES}
                max={MAX_IMAGE_GENERATION_MAX_IMAGES}
                step="1"
                value={draft.maxImages}
                disabled={saving}
                onChange={(event) =>
                  patch({
                    maxImages: clampNumber(event.currentTarget.value, MIN_IMAGE_GENERATION_MAX_IMAGES, MAX_IMAGE_GENERATION_MAX_IMAGES),
                  })
                }
                onBlur={normalizeDraftNumbers}
              />
              <span className="dim mono">max</span>
            </div>
          </label>
          <div className={`status-panel${configured ? " is-ready" : ""}${!normalized.enabled ? " is-disabled" : ""}`}>
            <div className="status-row">
              <span className="dim">状态</span>
              <span className="mono">{statusText}</span>
            </div>
            <div className="status-row">
              <span className="dim">模式</span>
              <span className="mono">generate / edit</span>
            </div>
            <div className="status-row">
              <span className="dim">生成</span>
              <span className="mono">{resolveImageGenerationEndpointPreview(normalized.baseUrl, "generations")}</span>
            </div>
            <div className="status-row">
              <span className="dim">编辑</span>
              <span className="mono">{resolveImageGenerationEndpointPreview(normalized.baseUrl, "edits")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
