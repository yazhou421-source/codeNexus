import type {
  McpResourceContentState,
  McpResourceParameterEntry,
  McpResourceTemplateDraftState,
  McpServerState,
} from "../types";
import { safeJsonStringify } from "../../utils/safeJson";

export type McpResourceSourceTab = "resources" | "templates";

export type McpResourceTimelineContent = {
  uri: string;
  mimeType: string;
  kind: "text" | "blob";
  previewText: string;
  sizeBytes: number;
};

type McpResourceReadRuntimeDeps = {
  getServers: () => McpServerState[];
  getTemplateDraft: (templateKey: string) => McpResourceTemplateDraftState | undefined;
  requestMcpResourceRead: (params: {
    threadId: string;
    serverKey: string;
    uri: string;
  }) => Promise<{ contents: McpResourceContentState[] }>;
  upsertTimelineEvent: (params: {
    threadId: string;
    id: string;
    method: string;
    paramsText: string;
    params?: unknown;
    level?: "info" | "warn" | "error";
    createdAt?: number;
  }) => void;
};

export type McpResourceReadRuntime = {
  readMcpResource: (params: {
    threadId: string;
    serverKey: string;
    uri: string;
    sourceTab?: "resources" | "templates";
    templateKey?: string;
  }) => Promise<{
    contents: McpResourceContentState[];
    resourceLabel: string;
    toolNames: string[];
    parameterEntries: McpResourceParameterEntry[];
  }>;
};

const SIMPLE_MCP_TEMPLATE_EXPR_RE = /\{([^{}]+)\}/g;

export function toMcpResourceSourceTab(value: unknown): McpResourceSourceTab {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "templates"
    ? "templates"
    : "resources";
}

export function normalizeMcpResourceText(value: unknown): string {
  return String(value ?? "").trim();
}

export function analyzeMcpTemplateVariables(templateValue: unknown): string[] {
  const template = String(templateValue ?? "");
  const variables: string[] = [];
  let match: RegExpExecArray | null = null;
  SIMPLE_MCP_TEMPLATE_EXPR_RE.lastIndex = 0;
  while ((match = SIMPLE_MCP_TEMPLATE_EXPR_RE.exec(template)) !== null) {
    const expression = String(match[1] ?? "").trim();
    if (!expression) continue;
    const hasComplexSyntax =
      /^[+#./;?&]/.test(expression) || expression.includes(",") || expression.includes("*") || expression.includes(":");
    const candidateParts = (hasComplexSyntax ? expression.replace(/^[+#./;?&]/, "") : expression)
      .split(",")
      .map((item) => item.replace(/[:*].*$/, "").trim())
      .filter(Boolean);
    for (const part of candidateParts) {
      if (!/^[A-Za-z0-9_.-]+$/.test(part)) continue;
      if (!variables.includes(part)) variables.push(part);
    }
  }
  return variables;
}

export function buildResolvedMcpTemplateUri(templateValue: unknown, values: Record<string, string>): string {
  const template = String(templateValue ?? "");
  SIMPLE_MCP_TEMPLATE_EXPR_RE.lastIndex = 0;
  return template.replace(SIMPLE_MCP_TEMPLATE_EXPR_RE, (_, expr: string) => {
    const key = String(expr ?? "").trim();
    const value = normalizeMcpResourceText(values[key]);
    return value ? encodeURIComponent(value) : `{${key}}`;
  });
}

export function buildMcpResourceReadSummary(params: {
  serverKey: string;
  uri: string;
  sourceTab: McpResourceSourceTab;
  templateKey: string;
  servers: McpServerState[];
  getTemplateDraft: (templateKey: string) => McpResourceTemplateDraftState | undefined;
}): {
  resourceLabel: string;
  toolNames: string[];
  parameterEntries: McpResourceParameterEntry[];
} {
  const server = params.servers.find((item) => normalizeMcpResourceText(item?.id) === params.serverKey) ?? null;
  const toolNames = (server?.tools ?? [])
    .map((tool) => normalizeMcpResourceText(tool?.title) || normalizeMcpResourceText(tool?.name))
    .filter(Boolean);

  if (params.sourceTab === "templates") {
    const template =
      server?.resourceTemplates.find((item) => normalizeMcpResourceText(item?.uriTemplate) === params.templateKey) ??
      null;
    const resourceLabel =
      normalizeMcpResourceText(template?.title) ||
      normalizeMcpResourceText(template?.name) ||
      normalizeMcpResourceText(template?.uriTemplate) ||
      params.uri;
    const draft = params.templateKey
      ? (params.getTemplateDraft(params.templateKey) ?? { values: {}, manualUri: "" })
      : { values: {}, manualUri: "" };
    const templateValue = normalizeMcpResourceText(template?.uriTemplate) || params.templateKey;
    const variableNames = analyzeMcpTemplateVariables(templateValue);
    const parameterEntries: McpResourceParameterEntry[] = variableNames.map((name) => ({
      key: name,
      value: normalizeMcpResourceText(draft.values?.[name] ?? ""),
    }));
    const manualUri = normalizeMcpResourceText(draft.manualUri);
    const resolvedUri =
      manualUri || normalizeMcpResourceText(buildResolvedMcpTemplateUri(templateValue, draft.values ?? {}));
    if (manualUri) {
      parameterEntries.push({ key: "manualUri", value: manualUri });
    }
    if (resolvedUri && resolvedUri !== manualUri) {
      parameterEntries.push({ key: "resolvedUri", value: resolvedUri });
    }
    return { resourceLabel, toolNames, parameterEntries };
  }

  const resource = server?.resources.find((item) => normalizeMcpResourceText(item?.uri) === params.uri) ?? null;
  const resourceLabel =
    normalizeMcpResourceText(resource?.title) ||
    normalizeMcpResourceText(resource?.name) ||
    normalizeMcpResourceText(resource?.uri) ||
    params.uri;
  return {
    resourceLabel,
    toolNames,
    parameterEntries: [],
  };
}

export function estimateBase64ByteLength(base64: string): number {
  const raw = String(base64 ?? "").trim();
  if (!raw) return 0;
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

export function summarizeTextPreview(value: unknown, maxChars = 220): string {
  const text =
    String(value ?? "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? String(value ?? "").trim();
  if (!text) return "";
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function toMcpResourceTimelineContents(contents: McpResourceContentState[]): McpResourceTimelineContent[] {
  return (contents ?? []).map((content) => {
    const uri = String(content?.uri ?? "").trim();
    const mimeType = String((content as { mimeType?: unknown }).mimeType ?? "").trim();
    if (typeof (content as { text?: unknown }).text === "string") {
      return {
        uri,
        mimeType,
        kind: "text",
        previewText: summarizeTextPreview((content as { text: string }).text),
        sizeBytes: Math.max(0, String((content as { text: string }).text ?? "").length),
      };
    }
    const blob = String((content as { blob?: unknown }).blob ?? "");
    return {
      uri,
      mimeType,
      kind: "blob",
      previewText: /^image\//i.test(mimeType) ? "图片内容" : "",
      sizeBytes: estimateBase64ByteLength(blob),
    };
  });
}

export function summarizeMcpResourceMimeTypes(contents: McpResourceTimelineContent[]): string {
  const counts = new Map<string, number>();
  for (const content of contents) {
    const key = content.mimeType || (content.kind === "text" ? "text/plain" : "application/octet-stream");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .slice(0, 3)
    .map(([mimeType, count]) => (count > 1 ? `${mimeType} ×${count}` : mimeType))
    .join(" ｜ ");
}

export function createMcpResourceReadRuntime(deps: McpResourceReadRuntimeDeps): McpResourceReadRuntime {
  const readMcpResource: McpResourceReadRuntime["readMcpResource"] = async (params) => {
    const threadId = String(params.threadId ?? "").trim();
    const serverKey = String(params.serverKey ?? "").trim();
    const uri = String(params.uri ?? "").trim();
    const sourceTab = toMcpResourceSourceTab(params.sourceTab);
    const templateKey = String(params.templateKey ?? "").trim();
    const startedAt = Date.now();
    const shouldTrackTimeline = Boolean(threadId && serverKey && uri);
    const eventId = `mcp:resourceRead:${threadId || "__app__"}:${startedAt}:${Math.random().toString(16).slice(2)}`;
    const readSummary = buildMcpResourceReadSummary({
      serverKey,
      uri,
      sourceTab,
      templateKey,
      servers: deps.getServers(),
      getTemplateDraft: deps.getTemplateDraft,
    });
    const buildTimelinePayload = (payload: {
      status: "running" | "completed" | "failed";
      fetchedAt: number | null;
      contents: McpResourceTimelineContent[];
      previewText: string;
      mimeSummary: string;
      error: string | null;
    }) => ({
      threadId,
      server: serverKey,
      uri,
      sourceTab,
      templateKey: templateKey || null,
      fetchedAt: payload.fetchedAt,
      status: payload.status,
      resourceLabel: readSummary.resourceLabel,
      toolNames: readSummary.toolNames,
      parameterEntries: readSummary.parameterEntries,
      contents: payload.contents,
      previewText: payload.previewText,
      mimeSummary: payload.mimeSummary,
      error: payload.error,
    });

    if (shouldTrackTimeline) {
      const runningPayload = buildTimelinePayload({
        status: "running",
        fetchedAt: null,
        contents: [],
        previewText: "",
        mimeSummary: "",
        error: null,
      });
      deps.upsertTimelineEvent({
        threadId,
        id: eventId,
        method: "mcp/resourceRead",
        paramsText: safeJsonStringify(runningPayload, { space: 2 }),
        params: runningPayload,
        createdAt: startedAt,
      });
    }

    try {
      const result = await deps.requestMcpResourceRead({ threadId, serverKey, uri });
      const contents = Array.isArray(result.contents) ? [...result.contents] : [];
      const eventContents = toMcpResourceTimelineContents(contents);
      if (shouldTrackTimeline) {
        const fetchedAt = Date.now();
        const completedPayload = buildTimelinePayload({
          status: "completed",
          fetchedAt,
          contents: eventContents,
          previewText: eventContents.find((content) => content.previewText)?.previewText ?? "",
          mimeSummary: summarizeMcpResourceMimeTypes(eventContents),
          error: null,
        });
        deps.upsertTimelineEvent({
          threadId,
          id: eventId,
          method: "mcp/resourceRead",
          paramsText: safeJsonStringify(completedPayload, { space: 2 }),
          params: completedPayload,
          createdAt: startedAt,
        });
      }
      return {
        contents,
        resourceLabel: readSummary.resourceLabel,
        toolNames: [...readSummary.toolNames],
        parameterEntries: readSummary.parameterEntries.map((entry) => ({ ...entry })),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "读取失败");
      if (shouldTrackTimeline) {
        const failedPayload = buildTimelinePayload({
          status: "failed",
          fetchedAt: Date.now(),
          contents: [],
          previewText: "",
          mimeSummary: "",
          error: message,
        });
        deps.upsertTimelineEvent({
          threadId,
          id: eventId,
          method: "mcp/resourceRead",
          paramsText: safeJsonStringify(failedPayload, { space: 2 }),
          params: failedPayload,
          level: "error",
          createdAt: startedAt,
        });
      }
      throw error;
    }
  };

  return { readMcpResource };
}
