import { basenameFromPath } from "../../domain/workspaceFiles";
import type {
  ChatImageEntry,
  ChatImageToolItem,
  ImageToolStatus,
  LazyImageSourceKind,
} from "../../components/layout/types/chat.types";

type SupportedImageProtocolItem =
  | {
      type: "imageView";
      id?: string;
      path?: string;
    }
  | {
      type: "imageGeneration";
      id?: string;
      status?: string;
      revisedPrompt?: string | null;
      result?: string;
      results?: string[];
      savedPath?: string;
      savedPaths?: string[];
      pendingImageCount?: number;
      errorText?: string;
    };

function toImageToolStatus(statusValue: unknown, eventMethod: string): ImageToolStatus {
  if (eventMethod === "item/started") return "running";
  const status = String(statusValue ?? "")
    .trim()
    .toLowerCase();
  if (!status) return "completed";
  if (status.includes("error") || status.includes("fail") || status.includes("cancel")) return "failed";
  if (status.includes("running") || status.includes("progress") || status.includes("pending")) return "running";
  if (status.includes("complete") || status.includes("success") || status.includes("succeeded")) return "completed";
  return "unknown";
}

function inferImageSourceKind(sourceValue: string): LazyImageSourceKind {
  const source = String(sourceValue ?? "").trim();
  if (source.startsWith("data:image/")) return "dataUrl";
  if (/^https?:\/\//i.test(source)) return "remoteUrl";
  return "localPath";
}

function looksLikeLocalImagePath(value: string): boolean {
  const text = String(value ?? "").trim();
  if (!text) return false;
  if (/^[a-z]:[\\/]/i.test(text)) return true;
  if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return true;
  if (/^\/[^/]/.test(text)) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(text);
}

function normalizeImageGenerationResultSource(resultValue: unknown): string {
  const result = String(resultValue ?? "").trim();
  if (!result) return "";
  if (result.startsWith("data:image/") || /^https?:\/\//i.test(result)) return result;
  if (looksLikeLocalImagePath(result)) return result;
  return `data:image/png;base64,${result.replace(/\s+/g, "")}`;
}

function buildStableFallbackId(parts: Array<unknown>): string {
  const text = parts
    .map((value) => {
      const raw = String(value ?? "").trim();
      return raw ? raw.slice(0, 120) : "";
    })
    .filter(Boolean)
    .join("|");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `image-tool-${hash.toString(36)}`;
}

function buildImageEntry(id: string, sourceValue: unknown, titleValue?: unknown): ChatImageEntry | null {
  const source = String(sourceValue ?? "").trim();
  if (!source) return null;
  const sourceKind = inferImageSourceKind(source);
  const title = String(titleValue ?? "").trim() || basenameFromPath(source) || "生成图片";
  return { id, sourceKind, source, title };
}

function normalizePendingImageCount(value: unknown): number | undefined {
  const count = Math.round(Number(value));
  if (!Number.isFinite(count)) return undefined;
  return Math.max(1, Math.min(4, count));
}

export function buildImageToolItemFromProtocolItem(item: unknown, eventMethod: string): ChatImageToolItem | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const protocolItem = item as SupportedImageProtocolItem;
  const type = String((protocolItem as { type?: unknown }).type ?? "").trim();
  const id =
    String((protocolItem as { id?: unknown }).id ?? "").trim() ||
    buildStableFallbackId([
      type,
      (protocolItem as any).status,
      (protocolItem as any).revisedPrompt ?? (protocolItem as any).revised_prompt,
      (protocolItem as any).result,
      (protocolItem as any).savedPath,
      (protocolItem as any).path,
    ]);

  if (type === "imageView") {
    const path = String((protocolItem as Extract<SupportedImageProtocolItem, { type: "imageView" }>).path ?? "").trim();
    const image = buildImageEntry(`${id}:path`, path, basenameFromPath(path) || path);
    return {
      itemId: id,
      itemType: "imageView",
      title: "查看图片",
      status: eventMethod === "item/started" ? "running" : "completed",
      detailText: path ? `path=${path}` : "",
      errorText: path ? "" : "缺少图片路径",
      revisedPrompt: "",
      images: image ? [image] : [],
    };
  }

  if (type !== "imageGeneration") return null;

  const generationItem = protocolItem as Extract<SupportedImageProtocolItem, { type: "imageGeneration" }>;
  const statusText = String(generationItem.status ?? "").trim();
  const status = toImageToolStatus(statusText, eventMethod);
  const revisedPrompt = String(generationItem.revisedPrompt ?? "").trim();
  const result = String(generationItem.result ?? "").trim();
  const resultValues = Array.isArray((generationItem as any).results)
    ? ((generationItem as any).results as unknown[]).map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const savedPath = String(generationItem.savedPath ?? "").trim();
  const savedPaths = Array.isArray((generationItem as any).savedPaths)
    ? ((generationItem as any).savedPaths as unknown[]).map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const pendingImageCount = normalizePendingImageCount(
    (generationItem as any).pendingImageCount ?? (generationItem as any).n
  );
  const allSavedPaths = [...new Set([savedPath, ...savedPaths].filter(Boolean))];
  const resultSources =
    allSavedPaths.length > 0
      ? []
      : [result, ...resultValues].map((value) => normalizeImageGenerationResultSource(value)).filter(Boolean);
  const explicitErrorText = String((generationItem as any).errorText ?? "").trim();

  const seen = new Set<string>();
  const images: ChatImageEntry[] = [];
  const addImage = (source: string, title?: string) => {
    if (!source || seen.has(source)) return;
    seen.add(source);
    const image = buildImageEntry(`${id}:${images.length}:${inferImageSourceKind(source)}`, source, title);
    if (image) images.push(image);
  };
  for (const path of allSavedPaths) addImage(path, basenameFromPath(path) || path);
  for (const source of resultSources) addImage(source, "生成图片");

  return {
    itemId: id,
    itemType: "imageGeneration",
    title: "生成图片",
    status,
    pendingImageCount,
    detailText: [
      statusText ? `status=${statusText}` : "",
      allSavedPaths.length > 0 ? allSavedPaths.map((path, index) => `savedPath[${index + 1}]=${path}`).join("\n") : "",
      result
        ? resultSources.some((source) => source.startsWith("data:image/"))
          ? "result=dataUrl"
          : `result=${result.length > 180 ? `${result.slice(0, 179)}…` : result}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    errorText:
      explicitErrorText ||
      (status === "failed" ? (statusText ? `status=${statusText}` : "生成失败") : ""),
    revisedPrompt: revisedPrompt ? `修订提示词：\n${revisedPrompt}` : "",
    images,
  };
}
