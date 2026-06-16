import type { ButtonHTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isAbsoluteFsPath, normalizeAbsoluteFsPath, resolveWorkspaceFsPath } from "../../domain/workspacePath";
import { readLocalImageDataUrl } from "../../features/media/localImageCache";

export type LazyImageSourceKind = "dataUrl" | "remoteUrl" | "localPath";

export type LazyImageThumbProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onError"> & {
  imageId?: string;
  source?: string;
  sourceKind?: LazyImageSourceKind;
  previewTitle?: string;
  workspaceRoot?: string;
  rootMarginPx?: number;
  disabled?: boolean;
  onPreview?: (payload: { src: string; title: string; source: string; sourceKind: LazyImageSourceKind }) => void;
  onLoadError?: (payload: { imageId: string; source: string; sourceKind: LazyImageSourceKind; errorText: string }) => void;
  "onLoad-error"?: (payload: { imageId: string; source: string; sourceKind: LazyImageSourceKind; errorText: string }) => void;
};

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error ?? "unknown error");
}

export default function LazyImageThumb({
  imageId = "",
  source = "",
  sourceKind = "remoteUrl",
  previewTitle = "",
  workspaceRoot = "",
  rootMarginPx = 260,
  disabled = false,
  onPreview,
  onLoadError,
  "onLoad-error": onLoadErrorKebab,
  className,
  ...props
}: LazyImageThumbProps) {
  const rootRef = useRef<HTMLButtonElement | null>(null);
  const [localDataUrl, setLocalDataUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [visible, setVisible] = useState(sourceKind !== "localPath");
  const loadSeq = useRef(0);
  const emittedLoadError = useRef(false);
  const resolvedLocalPath = useMemo(() => {
    const raw = String(source ?? "").trim();
    if (!raw) return "";
    const workspace = String(workspaceRoot ?? "").trim();
    if (workspace) return resolveWorkspaceFsPath(workspace, raw);
    if (isAbsoluteFsPath(raw)) return normalizeAbsoluteFsPath(raw);
    return raw;
  }, [source, workspaceRoot]);
  const resolvedSrc = sourceKind === "localPath" ? localDataUrl : String(source ?? "").trim();

  const emitLoadErrorOnce = (message: string) => {
    if (emittedLoadError.current) return;
    emittedLoadError.current = true;
    const payload = {
      imageId: String(imageId ?? "").trim(),
      source: String(source ?? "").trim(),
      sourceKind,
      errorText: String(message ?? "").trim() || "Image load failed",
    };
    onLoadError?.(payload);
    onLoadErrorKebab?.(payload);
  };

  const ensureLocalLoaded = async (force = false) => {
    if (sourceKind !== "localPath") return;
    if (!resolvedLocalPath) return;
    if (!force && localDataUrl) return;
    const nextSeq = loadSeq.current + 1;
    loadSeq.current = nextSeq;
    setLoading(true);
    setErrorText("");
    try {
      const dataUrl = await readLocalImageDataUrl(resolvedLocalPath);
      if (loadSeq.current !== nextSeq) return;
      setLocalDataUrl(dataUrl);
    } catch (error) {
      if (loadSeq.current !== nextSeq) return;
      const message = safeErrorMessage(error);
      setErrorText(message);
      setLocalDataUrl("");
      emitLoadErrorOnce(message);
    } finally {
      if (loadSeq.current === nextSeq) setLoading(false);
    }
  };

  useEffect(() => {
    setLocalDataUrl("");
    setErrorText("");
    setLoading(false);
    emittedLoadError.current = false;
    loadSeq.current += 1;
    setVisible(sourceKind !== "localPath");
  }, [source, sourceKind, workspaceRoot]);

  useEffect(() => {
    if (sourceKind !== "localPath") return undefined;
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const margin = Math.max(0, Number(rootMarginPx) || 260);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { root: null, rootMargin: `${margin}px 0px ${margin}px 0px` }
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootMarginPx, sourceKind]);

  useEffect(() => {
    if (visible && sourceKind === "localPath") void ensureLocalLoaded();
  }, [visible, sourceKind, resolvedLocalPath]);

  const onPreviewClick = async () => {
    if (disabled) return;
    if (sourceKind === "localPath" && !localDataUrl) await ensureLocalLoaded(true);
    const src = sourceKind === "localPath" ? localDataUrl : String(source ?? "").trim();
    if (!src) return;
    onPreview?.({
      src,
      title: String(previewTitle ?? "").trim() || "Image preview",
      source: String(source ?? "").trim(),
      sourceKind,
    });
  };

  return (
    <button
      {...props}
      ref={rootRef}
      className={[
        "lazy-image-thumb group relative inline-flex max-w-full items-center justify-center overflow-hidden rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] object-contain shadow-none transition-[border-color,background,opacity] duration-150 hover:border-[var(--ui-well-border-hover)] disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      disabled={disabled}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented) void onPreviewClick();
      }}
    >
      {resolvedSrc ? (
        <img
          className="lazy-image-thumb__img h-full w-full object-contain"
          src={resolvedSrc}
          alt={String(previewTitle ?? "").trim() || "image"}
          loading="lazy"
          decoding="async"
          onError={() => {
            if (sourceKind === "localPath") return;
            const message = "Image load failed";
            setErrorText(message);
            emitLoadErrorOnce(message);
          }}
        />
      ) : (
        <div className="lazy-image-thumb__placeholder flex h-full w-full items-center justify-center px-2 text-center mono text-[11px] text-[var(--ui-code-text-muted)]">
          <span>{loading ? "Loading" : errorText ? "Load failed" : "Image"}</span>
        </div>
      )}
    </button>
  );
}
