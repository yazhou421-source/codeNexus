import "./imagegen-workbench.css";

import { Settings2, Trash2, Upload, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { openImagegenSettings } from "../runtimeBridge";
import { useImageWorkbenchStore, type ImageWorkbenchHistoryItem } from "../store";

type ImageSettingsSidebarProps = {
  className?: string;
  children?: ReactNode;
};

const qualityLevels = [
  { value: "auto", labelKey: "imageSidebar.auto" },
  { value: "low", labelKey: "imageSidebar.low" },
  { value: "medium", labelKey: "imageSidebar.medium" },
  { value: "high", labelKey: "imageSidebar.high" },
] as const;

function hasFileDragData(event: DragEvent | globalThis.DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export default function ImageSettingsSidebar({ className, children }: ImageSettingsSidebarProps) {
  const { t, i18n } = useTranslation();
  const workbench = useImageWorkbenchStore();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const maskInputRef = useRef<HTMLInputElement | null>(null);
  const [isWindowFileDragging, setIsWindowFileDragging] = useState(false);
  const windowFileDragDepth = useRef(0);
  const dropzoneDragDepth = useRef(0);
  const selectedHistoryItem = workbench.selectedHistoryItem;
  const qualityIndex = Math.max(0, qualityLevels.findIndex((item) => item.value === workbench.quality));
  const selectedQualityLabel = t(qualityLevels[qualityIndex]?.labelKey ?? "imageSidebar.auto");

  const resetFileDragState = () => {
    windowFileDragDepth.current = 0;
    dropzoneDragDepth.current = 0;
    setIsWindowFileDragging(false);
    workbench.stopDrag();
  };

  const onPickImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = input.files;
    if (!files || files.length === 0) return;
    await workbench.appendFiles(files);
    input.value = "";
  };

  const onPickMask = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    await workbench.setMaskFromFile(file);
    input.value = "";
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    resetFileDragState();
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;
    await workbench.appendFiles(files);
  };

  const onDropzoneDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDragData(event)) return;
    event.preventDefault();
    dropzoneDragDepth.current += 1;
    useImageWorkbenchStore.setState({ dragActive: true });
    event.dataTransfer.dropEffect = "copy";
  };

  const onDropzoneDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDragData(event)) return;
    dropzoneDragDepth.current = Math.max(0, dropzoneDragDepth.current - 1);
    if (dropzoneDragDepth.current === 0) workbench.stopDrag();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDragData(event)) return;
    useImageWorkbenchStore.setState({ dragActive: true });
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onQualityInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const index = Math.max(0, Math.min(qualityLevels.length - 1, Math.round(Number(event.currentTarget.value ?? 0))));
    useImageWorkbenchStore.setState({ quality: qualityLevels[index]?.value ?? "auto" });
  };

  const formatDateTime = (value: number) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const formatHistoryParams = (item: ImageWorkbenchHistoryItem) => {
    const modeText = item.mode === "edit" ? t("imageWorkbench.editMode") : t("imageWorkbench.textMode");
    return [modeText, item.quality].filter(Boolean).join(" / ") || "auto";
  };

  useEffect(() => {
    const onWindowDragEnter = (event: globalThis.DragEvent) => {
      if (!hasFileDragData(event)) return;
      windowFileDragDepth.current += 1;
      setIsWindowFileDragging(true);
    };
    const onWindowDragOver = (event: globalThis.DragEvent) => {
      if (!hasFileDragData(event)) return;
      setIsWindowFileDragging(true);
    };
    const onWindowDragLeave = (event: globalThis.DragEvent) => {
      if (!hasFileDragData(event)) return;
      windowFileDragDepth.current = Math.max(0, windowFileDragDepth.current - 1);
      if (windowFileDragDepth.current === 0) setIsWindowFileDragging(false);
    };
    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", resetFileDragState);
    window.addEventListener("dragend", resetFileDragState);
    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", resetFileDragState);
      window.removeEventListener("dragend", resetFileDragState);
      resetFileDragState();
    };
  }, []);

  return (
    <aside className={["sidebar", "sidebar-right", "image-settings-sidebar", className].filter(Boolean).join(" ")} aria-label={t("imageSidebar.aria")}>
      <header className="image-settings-sidebar__header">
        <div>
          <div className="image-settings-sidebar__eyebrow">Images</div>
          <h2 className="image-settings-sidebar__title">{t("imageSidebar.title")}</h2>
        </div>
        <button className="btn-mini" type="button" onClick={openImagegenSettings}>
          <Settings2 className="btn-mini__icon" aria-hidden="true" />
          <span>API</span>
        </button>
      </header>

      <div className="image-settings-sidebar__scroll app-scrollbar">
        <div className="image-workbench__control-grid">
          <div className="image-workbench__prompt-quality">
            <label className="image-workbench__field image-workbench__field--full">
              <span className="image-workbench__label">{t("imageSidebar.prompt")}</span>
              <textarea
                className="image-workbench__textarea context-input mono"
                rows={8}
                value={workbench.prompt}
                placeholder={t("imageSidebar.promptPlaceholder")}
                onChange={(event) => useImageWorkbenchStore.setState({ prompt: event.currentTarget.value })}
              />
            </label>

            <div className="image-workbench__quality-panel">
              <div className="image-workbench__quality-head">
                <span>{t("imageSidebar.quality")}</span>
                <span className="mono">{selectedQualityLabel}</span>
              </div>
              <div className="image-workbench__quality-body">
                <div className="image-workbench__quality-labels" aria-hidden="true">
                  <span>{t("imageSidebar.high")}</span>
                  <span>{t("imageSidebar.medium")}</span>
                  <span>{t("imageSidebar.low")}</span>
                  <span>{t("imageSidebar.auto")}</span>
                </div>
                <input
                  className="image-workbench__quality-slider"
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={qualityIndex}
                  aria-label={t("imageSidebar.imageQuality")}
                  aria-valuetext={selectedQualityLabel}
                  onChange={onQualityInput}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="image-workbench__attachments">
          <div className="image-workbench__attachments-head">
            <span>{t("imageSidebar.references")}</span>
            <span className="mono">{workbench.inputImages.length} / 4</span>
          </div>

          <div
            className={`image-workbench__dropzone${isWindowFileDragging ? " is-file-dragging" : ""}${workbench.dragActive ? " is-dragging" : ""}`}
            onDragEnter={onDropzoneDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDropzoneDragLeave}
            onDrop={(event) => void onDrop(event)}
          >
            <input ref={imageInputRef} className="image-workbench__file" type="file" accept="image/*" multiple onChange={(event) => void onPickImages(event)} />
            <button className="image-workbench__dropzone-btn" type="button" onClick={() => imageInputRef.current?.click()}>
              <Upload className="btn-mini__icon" aria-hidden="true" />
              <span>{t("imageSidebar.addReference")}</span>
            </button>
            <div className="image-workbench__dropzone-hint">{t("imageSidebar.referenceHint")}</div>
          </div>

          {workbench.inputImages.length ? (
            <div className="image-workbench__thumb-grid">
              {workbench.inputImages.map((image) => (
                <div key={image.id} className="image-workbench__thumb">
                  <img src={image.dataUrl} alt={image.name} />
                  <div className="image-workbench__thumb-meta">
                    <span className="image-workbench__thumb-name">{image.name}</span>
                    <button className="btn-mini" type="button" onClick={() => workbench.removeInputImage(image.id)}>
                      <Trash2 className="btn-mini__icon" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {workbench.inputImages.length ? (
            <div className="image-workbench__mask-row">
              <div className="image-workbench__mask-copy">
                <div className="image-workbench__label">{t("imageSidebar.maskTitle")}</div>
                <div className="dim">{t("imageSidebar.maskDesc")}</div>
              </div>
              <div className="image-workbench__mask-actions">
                <input ref={maskInputRef} className="image-workbench__file" type="file" accept="image/*" onChange={(event) => void onPickMask(event)} />
                <button className="btn-mini" type="button" onClick={() => maskInputRef.current?.click()}>
                  <Upload className="btn-mini__icon" aria-hidden="true" />
                  <span>{workbench.maskDataUrl ? t("imageSidebar.replace") : t("imageSidebar.choose")}</span>
                </button>
                <button className="btn-mini" type="button" disabled={!workbench.maskDataUrl} onClick={() => workbench.clearMask()}>
                  <X className="btn-mini__icon" aria-hidden="true" />
                  <span>{t("imageSidebar.clear")}</span>
                </button>
              </div>
            </div>
          ) : null}

          {workbench.inputImages.length && workbench.maskDataUrl ? (
            <div className="image-workbench__mask-preview">
              <img src={workbench.maskDataUrl} alt={t("imageSidebar.maskPreviewAlt")} />
            </div>
          ) : null}
        </div>

        {workbench.errorText ? <div className="image-workbench__error mono">{workbench.errorText}</div> : null}

        <button className="image-settings-sidebar__generate" type="button" disabled={!workbench.canGenerate} onClick={() => void workbench.generate()}>
          <Wand2 className="btn-mini__icon" aria-hidden="true" />
          <span>{t("imageSidebar.generate")}</span>
        </button>

        {selectedHistoryItem ? (
          <section className="image-settings-sidebar__section">
            <div className="image-settings-sidebar__section-head">
              <span>{t("imageSidebar.currentRecord")}</span>
              <button className="btn-mini btn-mini--danger" type="button" onClick={() => void workbench.deleteHistoryItem(selectedHistoryItem.id)}>
                <Trash2 className="btn-mini__icon" aria-hidden="true" />
                <span>{t("imageWorkbench.delete")}</span>
              </button>
            </div>
            <div className="image-settings-sidebar__detail">
              <div className="image-settings-sidebar__detail-row">
                <span>{t("imageSidebar.model")}</span>
                <span className="mono">{selectedHistoryItem.model}</span>
              </div>
              <div className="image-settings-sidebar__detail-row">
                <span>{t("imageSidebar.params")}</span>
                <span className="mono">{formatHistoryParams(selectedHistoryItem)}</span>
              </div>
              <div className="image-settings-sidebar__detail-row">
                <span>{t("imageSidebar.time")}</span>
                <span className="mono">{formatDateTime(selectedHistoryItem.createdAt)}</span>
              </div>
              <div className="image-settings-sidebar__prompt-block">
                <div className="image-workbench__label">{t("imageSidebar.prompt")}</div>
                <p className="app-scrollbar">{selectedHistoryItem.prompt}</p>
              </div>
              {selectedHistoryItem.revisedPrompt ? (
                <div className="image-settings-sidebar__prompt-block">
                  <div className="image-workbench__label">{t("imageSidebar.revisedPrompt")}</div>
                  <p className="app-scrollbar">{selectedHistoryItem.revisedPrompt}</p>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {children}
      </div>
    </aside>
  );
}
