import { FileDiff, FilePlus, FileSearch, Globe, Terminal, Trash2, Wrench } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";
import type { CustomProviderKind, LocalCustomProvider } from "@codenexus/shared/localSettings";
import type { CustomToolActivity } from "../../../stores/customChat.store";

// 自定义工作台共享的纯函数与常量（从 CustomWorkbench 单体抽出）。

export type ProviderForm = {
  kind: CustomProviderKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: string;
  contextLimit: string;
  thinking: boolean;
};

export const emptyForm: ProviderForm = {
  kind: "openai-compatible",
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  maxOutputTokens: "",
  contextLimit: "",
  thinking: false,
};

export const DEFAULT_CONTEXT_LIMIT = 200_000;
export const CONTEXT_BLOCK_COUNT = 5;
export const COMPOSER_MIN_HEIGHT = 48;
export const COMPOSER_MAX_HEIGHT = 200;
export const composerSizeStyle: CSSProperties = {
  height: `${COMPOSER_MIN_HEIGHT}px`,
  maxHeight: `${COMPOSER_MAX_HEIGHT}px`,
};

export function formFromProvider(provider: LocalCustomProvider): ProviderForm {
  return {
    kind: provider.kind,
    name: provider.name,
    baseUrl: provider.baseUrl ?? "",
    apiKey: provider.apiKey ?? "",
    model: provider.model,
    maxOutputTokens: provider.maxOutputTokens ? String(provider.maxOutputTokens) : "",
    contextLimit: provider.contextLimit ? String(provider.contextLimit) : "",
    thinking: Boolean(provider.thinking),
  };
}

export function providerFromForm(form: ProviderForm, id?: string): LocalCustomProvider {
  const positiveIntOrNull = (value: string) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  return {
    id: id || `cp-${Date.now()}`,
    kind: form.kind,
    name: form.name.trim() || "Custom Provider",
    baseUrl: form.baseUrl.trim() || null,
    apiKey: form.apiKey.trim() || null,
    model: form.model.trim(),
    thinking: form.thinking,
    maxOutputTokens: positiveIntOrNull(form.maxOutputTokens),
    contextLimit: positiveIntOrNull(form.contextLimit),
  };
}

export function kindLabel(kind: CustomProviderKind) {
  if (kind === "anthropic") return "Claude";
  if (kind === "gemini") return "Gemini";
  return "OpenAI 兼容";
}

export function providerOptionLabel(provider: LocalCustomProvider) {
  return `${provider.name} · ${kindLabel(provider.kind)} · ${provider.model || "未设置模型"}`;
}

export function formatSessionTime(value: number) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

export function shortPath(path: string) {
  const normalized = String(path ?? "").trim();
  if (!normalized) return "";
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || normalized;
}

export function toolCategory(name: string) {
  const raw = name.toLowerCase();
  if (/(write|edit|patch|save|create)/.test(raw)) return "write";
  if (/(rm|delete|remove)/.test(raw)) return "destructive";
  if (/(bash|shell|command|exec|powershell|terminal)/.test(raw)) return "exec";
  if (/(web|http|fetch|search)/.test(raw)) return "network";
  return "read";
}

export function toolIcon(name: string): ComponentType<{ className?: string; "aria-hidden"?: boolean }> {
  const category = toolCategory(name);
  if (category === "write") return FilePlus;
  if (category === "destructive") return Trash2;
  if (category === "exec") return Terminal;
  if (category === "network") return Globe;
  if (/diff|patch/.test(name.toLowerCase())) return FileDiff;
  if (/search|find/.test(name.toLowerCase())) return FileSearch;
  return Wrench;
}

export function toolStatusLabel(status: CustomToolActivity["status"]) {
  if (status === "running") return "执行中";
  if (status === "error") return "失败";
  return "完成";
}

export function toolArgsSummary(argsText: string) {
  const text = String(argsText ?? "").trim();
  if (!text) return "";
  try {
    const obj = JSON.parse(text) as Record<string, unknown>;
    if (obj && typeof obj === "object") {
      if (typeof obj.command === "string") return obj.command;
      if (typeof obj.path === "string") return obj.path;
      if (typeof obj.processId === "string") return obj.processId;
    }
  } catch {
    // Non-JSON args stream in as compact text.
  }
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function unescapeJsonFragment(text: string) {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function toolArgsPreview(text: string) {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (typeof obj.content === "string") return obj.content;
      return JSON.stringify(obj, null, 2);
    }
  } catch {
    // Streaming JSON fragments may be incomplete; show an unescaped preview.
  }
  return unescapeJsonFragment(raw);
}

export function toolHasPreview(argsText: string) {
  const preview = toolArgsPreview(argsText);
  return preview.includes("\n") || preview.length > 80;
}

export function formatCompactTokens(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(n);
}

export function isDiffContent(text: string) {
  return /^diff --git /m.test(text) || /^@@ /m.test(text) || /^(---|\+\+\+) /m.test(text);
}

export function extractFilenameFromDetail(text: string) {
  const match = String(text).match(/^\+\+\+ b\/(.+)$/m) || String(text).match(/^--- a\/(.+)$/m);
  return match?.[1] ?? "changes.diff";
}
