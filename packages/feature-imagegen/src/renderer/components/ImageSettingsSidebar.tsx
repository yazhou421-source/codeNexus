import "./imagegen-workbench.css";

import { Settings2, Trash2, Upload, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { openImagegenSettings } from "../runtimeBridge";
import { useImageWorkbenchStore, type ImageWorkbenchHistoryItem } from "../store";

type ImageSettingsSidebarProps = {
  className?: string;
  children?: ReactNode;
};

const qualityLevels = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
] as const;

function hasFileDragData(event: DragEvent | globalThis.DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export default function ImageSettingsSidebar({ className, children }: ImageSettingsSidebarProps) {
  const workbench = useImageWorkbenchStore();
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const maskInputRef = useRef<HTMLInputElement | null>(null);
  const [isWindowFileDragging, setIsWindowFileDragging] = useState(false);
  const windowFileDragDepth = useRef(0);
  const dropzoneDragDepth = useRef(0);
  const selectedHistoryItem = workbench.selectedHistoryItem;
  const qualityIndex = Math.max(0, qualityLevels.findIndex((item) => item.value === workbench.quality));
  const selectedQualityLabel = qualityLevels[qualityIndex]?.label ?? "自动";

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
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const formatHistoryParams = (item: ImageWorkbenchHistoryItem) => {
    const modeText = item.mode === "edit" ? "参考图生成" : "文本生成";
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
    <aside className={["sidebar", "sidebar-right", "image-settings-sidebar", className].filter(Boolean).join(" ")} aria-label="图片工作台参数">
      <header className="image-settings-sidebar__header">
        <div>
          <div className="image-settings-sidebar__eyebrow">Images</div>
          <h2 className="image-settings-sidebar__title">生成参数</h2>
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
              <span className="image-workbench__label">提示词</span>
              <textarea
                className="image-workbench__textarea context-input mono"
                rows={8}
                value={workbench.prompt}
                placeholder="描述你要生成的画面，参考图可选"
                onChange={(event) => useImageWorkbenchStore.setState({ prompt: event.currentTarget.value })}
              />
            </label>

            <div className="image-workbench__quality-panel">
              <div className="image-workbench__quality-head">
                <span>质量</span>
                <span className="mono">{selectedQualityLabel}</span>
              </div>
              <div className="image-workbench__quality-body">
                <div className="image-workbench__quality-labels" aria-hidden="true">
                  <span>高</span>
                  <span>中</span>
                  <span>低</span>
                  <span>自动</span>
                </div>
                <input
                  className="image-workbench__quality-slider"
                  type="range"
                  min={0}
                  max={3}
                  step={1}
                  value={qualityIndex}
                  aria-label="图片质量"
                  aria-valuetext={selectedQualityLabel}
                  onChange={onQualityInput}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="image-workbench__attachments">
          <div className="image-workbench__attachments-head">
            <span>参考图（可选）</span>
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
              <span>添加参考图</span>
            </button>
            <div className="image-workbench__dropzone-hint">最多 4 张参考图，不上传也可以直接生成</div>
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
                <div className="image-workbench__label">局部编辑蒙版</div>
                <div className="dim">可选，限定修改区域。</div>
              </div>
              <div className="image-workbench__mask-actions">
                <input ref={maskInputRef} className="image-workbench__file" type="file" accept="image/*" onChange={(event) => void onPickMask(event)} />
                <button className="btn-mini" type="button" onClick={() => maskInputRef.current?.click()}>
                  <Upload className="btn-mini__icon" aria-hidden="true" />
                  <span>{workbench.maskDataUrl ? "替换" : "选择"}</span>
                </button>
                <button className="btn-mini" type="button" disabled={!workbench.maskDataUrl} onClick={() => workbench.clearMask()}>
                  <X className="btn-mini__icon" aria-hidden="true" />
                  <span>清除</span>
                </button>
              </div>
            </div>
          ) : null}

          {workbench.inputImages.length && workbench.maskDataUrl ? (
            <div className="image-workbench__mask-preview">
              <img src={workbench.maskDataUrl} alt="局部编辑蒙版预览" />
            </div>
          ) : null}
        </div>

        {workbench.errorText ? <div className="image-workbench__error mono">{workbench.errorText}</div> : null}

        <button className="image-settings-sidebar__generate" type="button" disabled={!workbench.canGenerate} onClick={() => void workbench.generate()}>
          <Wand2 className="btn-mini__icon" aria-hidden="true" />
          <span>生成图片</span>
        </button>

        {selectedHistoryItem ? (
          <section className="image-settings-sidebar__section">
            <div className="image-settings-sidebar__section-head">
              <span>当前记录</span>
              <button className="btn-mini btn-mini--danger" type="button" onClick={() => void workbench.deleteHistoryItem(selectedHistoryItem.id)}>
                <Trash2 className="btn-mini__icon" aria-hidden="true" />
                <span>删除</span>
              </button>
            </div>
            <div className="image-settings-sidebar__detail">
              <div className="image-settings-sidebar__detail-row">
                <span>模型</span>
                <span className="mono">{selectedHistoryItem.model}</span>
              </div>
              <div className="image-settings-sidebar__detail-row">
                <span>参数</span>
                <span className="mono">{formatHistoryParams(selectedHistoryItem)}</span>
              </div>
              <div className="image-settings-sidebar__detail-row">
                <span>时间</span>
                <span className="mono">{formatDateTime(selectedHistoryItem.createdAt)}</span>
              </div>
              <div className="image-settings-sidebar__prompt-block">
                <div className="image-workbench__label">提示词</div>
                <p className="app-scrollbar">{selectedHistoryItem.prompt}</p>
              </div>
              {selectedHistoryItem.revisedPrompt ? (
                <div className="image-settings-sidebar__prompt-block">
                  <div className="image-workbench__label">修订提示词</div>
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
