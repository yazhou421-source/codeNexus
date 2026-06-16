import { ipcMain } from "electron";
import { IPC_APP_CHANNELS } from "@codenexus/shared/ipc/channels";
import {
  DEFAULT_FLOWCHART_AI_TIMEOUT_MS,
  MAX_FLOWCHART_AI_TIMEOUT_MS,
  MIN_FLOWCHART_AI_TIMEOUT_MS,
} from "@codenexus/feature-flowchart/settings";
import {
  createDefaultFlowchartDocument,
  normalizeFlowchartDocument,
  normalizeFlowchartTemplateType,
  type FlowchartAiRunArgs,
  type FlowchartAiRunResult,
  type FlowchartDocument,
} from "@codenexus/feature-flowchart";
import type { FlowchartHistoryService } from "@codenexus/feature-flowchart/main/FlowchartHistoryService";
import type { LocalSettingsService } from "../../services/LocalSettingsService";
import {
  fetchWithTimeout,
  normalizeHttpUrl,
  toIntegerInRange,
  toNullableText,
  truncateText,
} from "./app-handler-utils";

function normalizeOpenAiChatCompletionsEndpoint(baseUrlValue: unknown): string {
  const baseUrl = normalizeHttpUrl(baseUrlValue);
  if (!baseUrl) throw new Error("Flowchart AI service URL is invalid. Enter an http(s) URL.");
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
}

function extractJsonPayload(textValue: unknown): unknown {
  const text = String(textValue ?? "").trim();
  if (!text) throw new Error("AI response is empty.");
  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return JSON.parse(text.slice(first, last + 1));
  }
  throw new Error("AI response is not valid JSON.");
}

function extractChatCompletionContent(value: unknown): string {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, any>) : {};
  const message = first.message && typeof first.message === "object" ? (first.message as Record<string, any>) : {};
  const content = toNullableText(message.content ?? first.text ?? record.content);
  if (!content) throw new Error("AI response contained no message content.");
  return content;
}

function buildFlowchartAiSystemPrompt() {
  return [
    "You generate and edit flowchart documents for a React Flow based workbench.",
    "Return strict JSON only. Do not wrap it in Markdown.",
    "Schema: {id,title,templateType,prompt,nodes,edges,viewport,createdAt,updatedAt}.",
    "Allowed templateType values: basic, swimlane, architecture, org, sequence.",
    "Every node must have id,type,label,position:{x,y},style. Every edge must have id,source,target,label,style.",
    "Use stable unique ids. Edges must reference existing node ids. Provide useful coordinates directly.",
    "Keep coordinates inside a practical canvas: x 0-1800, y 0-1200. Do not rely on automatic layout.",
  ].join("\n");
}

function buildFlowchartAiUserPrompt(args: FlowchartAiRunArgs, baseDocument: FlowchartDocument) {
  const templateType = normalizeFlowchartTemplateType(args?.templateType);
  const prompt = toNullableText(args?.prompt) ?? "";
  const templateHints: Record<string, string> = {
    basic: "Use start/process/decision/end nodes for a normal process flow.",
    swimlane: "Use lane nodes plus process/decision nodes; place lane nodes as wide horizontal bands.",
    architecture: "Use system/database/service/client node types and label integration protocols on edges.",
    org: "Use person/team node types; arrange hierarchy top-down.",
    sequence: "Use actor/lifeline/message-like labels; arrange participants left-to-right and interactions top-down.",
  };
  if (args?.operation === "modify") {
    return [
      `Operation: modify existing diagram.`,
      `Target templateType: ${templateType}.`,
      `User request: ${prompt}`,
      `Template constraint: ${templateHints[templateType] ?? templateHints.basic}`,
      `Current document JSON:`,
      JSON.stringify(baseDocument),
      `Return the complete updated FlowchartDocument JSON, not a patch.`,
    ].join("\n");
  }
  return [
    `Operation: generate new diagram.`,
    `Target templateType: ${templateType}.`,
    `User request: ${prompt}`,
    `Template constraint: ${templateHints[templateType] ?? templateHints.basic}`,
    `Return one complete FlowchartDocument JSON.`,
  ].join("\n");
}

async function requestFlowchartCompletion(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
  timeoutMs: number
): Promise<string> {
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    },
    timeoutMs
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Flowchart AI failed: HTTP ${response.status}${text ? ` ${truncateText(text, 1200)}` : ""}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { content: text };
  }
  return extractChatCompletionContent(parsed);
}

export async function runFlowchartAiWithSettings(
  localSettingsService: LocalSettingsService,
  args: FlowchartAiRunArgs
): Promise<FlowchartAiRunResult> {
  const prompt = toNullableText(args?.prompt);
  if (!prompt) throw new Error("Flowchart AI prompt is required.");

  const { settings } = await localSettingsService.read();
  const aiSettings = settings.flowchartAi;
  if (!aiSettings.enabled) throw new Error("Flowchart AI is not enabled. Enable it in settings first.");
  if (!aiSettings.baseUrl) throw new Error("Flowchart AI service URL is not configured.");
  if (!aiSettings.apiKey) throw new Error("Flowchart AI API Key is not configured.");

  const endpoint = normalizeOpenAiChatCompletionsEndpoint(aiSettings.baseUrl);
  const timeoutMs = toIntegerInRange(
    aiSettings.timeoutMs,
    DEFAULT_FLOWCHART_AI_TIMEOUT_MS,
    MIN_FLOWCHART_AI_TIMEOUT_MS,
    MAX_FLOWCHART_AI_TIMEOUT_MS
  );
  const templateType = normalizeFlowchartTemplateType(args?.templateType);
  const fallbackDocument =
    args?.operation === "modify" && args.currentDocument
      ? normalizeFlowchartDocument(args.currentDocument).document
      : createDefaultFlowchartDocument(templateType, prompt);
  const messages = [
    { role: "system" as const, content: buildFlowchartAiSystemPrompt() },
    { role: "user" as const, content: buildFlowchartAiUserPrompt(args, fallbackDocument) },
  ];

  let rawResponse: string | null = null;
  try {
    rawResponse = await requestFlowchartCompletion(endpoint, aiSettings.apiKey, aiSettings.model, messages, timeoutMs);
    const parsed = extractJsonPayload(rawResponse);
    const normalized = normalizeFlowchartDocument(parsed, {
      ...fallbackDocument,
      templateType,
      prompt,
      updatedAt: Date.now(),
    });
    if (normalized.errors.length === 0 && normalized.document.nodes.length > 0) {
      return {
        ok: true,
        document: { ...normalized.document, prompt, updatedAt: Date.now() },
        rawResponse,
        repaired: false,
        validationErrors: [],
      };
    }

    const repairPrompt = [
      "The previous JSON failed validation for this flowchart workbench.",
      `Validation errors: ${normalized.errors.join("; ")}`,
      "Return corrected strict JSON only using the required schema.",
      "Original user request:",
      prompt,
      "Invalid/raw response:",
      rawResponse,
    ].join("\n");
    const repairedRaw = await requestFlowchartCompletion(
      endpoint,
      aiSettings.apiKey,
      aiSettings.model,
      [
        { role: "system", content: buildFlowchartAiSystemPrompt() },
        { role: "user", content: repairPrompt },
      ],
      timeoutMs
    );
    rawResponse = repairedRaw;
    const repaired = normalizeFlowchartDocument(extractJsonPayload(repairedRaw), {
      ...fallbackDocument,
      templateType,
      prompt,
      updatedAt: Date.now(),
    });
    if (repaired.document.nodes.length > 0 && repaired.errors.length === 0) {
      return {
        ok: true,
        document: { ...repaired.document, prompt, updatedAt: Date.now() },
        rawResponse: repairedRaw,
        repaired: true,
        validationErrors: normalized.errors,
      };
    }
    return {
      ok: false,
      errorMessage: "AI returned JSON that still failed validation after one repair attempt.",
      rawResponse: repairedRaw,
      repaired: true,
      validationErrors: [...normalized.errors, ...repaired.errors],
    };
  } catch (error: any) {
    return {
      ok: false,
      errorMessage: String(error?.message ?? error ?? "Flowchart AI failed."),
      rawResponse,
      repaired: Boolean(rawResponse),
      validationErrors: [],
    };
  }
}

export function registerFlowchartHandlers(deps: {
  localSettingsService: LocalSettingsService;
  flowchartHistoryService: FlowchartHistoryService;
}) {
  const { localSettingsService, flowchartHistoryService } = deps;

  ipcMain.handle(IPC_APP_CHANNELS.appFlowchartHistoryList, async () => {
    return { items: await flowchartHistoryService.list() };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appFlowchartHistoryUpsert, async (_evt, args: { document: FlowchartDocument }) => {
    const result = await flowchartHistoryService.upsert(args?.document);
    return { ok: true as const, ...result };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appFlowchartHistoryDelete, async (_evt, args: { id: string }) => {
    const result = await flowchartHistoryService.delete(args?.id);
    return { ok: true as const, ...result };
  });

  ipcMain.handle(IPC_APP_CHANNELS.appFlowchartAiRun, async (_evt, args: FlowchartAiRunArgs) => {
    return await runFlowchartAiWithSettings(localSettingsService, args);
  });
}
