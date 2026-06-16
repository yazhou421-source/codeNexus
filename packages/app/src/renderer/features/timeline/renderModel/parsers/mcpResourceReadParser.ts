import type { McpResourceParameterEntry, TimelineEventItem } from "../../../../domain/types";

export type ParsedMcpResourceReadContent = {
  uri: string;
  mimeType: string;
  kind: "text" | "blob";
  previewText: string;
  sizeBytes: number | null;
};

export type ParsedMcpResourceReadEvent = {
  threadId: string;
  turnId: string;
  server: string;
  uri: string;
  sourceTab: "resources" | "templates";
  templateKey: string;
  status: "running" | "completed" | "failed";
  fetchedAt: number | null;
  resourceLabel: string;
  toolNames: string[];
  parameterEntries: McpResourceParameterEntry[];
  contents: ParsedMcpResourceReadContent[];
  previewText: string;
  mimeSummary: string;
  errorText: string;
  createdAt: number;
};

export function toMcpResourceLookupKey(serverValue: unknown, uriValue: unknown): string {
  const server = String(serverValue ?? "").trim();
  const uri = String(uriValue ?? "").trim();
  return server && uri ? `${server}::${uri}` : "";
}

export function normalizeMcpResourceSourceTab(value: unknown): "resources" | "templates" {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "templates"
    ? "templates"
    : "resources";
}

function shortenText(value: string, maxChars: number): string {
  const text = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function toNonNegativeRoundedNumber(value: unknown): number | null {
  const num = toNumberOrNull(value);
  if (num == null) return null;
  return Math.max(0, Math.round(num));
}

function toEventParamsObject(event: TimelineEventItem): Record<string, any> | null {
  if (event.params && typeof event.params === "object") return event.params as Record<string, any>;
  const text = String(event.paramsText ?? "").trim();
  if (!text || !text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, any>;
  } catch {
    // 无需处理
  }
  return null;
}

export function summarizeMcpResourcePreviewText(contents: ParsedMcpResourceReadContent[]): string {
  if (!Array.isArray(contents) || contents.length === 0) return "";
  const firstText = contents.find((content) => content.kind === "text" && content.previewText)?.previewText ?? "";
  if (firstText) return shortenText(firstText, 220);
  const firstImage = contents.find((content) => /^image\//i.test(content.mimeType));
  if (firstImage) {
    return `图片 ｜ ${firstImage.mimeType || firstImage.uri || "未知类型"}`;
  }
  const firstBlob = contents[0];
  if (!firstBlob) return "";
  const parts = [firstBlob.mimeType || "", firstBlob.uri || ""].filter(Boolean);
  return shortenText(parts.join(" ｜ ") || "二进制内容", 220);
}

export function summarizeMcpResourceMimeTypes(contents: ParsedMcpResourceReadContent[]): string {
  const counts = new Map<string, number>();
  for (const content of contents ?? []) {
    const key =
      String(content?.mimeType ?? "").trim() || (content.kind === "text" ? "text/plain" : "application/octet-stream");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .slice(0, 3)
    .map(([mimeType, count]) => (count > 1 ? `${mimeType} ×${count}` : mimeType))
    .join(" ｜ ");
}

export function resolveMcpResourceReadStatus(
  statusValue: unknown,
  hasError: boolean
): "running" | "completed" | "failed" {
  if (hasError) return "failed";
  const normalized = String(statusValue ?? "")
    .trim()
    .toLowerCase();
  if (/(run|progress|pending|queue|start)/.test(normalized)) return "running";
  if (/(fail|error|cancel|declin|denied|timeout)/.test(normalized)) return "failed";
  if (/(complete|success|done|finish|succeed)/.test(normalized)) return "completed";
  return "completed";
}

export function parseMcpResourceParameterEntries(value: unknown): McpResourceParameterEntry[] {
  return Array.isArray(value)
    ? value.flatMap((rawEntry) => {
        if (!rawEntry || typeof rawEntry !== "object") return [];
        const entry = rawEntry as Record<string, unknown>;
        const key = String(entry.key ?? "").trim();
        if (!key) return [];
        return [
          {
            key,
            value: String(entry.value ?? ""),
          },
        ];
      })
    : [];
}

export function parseMcpResourceReadEvent(event: TimelineEventItem): ParsedMcpResourceReadEvent | null {
  if (event.method !== "mcp/resourceRead") return null;
  const payload = toEventParamsObject(event);
  if (!payload) return null;

  const threadId = String(payload.threadId ?? event.threadId ?? "").trim();
  const server = String(payload.server ?? payload.serverKey ?? "").trim();
  const uri = String(payload.uri ?? "").trim();
  if (!threadId || !server || !uri) return null;

  const contents = Array.isArray(payload.contents)
    ? payload.contents.flatMap((rawContent) => {
        if (!rawContent || typeof rawContent !== "object") return [];
        const content = rawContent as Record<string, unknown>;
        const kind: ParsedMcpResourceReadContent["kind"] =
          String(content.kind ?? "")
            .trim()
            .toLowerCase() === "blob"
            ? "blob"
            : "text";
        return [
          {
            uri: String(content.uri ?? "").trim(),
            mimeType: String(content.mimeType ?? "").trim(),
            kind,
            previewText: String(content.previewText ?? "").trim(),
            sizeBytes: toNonNegativeRoundedNumber(content.sizeBytes),
          },
        ];
      })
    : [];

  const previewText = String(payload.previewText ?? "").trim() || summarizeMcpResourcePreviewText(contents);
  const mimeSummary = String(payload.mimeSummary ?? "").trim() || summarizeMcpResourceMimeTypes(contents);
  const errorText = String(payload.error ?? payload.errorText ?? "").trim();
  const status = resolveMcpResourceReadStatus(payload.status, Boolean(errorText));
  const resourceLabel = String(payload.resourceLabel ?? "").trim() || uri;
  const toolNames = Array.isArray(payload.toolNames)
    ? payload.toolNames.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];
  const parameterEntries = parseMcpResourceParameterEntries(payload.parameterEntries);

  return {
    threadId,
    turnId: String(payload.turnId ?? event.turnId ?? "").trim() || "unknown",
    server,
    uri,
    sourceTab: normalizeMcpResourceSourceTab(payload.sourceTab),
    templateKey: String(payload.templateKey ?? "").trim(),
    status,
    fetchedAt: toNonNegativeRoundedNumber(payload.fetchedAt),
    resourceLabel,
    toolNames,
    parameterEntries,
    contents,
    previewText,
    mimeSummary,
    errorText,
    createdAt: event.createdAt,
  };
}
