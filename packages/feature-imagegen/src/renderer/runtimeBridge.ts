import {
  normalizeImageGenerationSettings,
  type LocalImageGenerationSettings,
} from "../settings";
import type {
  ImageGenerationGenerateArgs,
  ImageGenerationGenerateResult,
  ImageGenerationHistoryDeleteResult,
  ImageGenerationHistoryListResult,
  ImageGenerationTaskCancelResult,
  ImageGenerationTaskDeleteResult,
  ImageGenerationTaskListResult,
  ImageGenerationTaskRetryResult,
  ImageGenerationTaskSubmitResult,
} from "../types";

type ImagegenDesktopApi = {
  app: {
    readImageFileDataUrl(args: {
      path: string;
    }): Promise<{ ok: true; dataUrl: string }>;
    writeClipboardImageFromPath(args: { path: string }): Promise<{ ok: true }>;
    generateImage(
      args: ImageGenerationGenerateArgs,
    ): Promise<ImageGenerationGenerateResult>;
    listImageGenerationHistory(): Promise<ImageGenerationHistoryListResult>;
    deleteImageGenerationHistory(args: {
      id: string;
    }): Promise<ImageGenerationHistoryDeleteResult>;
    listImageGenerationTasks(): Promise<ImageGenerationTaskListResult>;
    submitImageGenerationTask(
      args: ImageGenerationGenerateArgs,
    ): Promise<ImageGenerationTaskSubmitResult>;
    cancelImageGenerationTask(args: {
      id: string;
    }): Promise<ImageGenerationTaskCancelResult>;
    deleteImageGenerationTask(args: {
      id: string;
    }): Promise<ImageGenerationTaskDeleteResult>;
    retryImageGenerationTask(args: {
      id: string;
    }): Promise<ImageGenerationTaskRetryResult>;
  };
  localState: {
    initialSettingsSnapshot?: {
      settings?: unknown;
    };
    readSettings(): Promise<{ settings?: unknown }>;
  };
};

type ImagegenToastKind = "success" | "error" | "warn" | "info";

type ImagegenRuntimeBridgeOptions = {
  translate?: (key: string, params?: Record<string, unknown>) => string;
  workspacePath?: string | null;
};

const workspacePathRef = { value: "" };
let translateHandler: ImagegenRuntimeBridgeOptions["translate"] | null = null;
const localImageDataUrlCache = new Map<string, Promise<string>>();

function toText(value: unknown): string {
  return String(value ?? "").trim();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractImageSettings(value: unknown): LocalImageGenerationSettings {
  return normalizeImageGenerationSettings(toRecord(value)?.imageGeneration);
}

export function installImagegenRuntimeBridge(
  options: ImagegenRuntimeBridgeOptions,
): void {
  translateHandler = options.translate ?? translateHandler;
  if ("workspacePath" in options)
    setImagegenWorkspacePath(options.workspacePath);
}

export function setImagegenWorkspacePath(value: unknown): void {
  workspacePathRef.value = toText(value);
}

export function useImagegenWorkspacePathRef() {
  return workspacePathRef;
}

export function getImagegenWorkspacePath(): string {
  return workspacePathRef.value;
}

export function translateImagegen(
  key: string,
  params?: Record<string, unknown>,
): string {
  try {
    return translateHandler ? translateHandler(key, params) : key;
  } catch {
    return key;
  }
}

export function showImagegenToast(options: {
  kind?: ImagegenToastKind;
  title?: string;
  message: string;
}): void {
  window.dispatchEvent(new CustomEvent("codenexus:toast", { detail: options }));
}

export function openImagegenSettings(): void {
  window.dispatchEvent(
    new CustomEvent("codenexus:open-settings", { detail: { tab: "image" } }),
  );
}

export function getImagegenDesktopApi(): ImagegenDesktopApi {
  const api = (window as unknown as { codexDesktop?: ImagegenDesktopApi })
    .codexDesktop;
  if (!api) throw new Error("codexDesktop bridge is not available.");
  return api;
}

export function getInitialImagegenSettings(): LocalImageGenerationSettings {
  const snapshot = (window as unknown as { codexDesktop?: ImagegenDesktopApi })
    .codexDesktop?.localState?.initialSettingsSnapshot;
  return extractImageSettings(snapshot?.settings);
}

export async function readImagegenSettings(): Promise<LocalImageGenerationSettings> {
  try {
    const res = await getImagegenDesktopApi().localState.readSettings();
    return extractImageSettings(res?.settings);
  } catch {
    return getInitialImagegenSettings();
  }
}

export async function readImagegenLocalImageDataUrl(
  pathValue: unknown,
): Promise<string> {
  const path = toText(pathValue);
  if (!path) return "";
  const existing = localImageDataUrlCache.get(path);
  if (existing) return existing;
  const pending = getImagegenDesktopApi()
    .app.readImageFileDataUrl({ path })
    .then((res) => String(res?.dataUrl ?? "").trim());
  localImageDataUrlCache.set(path, pending);
  try {
    return await pending;
  } catch (error) {
    localImageDataUrlCache.delete(path);
    throw error;
  }
}
