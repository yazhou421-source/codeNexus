import "./imagegen-workbench.css";

import { Copy, Download, Image as ImageIcon, Loader2, RotateCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useState, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { useTranslation } from "react-i18next";
import { getImagegenDesktopApi, readImagegenLocalImageDataUrl, showImagegenToast as showToast } from "../runtimeBridge";
import { useImageWorkbenchStore } from "../store";

type ImageWorkbenchProps = {
  className?: string;
  children?: ReactNode;
};

type WorkbenchImage = NonNullable<ReturnType<typeof useImageWorkbenchStore>["selectedHistoryItem"]>["images"][number];
type ImagePanState = { panX: number; panY: number };
type ImageDragState = {
  path: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.18;

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function sanitizeDownloadName(value: string) {
  const name = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ");
  return name || "image";
}

function extensionFromImage(image: WorkbenchImage) {
  const mimeExt = image.mimeType.match(/^image\/([a-z0-9.+-]+)$/i)?.[1]?.toLowerCase();
  if (mimeExt) {
    if (mimeExt === "jpeg") return "jpg";
    if (mimeExt === "svg+xml") return "svg";
    return mimeExt;
  }
  return image.path.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || "png";
}

function pruneRecordByPaths<T>(record: Record<string, T>, allowedPaths: Set<string>): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [path, value] of Object.entries(record)) {
    if (allowedPaths.has(path)) next[path] = value;
  }
  return next;
}

export default function ImageWorkbench({ className, children }: ImageWorkbenchProps) {
  const { t, i18n } = useTranslation();
  const workbench = useImageWorkbenchStore();
  const selectedHistoryItem = workbench.selectedHistoryItem;
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [imageZoomByPath, setImageZoomByPath] = useState<Record<string, number>>({});
  const [imagePanByPath, setImagePanByPath] = useState<Record<string, ImagePanState>>({});
  const [imageDataUrlByPath, setImageDataUrlByPath] = useState<Record<string, string>>({});
  const [imageDataUrlLoading, setImageDataUrlLoading] = useState<Record<string, boolean>>({});
  const [imageDragState, setImageDragState] = useState<ImageDragState | null>(null);
  const selectedImage = selectedHistoryItem?.images[selectedImageIndex] ?? selectedHistoryItem?.images[0] ?? null;
  const selectedImagePaths = useMemo<string[]>(
    () => selectedHistoryItem?.images.map((image) => String(image.path ?? "").trim()).filter(Boolean) ?? [],
    [selectedHistoryItem],
  );

  const getImageZoom = (path: string) => imageZoomByPath[path] ?? 1;
  const getImagePan = (path: string) => imagePanByPath[path] ?? { panX: 0, panY: 0 };
  const getImageTransform = (path: string) => {
    const pan = getImagePan(path);
    return `translate3d(${pan.panX}px, ${pan.panY}px, 0) scale(${getImageZoom(path)})`;
  };
  const setImageZoom = (path: string, zoom: number) => {
    setImageZoomByPath((current) => ({ ...current, [path]: clampNumber(zoom, MIN_ZOOM, MAX_ZOOM) }));
  };
  const setImagePan = (path: string, pan: ImagePanState) => {
    setImagePanByPath((current) => ({ ...current, [path]: { panX: Math.round(pan.panX), panY: Math.round(pan.panY) } }));
  };
  const resetImageZoom = (path: string) => {
    setImageZoom(path, 1);
    setImagePan(path, { panX: 0, panY: 0 });
  };
  const formatDateTime = (value: number) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t("imageWorkbench.unknownTime");
    return date.toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  const ensureImageDataUrl = async (pathValue: string) => {
    const path = String(pathValue ?? "").trim();
    if (!path || imageDataUrlByPath[path] || imageDataUrlLoading[path]) return;
    setImageDataUrlLoading((current) => ({ ...current, [path]: true }));
    try {
      const dataUrl = await readImagegenLocalImageDataUrl(path);
      setImageDataUrlByPath((current) => ({ ...current, [path]: dataUrl }));
    } catch {
      setImageDataUrlByPath((current) => ({ ...current, [path]: "" }));
    } finally {
      setImageDataUrlLoading((current) => ({ ...current, [path]: false }));
    }
  };

  const firstReadyHistoryId = () =>
    workbench.historyItems.find((item) => !item.workbenchStatus && item.images.length > 0)?.id ??
    workbench.historyItems.find((item) => item.workbenchStatus === "ready" && item.images.length > 0)?.id ??
    "";

  const ensureSelectedHistory = () => {
    if (selectedHistoryItem) return;
    const id = firstReadyHistoryId();
    if (id) workbench.selectHistoryItem(id);
  };

  const downloadImage = (image: WorkbenchImage) => {
    const src = String(imageDataUrlByPath[image.path] ?? "").trim();
    if (!src) return;
    const link = document.createElement("a");
    link.href = src;
    link.download = `${sanitizeDownloadName(image.path || "generated-image")}.${extensionFromImage(image)}`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const copyImageToClipboard = async (image: WorkbenchImage) => {
    const path = String(image.path ?? "").trim();
    if (!path) return;
    try {
      await getImagegenDesktopApi().app.writeClipboardImageFromPath({ path });
      showToast({ kind: "success", title: t("imageWorkbench.copySuccessTitle"), message: t("imageWorkbench.copySuccessMessage") });
    } catch (error: any) {
      showToast({ kind: "error", title: t("imageWorkbench.copyFailedTitle"), message: String(error?.message ?? error ?? "") });
    }
  };

  const onImagePointerDown = (path: string, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !imageDataUrlByPath[path]) return;
    const pan = getImagePan(path);
    setImageDragState({
      path,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.panX,
      startPanY: pan.panY,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onImageWheel = (path: string, event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setImageZoom(path, getImageZoom(path) * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
  };

  useEffect(() => {
    const current = useImageWorkbenchStore.getState();
    void (async () => {
      await current.syncSettingsFromCache();
      current.notifyMissingConfigurationOnce();
      await current.loadHistory();
    })();
    return () => {
      current.stopDrag();
      current.stopTaskPolling();
    };
  }, []);

  useEffect(() => {
    ensureSelectedHistory();
  }, [workbench.selectedHistoryId, workbench.historyItems]);

  useEffect(() => {
    setSelectedImageIndex(0);
    setImageZoomByPath({});
    setImagePanByPath({});
    setImageDragState(null);
  }, [selectedHistoryItem?.id]);

  useEffect(() => {
    const allowedPaths = new Set(selectedImagePaths);
    setImageDataUrlByPath((current) => pruneRecordByPaths(current, allowedPaths));
    setImageDataUrlLoading((current) => pruneRecordByPaths(current, allowedPaths));
    setImageZoomByPath((current) => pruneRecordByPaths(current, allowedPaths));
    setImagePanByPath((current) => pruneRecordByPaths(current, allowedPaths));
    for (const path of selectedImagePaths) void ensureImageDataUrl(path);
  }, [selectedImagePaths.join("\n")]);

  useEffect(() => {
    if (!imageDragState) return;
    const onMove = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== imageDragState.pointerId) return;
      setImagePan(imageDragState.path, {
        panX: imageDragState.startPanX + event.clientX - imageDragState.startClientX,
        panY: imageDragState.startPanY + event.clientY - imageDragState.startClientY,
      });
    };
    const onUp = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== imageDragState.pointerId) return;
      setImageDragState(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [imageDragState]);

  return (
    <section className={["image-workbench", className].filter(Boolean).join(" ")} aria-label={t("imageWorkbench.aria")}>
      {workbench.historyLoading && !selectedHistoryItem ? (
        <div className="image-workbench__empty">
          <Loader2 className="image-workbench__empty-icon is-spinning" aria-hidden="true" />
          <div>{t("imageWorkbench.loadingHistory")}</div>
        </div>
      ) : selectedHistoryItem && selectedImage ? (
        <div className="image-workbench__viewer">
          <header className="image-workbench__viewer-head">
            <div className="image-workbench__viewer-copy">
              <div className="image-workbench__viewer-kicker mono">{formatDateTime(selectedHistoryItem.createdAt)}</div>
              <h2>{selectedHistoryItem.prompt}</h2>
            </div>
            <div className="image-workbench__viewer-actions">
              <span className="image-workbench__zoom mono">{Math.round(getImageZoom(selectedImage.path) * 100)}%</span>
              <button className="image-workbench__tool" type="button" aria-label={t("imageWorkbench.zoomOut")} onClick={() => setImageZoom(selectedImage.path, getImageZoom(selectedImage.path) / ZOOM_STEP)}>
                <ZoomOut aria-hidden="true" />
              </button>
              <button className="image-workbench__tool" type="button" aria-label={t("imageWorkbench.zoomIn")} onClick={() => setImageZoom(selectedImage.path, getImageZoom(selectedImage.path) * ZOOM_STEP)}>
                <ZoomIn aria-hidden="true" />
              </button>
              <button className="image-workbench__tool" type="button" aria-label={t("common.reset")} onClick={() => resetImageZoom(selectedImage.path)}>
                <RotateCcw aria-hidden="true" />
              </button>
              <button className="image-workbench__tool" type="button" aria-label={t("imageWorkbench.copyImage")} onClick={() => void copyImageToClipboard(selectedImage)}>
                <Copy aria-hidden="true" />
              </button>
              <button className="image-workbench__tool" type="button" aria-label={t("imageWorkbench.downloadImage")} onClick={() => downloadImage(selectedImage)}>
                <Download aria-hidden="true" />
              </button>
              <button className="image-workbench__tool is-danger" type="button" aria-label={t("imageWorkbench.delete")} onClick={() => void workbench.deleteHistoryItem(selectedHistoryItem.id)}>
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </header>

          <div
            className={`image-workbench__viewport${imageDragState?.path === selectedImage.path ? " is-dragging" : ""}`}
            onPointerDown={(event) => onImagePointerDown(selectedImage.path, event)}
            onWheel={(event) => onImageWheel(selectedImage.path, event)}
          >
            {imageDataUrlLoading[selectedImage.path] ? (
              <Loader2 className="image-workbench__image-state is-spinning" aria-hidden="true" />
            ) : imageDataUrlByPath[selectedImage.path] ? (
              <img src={imageDataUrlByPath[selectedImage.path]} alt={selectedImage.path} style={{ transform: getImageTransform(selectedImage.path) }} draggable={false} />
            ) : (
              <div className="image-workbench__image-missing">{t("imageWorkbench.imageUnavailable")}</div>
            )}
          </div>

          {selectedHistoryItem.images.length > 1 ? (
            <div className="image-workbench__filmstrip app-scrollbar">
              {selectedHistoryItem.images.map((image, index) => (
                <button
                  key={image.path}
                  className={`image-workbench__filmstrip-item${index === selectedImageIndex ? " is-active" : ""}`}
                  type="button"
                  onClick={() => setSelectedImageIndex(index)}
                >
                  {imageDataUrlByPath[image.path] ? <img src={imageDataUrlByPath[image.path]} alt={image.path} /> : <ImageIcon aria-hidden="true" />}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="image-workbench__empty">
          <ImageIcon className="image-workbench__empty-icon" aria-hidden="true" />
          <div>{workbench.historyItems.length > 0 ? t("imageWorkbench.selectFromWorkspace") : t("imageWorkbench.emptyHistory")}</div>
        </div>
      )}
      {children}
    </section>
  );
}
