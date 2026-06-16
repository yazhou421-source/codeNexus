import type { WorkspaceFileSource } from "./types";

export const WORKSPACE_FILE_SAVE_TIMELINE_METHOD = "local/workspaceFileSave";
const WORKSPACE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".ico"]);

export type WorkspaceFileSaveTimelineStatus = "success" | "failed";

export type WorkspaceFileSaveTimelineItem = {
  origin: "filePane";
  path: string;
  source: WorkspaceFileSource;
  status: WorkspaceFileSaveTimelineStatus;
  chars: number;
  errorText: string;
  savedAt: number;
};

export type WorkspaceFileSaveTimelineParams = {
  item: WorkspaceFileSaveTimelineItem;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function workspaceFileSourceText(source: WorkspaceFileSource): string {
  void source;
  return "本地文件";
}

export function buildWorkspaceFileSaveTimelineItem(params: {
  path: string;
  source: WorkspaceFileSource;
  status: WorkspaceFileSaveTimelineStatus;
  chars: number;
  errorText?: string;
}): WorkspaceFileSaveTimelineItem {
  return {
    origin: "filePane",
    path: String(params.path ?? "").trim(),
    source: params.source,
    status: params.status,
    chars: Number.isFinite(params.chars) ? Math.max(0, Math.round(params.chars)) : 0,
    errorText: String(params.errorText ?? "").trim(),
    savedAt: Date.now(),
  };
}

export function buildWorkspaceFileSaveTimelineParamsText(item: WorkspaceFileSaveTimelineItem): string {
  const lines = [
    `文件面板 ｜ ${item.status === "success" ? "已保存" : "保存失败"}`,
    item.path ? `path=${item.path}` : "",
    `source=${workspaceFileSourceText(item.source)}`,
    `chars=${item.chars}`,
  ].filter(Boolean);
  if (item.errorText) lines.push(item.errorText);
  return lines.join("\n");
}

export function getWorkspaceFileSaveTimelineItemFromEvent(event: {
  method?: string;
  params?: unknown;
}): WorkspaceFileSaveTimelineItem | null {
  if (String(event?.method ?? "").trim() !== WORKSPACE_FILE_SAVE_TIMELINE_METHOD) return null;
  const params = toRecord(event?.params);
  const item = toRecord(params?.item);
  if (!item) return null;
  const status = String(item.status ?? "").trim() === "failed" ? "failed" : "success";
  return {
    origin: "filePane",
    path: String(item.path ?? "").trim(),
    source: "local",
    status,
    chars: Number.isFinite(item.chars) ? Math.max(0, Math.round(Number(item.chars))) : 0,
    errorText: String(item.errorText ?? "").trim(),
    savedAt: Number.isFinite(item.savedAt) ? Number(item.savedAt) : Date.now(),
  };
}

export function detectUnsupportedTextReason(content: string): string {
  const text = String(content ?? "");
  if (!text) return "";
  if (text.includes("\u0000")) {
    return "文件包含二进制内容，暂不支持作为文本编辑。";
  }
  let controlCount = 0;
  const sample = text.slice(0, 4096);
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    const isControl = code < 32 && code !== 9 && code !== 10 && code !== 13;
    if (isControl) controlCount += 1;
  }
  if (sample.length > 0 && controlCount >= 8 && controlCount / sample.length > 0.02) {
    return "文件包含较多不可见控制字符，暂不支持作为文本编辑。";
  }
  return "";
}

export function isWorkspaceImagePath(path: string): boolean {
  const name = basenameFromPath(path).toLowerCase();
  const match = name.match(/(\.[^.\\/]+)$/);
  return Boolean(match?.[1] && WORKSPACE_IMAGE_EXTS.has(match[1]));
}

export function workspaceImageMimeFromPath(path: string): string {
  const name = basenameFromPath(path).toLowerCase();
  const ext = name.match(/(\.[^.\\/]+)$/)?.[1] ?? "";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  return "image/*";
}

export function basenameFromPath(path: string): string {
  const normalized = String(path ?? "")
    .trim()
    .replace(/[\\/]+$/, "");
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}
