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
import { translate } from "../../../i18n/translate";
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
    ? translate("settingsImageGeneration.saving")
    : dirty
      ? translate("settingsImageGeneration.saveConfig")
      : translate("settingsImageGeneration.configSaved");
  const statusText = !normalized.enabled
    ? translate("settingsImageGeneration.disabled")
    : !normalized.baseUrl
      ? translate("settingsImageGeneration.missingServiceUrl")
      : !normalized.apiKey
        ? translate("settingsImageGeneration.missingApiKey")
        : translate("settingsImageGeneration.configured");
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
        title: translate("settingsImageGeneration.saveSuccessTitle"),
        message: translate("settingsImageGeneration.saveSuccessMessage"),
      });
    } catch (error: any) {
      showToast({
        kind: "error",
        title: translate("settingsImageGeneration.saveFailedTitle"),
        message: String(error?.message ?? error ?? "unknown error"),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-card" aria-label={translate("settingsImageGeneration.aria")}>
      <header className="settings-card-head">
        <div className="settings-card-title">{translate("settingsImageGeneration.title")}</div>
        <button className="btn-mini" type="button" disabled={saving || !dirty} onClick={() => void save()}>
          {saveButtonText}
        </button>
      </header>
      <div className="settings-card-body">
        <div className="settings-grid">
          <label className="settings-row">
            <span className="context-label dim">{translate("settingsImageGeneration.enable")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.serviceUrl")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.model")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.defaultSize")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.defaultQuality")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.outputFormat")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.defaultBackground")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.moderation")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.outputCompression")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.timeout")}</span>
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
            <span className="context-label dim">{translate("settingsImageGeneration.imageCount")}</span>
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
              <span className="dim">{translate("settingsImageGeneration.status")}</span>
              <span className="mono">{statusText}</span>
            </div>
            <div className="status-row">
              <span className="dim">{translate("settingsImageGeneration.mode")}</span>
              <span className="mono">generate / edit</span>
            </div>
            <div className="status-row">
              <span className="dim">{translate("settingsImageGeneration.generate")}</span>
              <span className="mono">{resolveImageGenerationEndpointPreview(normalized.baseUrl, "generations")}</span>
            </div>
            <div className="status-row">
              <span className="dim">{translate("settingsImageGeneration.edit")}</span>
              <span className="mono">{resolveImageGenerationEndpointPreview(normalized.baseUrl, "edits")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
