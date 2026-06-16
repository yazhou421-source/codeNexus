import { Download, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { IMAGE_GENERATION_DYNAMIC_TOOL_NAME } from "@codenexus/shared/dynamicTools";
import { codexDesktop } from "../../../api/codexDesktopClient";
import {
  buildComposeDraftFromStructuredText,
  buildStructuredTextSegments,
  hasMeaningfulComposeText,
} from "../../../domain/composeFileMentions";
import { buildDynamicToolTimelineItemFromProtocolItem } from "../../../domain/dynamicTools";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { splitEnvironmentContextSegments } from "../../../domain/taggedMessageBlocks";
import type {
  CollaborationModeKind,
  ComposeImageAttachment,
  ComposeWorkspaceFileMention,
  TimelineEventItem,
  TimelineUserMessageParams,
} from "../../../domain/types";
import { basenameFromPath } from "../../../domain/workspaceFiles";
import { buildGuardianApprovalReviewActivity, isGuardianApprovalReviewMethod } from "../../../features/guardian/guardianApprovalReview";
import { buildImageToolItemFromProtocolItem } from "../../../features/timeline/imageToolRender";
import { renderMarkdownToSafeHtml } from "../../../features/timeline/markdownRenderer";
import {
  buildMcpToolDefinitionIndex,
  buildTimelineRenderNodes,
  type CommandSessionNode,
  type McpResourceReadNode,
  type ReasoningBlockNode,
  type TimelineRenderNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import { getDiffLineStats } from "../../../features/timeline/renderModel/diff";
import { formatTime, isLocalUserEvent, isMarkdownEvent } from "../../../features/timeline/renderModel/formatters";
import { extractWebSearchTimelineItem } from "../../../features/timeline/webSearch";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useMcpResourceStore } from "../../../stores/mcpResource.store";
import { useMcpStore } from "../../../stores/mcp.store";
import { useRuntimeStore, type SandboxMode } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import { useViewPrefsStore } from "../../../stores/viewPrefs.store";
import { useWorkspaceFilesStore } from "../../../stores/workspaceFiles.store";
import { showToast } from "../../../ui/toast";
import WaveText from "../../ui/WaveText";
import ChatPinnedUserPromptBox from "../../chat/ChatPinnedUserPromptBox";
import type {
  ChatAuxActivityGroupRow,
  ChatAuxActivityStatus,
  ChatAuxActivitySummaryItem,
  ChatAuxiliaryRow,
  ChatImageEntry,
  ChatInlineRewriteDraft,
  ChatRenderedRow,
  ChatRow,
  ChatUserMessagePart,
  ChatUserMessageSnapshot,
  ChatWebSearchItem,
  ImageToolItemWithImages,
  ImagePreviewPayload,
  LazyImageSourceKind,
  PlanDeltaExecUiState,
  ThumbLoadErrorPayload,
} from "../types/chat.types";
import ChatTimelineViewport from "./ChatTimelineViewport";
import ChatRowRenderer from "./ChatRowRenderer";
import { CHAT_ROW_ACTIVITY_CLASS, CHAT_ROW_BASE_CLASS } from "./chatPresentation";
import { chatActivityToneClass } from "./chatStyle";
import type { TimelineViewportAdapter } from "./timelineScrollPolicy";
import { resolveVscodeEntryIcon } from "../workspace/vscodeFileIcons";

export type ChatPaneProps = {
  contentEvents?: TimelineEventItem[];
  contentRevision?: number;
  workspaceRoot?: string;
  trailingThinkingEvent?: TimelineEventItem | null;
  trailingContextCompactionEvent?: TimelineEventItem | null;
  timelineKey?: string;
  scrollElement?: HTMLElement | null;
  onLayoutChange?: () => void;
  onViewportAdapterChange?: (adapter: TimelineViewportAdapter | null) => void;
  inlineRewriteCloseSeq?: number;
  modelOptions?: readonly (string | { value: string; label: string; disabled?: boolean })[];
  reasoningEffortOptions?: readonly (string | { value: string; label: string; disabled?: boolean })[];
  sandboxModeOptions?: readonly (string | { value: string; label: string; disabled?: boolean })[];
  sendDisabled?: boolean;
  [key: string]: unknown;
};

const STREAM_NOTIFICATION_ACTIVITY_METHODS = new Set([
  "command/exec/outputDelta",
  "item/commandExecution/terminalInteraction",
]);
const DIRECT_STREAMING_MODEL_METHODS = new Set([
  "item/plan/delta",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
]);
const AUX_ACTIVITY_KIND_ORDER = ["reasoning", "search", "command", "mcp", "tool", "activity"] as const;
const AUX_ACTIVITY_KIND_LABELS: Record<(typeof AUX_ACTIVITY_KIND_ORDER)[number], string> = {
  reasoning: "思考",
  search: "搜索",
  command: "命令",
  mcp: "MCP",
  tool: "工具",
  activity: "活动",
};
const paramsObjectSignatureIds = new WeakMap<object, number>();
let nextParamsObjectSignatureId = 1;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.18;
const PINNED_PROMPT_TOP_GAP_PX = 0;

function toEventParamsObject(event: TimelineEventItem): Record<string, any> {
  return event.params && typeof event.params === "object" && !Array.isArray(event.params)
    ? (event.params as Record<string, any>)
    : {};
}

function shortenActivityText(value: unknown, max = 220): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function decodeBase64Utf8(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {}
  return raw;
}

function streamNotificationActivityText(event: TimelineEventItem): string {
  const params = toEventParamsObject(event);
  if (event.method === "command/exec/outputDelta") {
    const stream = String(params.stream ?? "").trim();
    const text = decodeBase64Utf8(params.deltaBase64);
    const suffix = params.capReached === true ? "…（已截断）" : "";
    return `命令输出${stream ? ` ${stream}` : ""}：${shortenActivityText(text || event.paramsText || "收到输出")}${suffix}`;
  }
  if (event.method === "item/commandExecution/terminalInteraction") {
    const stdin = String(params.stdin ?? event.paramsText ?? "").trim();
    return `终端输入：${shortenActivityText(stdin || "空输入")}`;
  }
  return "";
}

function isFinalAnswerAgentMessageEvent(event: TimelineEventItem): boolean {
  if (event.method !== "item/agentMessage/delta") return false;
  const item = toEventParamsObject(event).item;
  return String(item && typeof item === "object" ? (item as Record<string, any>).phase : "").trim() === "final_answer";
}

function isIntermediateAgentMessageEvent(event: TimelineEventItem): boolean {
  if (event.method !== "item/agentMessage/delta") return false;
  const item = toEventParamsObject(event).item;
  const phase = String(item && typeof item === "object" ? (item as Record<string, any>).phase : "").trim();
  return phase === "commentary" || phase === "";
}

function paramsObjectSignature(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  let id = paramsObjectSignatureIds.get(value);
  if (id == null) {
    id = nextParamsObjectSignatureId;
    nextParamsObjectSignatureId += 1;
    paramsObjectSignatureIds.set(value, id);
  }
  return String(id);
}

function uniqueNonEmptyStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function extractUrlHost(value: string): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).host;
  } catch {}
  try {
    return new URL(`https://${text}`).host;
  } catch {}
  return "";
}

function isLocalDynamicImageGenerationEvent(event: TimelineEventItem): boolean {
  return String(event.id ?? "").startsWith("local:imageGeneration:");
}

function getLocalDynamicImageGenerationCallId(event: TimelineEventItem): string {
  if (!isLocalDynamicImageGenerationEvent(event)) return "";
  const item = ((event.params ?? {}) as any).item;
  return item && typeof item === "object" && !Array.isArray(item) ? String(item.id ?? "").trim() : "";
}

function isAuxiliaryRow(row: ChatRow): row is ChatAuxiliaryRow {
  return (
    row.kind === "activity" ||
    row.kind === "assistantCommentary" ||
    row.kind === "imageTool" ||
    row.kind === "dynamicTool" ||
    row.kind === "webSearch" ||
    row.kind === "reasoningBlock" ||
    row.kind === "fileChange" ||
    row.kind === "commandAction" ||
    row.kind === "commandSession" ||
    row.kind === "commandRead" ||
    row.kind === "commandList" ||
    row.kind === "commandSearch" ||
    row.kind === "mcpResourceRead" ||
    row.kind === "mcpToolGroup"
  );
}

function auxActivityKind(row: ChatAuxiliaryRow): (typeof AUX_ACTIVITY_KIND_ORDER)[number] {
  if (row.kind === "reasoningBlock") return "reasoning";
  if (row.kind === "webSearch") return "search";
  if (row.kind.startsWith("command")) return "command";
  if (row.kind === "mcpResourceRead" || row.kind === "mcpToolGroup") return "mcp";
  if (row.kind === "imageTool" || row.kind === "dynamicTool") return "tool";
  return "activity";
}

function rowIsRunning(row: ChatAuxiliaryRow): boolean {
  if (row.kind === "activity") return row.tone === "running";
  if (row.kind === "webSearch") return row.item.status === "running";
  if (row.kind === "imageTool") return row.item.status === "running";
  if (row.kind === "dynamicTool") return row.item.status === "running" || row.item.status === "awaitingApproval";
  if (row.kind === "fileChange") return row.item.status === "running";
  if (row.kind === "mcpToolGroup") return row.group.stats.running > 0;
  if (row.kind === "mcpResourceRead") return row.item.status === "running";
  if (row.kind === "commandAction") return row.item.item.status === "running";
  if (row.kind === "commandSession" || row.kind === "commandRead" || row.kind === "commandList" || row.kind === "commandSearch") {
    return row.item.status === "running";
  }
  return false;
}

function mergeAuxActivityStatus(items: ChatAuxiliaryRow[]): ChatAuxActivityStatus {
  return items.some(rowIsRunning) ? "running" : "completed";
}

function buildAuxFileChangeStats(items: ChatAuxiliaryRow[]) {
  const files = new Set<string>();
  let addedLines = 0;
  let deletedLines = 0;
  for (const row of items) {
    if (row.kind !== "fileChange") continue;
    for (const file of row.item.files) {
      const key = String(file.pathRelTo ?? file.pathAbsTo ?? file.pathRel ?? file.pathAbs ?? "").trim();
      if (key) files.add(key);
      const stats = getDiffLineStats(file.diffText, file.kind);
      addedLines += stats.add;
      deletedLines += stats.del;
    }
  }
  if (files.size <= 0 && addedLines <= 0 && deletedLines <= 0) return null;
  return { fileCount: files.size, addedLines, deletedLines };
}

function buildAuxActivityGroup(params: {
  items: ChatAuxiliaryRow[];
  groupIndex: number;
  defaultCollapsed: boolean;
  startedAtMs: number | null;
  answerStartedAtMs: number | null;
  elapsedLive: boolean;
}): ChatAuxActivityGroupRow {
  const counts = new Map<string, number>();
  for (const item of params.items) {
    if (item.kind === "fileChange") continue;
    const kind = auxActivityKind(item);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const summaryItems: ChatAuxActivitySummaryItem[] = AUX_ACTIVITY_KIND_ORDER.flatMap((key) => {
    const count = counts.get(key) ?? 0;
    const label = AUX_ACTIVITY_KIND_LABELS[key];
    return count > 0 ? [{ key, label, count }] : [];
  });
  const fileChangeStats = buildAuxFileChangeStats(params.items);
  if (fileChangeStats) {
    summaryItems.push({
      key: "files",
      label: "文件",
      count: fileChangeStats.fileCount,
      valueText: String(fileChangeStats.fileCount),
      addText: `+${fileChangeStats.addedLines}`,
      delText: `-${fileChangeStats.deletedLines}`,
    });
  }
  const summaryText = summaryItems
    .map((item) => [item.label, item.valueText ?? item.count, item.addText, item.delText].filter(Boolean).join(" "))
    .join(" · ");
  const first = params.items[0];
  return {
    id: `aux:${params.groupIndex}:${first?.id ?? "empty"}`,
    turnKey: first?.turnKey ?? "",
    kind: "auxActivityGroup",
    items: [...params.items],
    summaryItems,
    summaryText: summaryText || `活动 ${params.items.length}`,
    status: mergeAuxActivityStatus(params.items),
    defaultCollapsed: params.defaultCollapsed,
    startedAtMs: params.startedAtMs,
    answerStartedAtMs: params.answerStartedAtMs,
    elapsedLive: params.elapsedLive,
  };
}

function chatAuxRowCreatedAt(row: ChatAuxiliaryRow): number | null {
  if (row.kind === "activity" || row.kind === "imageTool" || row.kind === "dynamicTool" || row.kind === "webSearch") {
    return Number.isFinite(row.createdAt) ? Number(row.createdAt) : null;
  }
  if (row.kind === "assistantCommentary") return Number.isFinite(row.event.createdAt) ? Number(row.event.createdAt) : null;
  if (row.kind === "mcpToolGroup") return Number.isFinite(row.group.createdAt) ? Number(row.group.createdAt) : null;
  const item = row.item as { createdAt?: unknown; startedAt?: unknown };
  const startedAt = Number(item.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) return Math.round(startedAt);
  const createdAt = Number(item.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0 ? Math.round(createdAt) : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toStringArray(value: unknown, opts?: { keepEmpty?: boolean }): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "")).filter((item) => (opts?.keepEmpty ? true : !!item.trim()))
    : [];
}

function inferLazyImageSourceKind(value: string): LazyImageSourceKind {
  const text = String(value ?? "").trim();
  if (!text) return "remoteUrl";
  if (text.startsWith("data:image/")) return "dataUrl";
  if (/^https?:\/\//i.test(text)) return "remoteUrl";
  return "localPath";
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function sanitizeDownloadName(value: string): string {
  return (
    String(value ?? "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ") || "image"
  );
}

function extensionFromImageSrc(src: string): string {
  const text = String(src ?? "").trim();
  const dataMatch = text.match(/^data:image\/([a-z0-9.+-]+);/i);
  if (dataMatch?.[1]) {
    const ext = dataMatch[1].toLowerCase();
    if (ext === "jpeg") return "jpg";
    if (ext === "svg+xml") return "svg";
    return ext;
  }
  try {
    const ext = new URL(text).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    if (ext) return ext.toLowerCase();
  } catch {}
  return "png";
}

function cloneInlineAttachments(items: ComposeImageAttachment[]): ComposeImageAttachment[] {
  return items.map((item) => ({
    ...item,
    input: { ...item.input },
  }));
}

function cloneInlineMentions(items: ComposeWorkspaceFileMention[]): ComposeWorkspaceFileMention[] {
  return items.map((item) => ({ ...item }));
}

function buildInlineRewriteAttachments(event: TimelineEventItem, snapshot: ChatUserMessageSnapshot): ComposeImageAttachment[] {
  const attachments: ComposeImageAttachment[] = [];
  snapshot.images.forEach((url, index) => {
    const source = String(url ?? "").trim();
    if (!source) return;
    attachments.push({
      id: `${event.id}:inline-image:${index}`,
      name: `image-${index + 1}`,
      size: 0,
      mimeType: source.startsWith("data:image/") ? `image/${extensionFromImageSrc(source)}` : "image/*",
      previewUrl: source,
      revokePreviewUrlOnDispose: false,
      input: { type: "image", url: source },
    });
  });
  snapshot.localImages.forEach((path, index) => {
    const source = String(path ?? "").trim();
    if (!source) return;
    attachments.push({
      id: `${event.id}:inline-local-image:${index}`,
      name: basenameFromPath(source) || `local-image-${index + 1}`,
      size: 0,
      mimeType: "image/*",
      previewUrl: source,
      revokePreviewUrlOnDispose: false,
      input: { type: "localImage", path: source },
    });
  });
  return attachments;
}

export default function ChatPane({
  contentEvents = [],
  contentRevision,
  workspaceRoot = "",
  trailingThinkingEvent = null,
  trailingContextCompactionEvent = null,
  timelineKey = "__app__",
  scrollElement = null,
  onLayoutChange,
  onViewportAdapterChange,
  inlineRewriteCloseSeq,
  modelOptions = [],
  reasoningEffortOptions = [],
  sandboxModeOptions = [],
  sendDisabled = false,
}: ChatPaneProps) {
  const runtimeStore = useRuntimeStore();
  const threadStore = useThreadStore();
  const viewPrefs = useViewPrefsStore();
  const mcpStore = useMcpStore();
  const mcpResourceStore = useMcpResourceStore();
  const appShellStore = useAppShellStore();
  const workspaceFilesStore = useWorkspaceFilesStore();
  const localViewportAdapter = useRef<TimelineViewportAdapter | null>(null);
  const baseRowsCache = useRef<{ signature: string; rows: ChatRow[] } | null>(null);
  const turnRowsCacheByKey = useRef(new Map<string, { signature: string; rows: ChatRow[] }>());
  const pinnedPromptLayerRef = useRef<HTMLDivElement | null>(null);
  const imageLightboxCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const dragState = useRef({ pointerId: null as number | null, startX: 0, startY: 0, panX: 0, panY: 0 });

  const [hiddenImageIds, setHiddenImageIds] = useState<Set<string>>(() => new Set());
  const [reasoningOpenById, setReasoningOpenById] = useState<Map<string, boolean>>(() => new Map());
  const [autoCollapsedReasoningIds, setAutoCollapsedReasoningIds] = useState<Set<string>>(() => new Set());
  const [mcpToolGroupOpenByKey, setMcpToolGroupOpenByKey] = useState<Map<string, boolean>>(() => new Map());
  const [mcpResourceOpenByKey, setMcpResourceOpenByKey] = useState<Map<string, boolean>>(() => new Map());
  const [commandFilesOpenById, setCommandFilesOpenById] = useState<Map<string, boolean>>(() => new Map());
  const [stoppingCommandProcessIds, setStoppingCommandProcessIds] = useState<Set<string>>(() => new Set());
  const [inlineRewriteDraft, setInlineRewriteDraft] = useState<ChatInlineRewriteDraft | null>(null);
  const [planExecStateByEventId, setPlanExecStateByEventId] = useState<Record<string, PlanDeltaExecUiState>>({});
  const [pinnedUserRowId, setPinnedUserRowIdState] = useState("");
  const [pinnedPromptTransitionDirection, setPinnedPromptTransitionDirection] = useState<"up" | "down">("up");
  const [imageLightboxOpen, setImageLightboxOpen] = useState(false);
  const [imageLightboxSrc, setImageLightboxSrc] = useState("");
  const [imageLightboxTitle, setImageLightboxTitle] = useState("");
  const [imageLightboxZoom, setImageLightboxZoom] = useState(1);
  const [imageLightboxPan, setImageLightboxPan] = useState({ x: 0, y: 0 });
  const [imageLightboxDragging, setImageLightboxDragging] = useState(false);
  const isTurnRunning = Boolean(runtimeStore.currentThreadId && threadStore.runningThreadIds.has(runtimeStore.currentThreadId));

  useEffect(() => setHiddenImageIds(new Set()), [timelineKey]);
  useEffect(() => setInlineRewriteDraft(null), [timelineKey, inlineRewriteCloseSeq]);
  useEffect(() => {
    const ids = contentEvents
      .filter((event) => event.method === "item/plan/delta")
      .map((event) => String(event.id ?? "").trim())
      .filter(Boolean);
    const alive = new Set(ids);
    setPlanExecStateByEventId((prev) => {
      let changed = false;
      const next: Record<string, PlanDeltaExecUiState> = {};
      for (const id of ids) {
        const existing = prev[id];
        if (existing) {
          next[id] = existing;
        } else {
          changed = true;
          next[id] = {
            model: runtimeStore.model,
            reasoningEffort: runtimeStore.reasoningEffort,
            sandboxMode: runtimeStore.sandboxMode,
            executing: false,
            collapseWhileExecuting: false,
          };
        }
      }
      if (Object.keys(prev).some((id) => !alive.has(id))) changed = true;
      return changed ? next : prev;
    });
  }, [contentEvents, runtimeStore.model, runtimeStore.reasoningEffort, runtimeStore.sandboxMode]);
  useEffect(() => {
    if (isTurnRunning) return;
    setPlanExecStateByEventId((prev) => {
      let changed = false;
      const next: Record<string, PlanDeltaExecUiState> = {};
      for (const [id, state] of Object.entries(prev)) {
        if (state.executing || state.collapseWhileExecuting) changed = true;
        next[id] = { ...state, executing: false, collapseWhileExecuting: false };
      }
      return changed ? next : prev;
    });
  }, [isTurnRunning]);

  const mcpToolDefinitions = useMemo(() => buildMcpToolDefinitionIndex(mcpStore.servers), [mcpStore.servers]);
  const getMarkdownEventHtml = useCallback(
    (event: TimelineEventItem) => renderMarkdownToSafeHtml(String(event.paramsText ?? ""), { cache: true }),
    []
  );

  const toWebSearchChatItem = useCallback((event: TimelineEventItem): ChatWebSearchItem | null => {
    const normalized = extractWebSearchTimelineItem(event);
    if (!normalized) return null;
    const actionType = normalized.action.type;
    let title = "网页搜索";
    let actionLabel = "其他";
    let primaryText = normalized.query || "网页操作";
    let secondaryText = "";
    let summaryText = normalized.query || "网页操作";
    let queries: string[] = [];
    let url = "";
    let pattern = "";
    let host = "";
    if (actionType === "search") {
      actionLabel = "搜索";
      queries = uniqueNonEmptyStrings([normalized.action.query, ...(normalized.action.queries || [])]);
      primaryText = queries[0] || normalized.query || "搜索网页";
      secondaryText = queries.length > 1 ? `共 ${queries.length} 个查询` : "";
      summaryText = queries.join(" ｜ ") || primaryText;
    } else if (actionType === "openPage") {
      title = "打开页面";
      actionLabel = "打开";
      url = normalized.action.url || normalized.query || "";
      host = extractUrlHost(url);
      primaryText = host || url || "打开搜索结果页面";
      secondaryText = host && url ? url : "";
      summaryText = url || primaryText;
    } else if (actionType === "findInPage") {
      title = "页内查找";
      actionLabel = "查找";
      url = normalized.action.url || "";
      pattern = normalized.action.pattern || "";
      host = extractUrlHost(url);
      primaryText = pattern || "页内查找";
      secondaryText = url ? `${host || "页面"}${pattern ? ` ｜ ${url}` : ""}` : "";
      summaryText = pattern
        ? url
          ? `关键词：${pattern} ｜ 页面：${url}`
          : `关键词：${pattern}`
        : url || normalized.query || "页内查找";
    }
    return { itemId: normalized.itemId, actionType, status: normalized.status, title, summaryText, actionLabel, primaryText, secondaryText, queries, url, pattern, host };
  }, []);

  const buildChatRowsFromNodes = useCallback(
    (nodes: TimelineRenderNode[], threadKeyFallback: string): ChatRow[] => {
      const rows: ChatRow[] = [];
      const rowIndexById = new Map<string, number>();
      const localImageGenerationCallIds = new Set(
        nodes.map((node) => (node.kind === "event" ? getLocalDynamicImageGenerationCallId(node.event) : "")).filter(Boolean)
      );
      const pushRow = (row: ChatRow) => {
        rowIndexById.set(row.id, rows.length);
        rows.push(row);
      };
      const upsertRow = (row: ChatRow) => {
        const index = rowIndexById.get(row.id);
        if (index != null) rows[index] = { ...row, turnKey: rows[index].turnKey || row.turnKey };
        else pushRow(row);
      };
      const toChatTurnKey = (turnIdValue: unknown, fallbackValue: unknown, threadKey: string) => {
        const turnId = String(turnIdValue ?? "").trim();
        return turnId ? `turn:${turnId}` : `loose:${String(fallbackValue ?? "").trim() || threadKey || "__app__"}`;
      };

      for (const node of nodes) {
        const turnKey =
          node.kind === "event"
            ? toChatTurnKey(node.event.turnId, String(node.event.id ?? "").trim() || node.id, threadKeyFallback)
            : node.kind === "mcpToolGroup"
              ? toChatTurnKey(node.group.turnId, node.id, threadKeyFallback)
              : toChatTurnKey(node.item.turnId, node.id, threadKeyFallback);

        if (node.kind === "event") {
          const e = node.event;
          if (isLocalUserEvent(e)) {
            pushRow({ id: `u:${e.id}`, turnKey, kind: "user", event: e });
            continue;
          }
          if (e.method === "history/contextInjected") {
            const p = (e.params ?? {}) as any;
            const f = (typeof p.file === "string" ? p.file : (String(e.paramsText ?? "").match(/\bfile=([^\s]+)\b/)?.[1] ?? "")).trim();
            const r = typeof p.rules === "number" ? p.rules : null;
            pushRow({
              id: `x:${e.id}`,
              turnKey,
              kind: "activity",
              text: f
                ? `读取 ${f} 文件${r && r > 0 ? `（规则 ${r}）` : ""}`
                : String(e.paramsText ?? "").trim() || "已注入上下文",
              createdAt: e.createdAt,
            });
            continue;
          }
          if (isGuardianApprovalReviewMethod(e.method)) {
            const g = buildGuardianApprovalReviewActivity(e.method, e.params);
            if (g) {
              pushRow({
                id: `guardian:${e.id}`,
                turnKey,
                kind: "activity",
                text: g.summaryText || String(e.paramsText ?? "").trim() || "Guardian 复核",
                createdAt: e.createdAt,
                tone: g.tone,
              });
              continue;
            }
          }
          if (STREAM_NOTIFICATION_ACTIVITY_METHODS.has(e.method)) {
            const text = streamNotificationActivityText(e);
            if (text) {
              pushRow({ id: `stream:${e.id}`, turnKey, kind: "activity", text, createdAt: e.createdAt });
              continue;
            }
          }
          if (e.method === "item/agentMessage/delta" && isMarkdownEvent(e) && isIntermediateAgentMessageEvent(e)) {
            if (String(e.paramsText ?? "").trim()) pushRow({ id: `agent-commentary:${e.id}`, turnKey, kind: "assistantCommentary", event: e });
            continue;
          }
          if ((e.method === "item/agentMessage/delta" && isMarkdownEvent(e) && isFinalAnswerAgentMessageEvent(e)) || e.method === "item/plan/delta") {
            pushRow({ id: `a:${e.id}`, turnKey, kind: "assistant", event: e });
            continue;
          }
          if (e.method === "item/started" || e.method === "item/completed") {
            const item = ((e.params ?? {}) as any).item;
            const type = item && typeof item === "object" ? String(item.type ?? "").trim() : "";
            if (type === "dynamicToolCall") {
              const dynamicToolItem = buildDynamicToolTimelineItemFromProtocolItem(item);
              if (dynamicToolItem) {
                if (dynamicToolItem.toolName === IMAGE_GENERATION_DYNAMIC_TOOL_NAME && localImageGenerationCallIds.has(dynamicToolItem.callId)) continue;
                upsertRow({ id: `dyntool:${dynamicToolItem.callId}`, turnKey, kind: "dynamicTool", createdAt: e.createdAt, item: dynamicToolItem });
              }
              continue;
            }
            if (type === "imageView" || (type === "imageGeneration" && isLocalDynamicImageGenerationEvent(e))) {
              const imageToolItem = buildImageToolItemFromProtocolItem(item, e.method);
              if (imageToolItem) upsertRow({ id: `imgtool:${imageToolItem.itemType}:${imageToolItem.itemId}`, turnKey, kind: "imageTool", createdAt: e.createdAt, item: imageToolItem });
              continue;
            }
            if (type === "webSearch") {
              const wsi = toWebSearchChatItem(e);
              if (wsi) upsertRow({ id: `websearch:${wsi.itemId}`, turnKey, kind: "webSearch", createdAt: e.createdAt, item: wsi });
              continue;
            }
          }
          if (e.method === "rawResponseItem/completed") {
            const item = ((e.params ?? {}) as any).item;
            const imageToolItem = buildImageToolItemFromProtocolItem(item, e.method);
            if (imageToolItem) {
              upsertRow({ id: `imgtool:${imageToolItem.itemType}:${imageToolItem.itemId}`, turnKey, kind: "imageTool", createdAt: e.createdAt, item: imageToolItem });
              continue;
            }
          }
          if (e.level === "error") pushRow({ id: `s:${e.id}`, turnKey, kind: "system", text: String(e.paramsText ?? "").trim() || e.method });
          continue;
        }

        if (node.kind === "reasoningBlock") pushRow({ id: `r:${node.id}`, turnKey, kind: "reasoningBlock", item: node.item });
        else if (node.kind === "fileChange") pushRow({ id: `f:${node.id}`, turnKey, kind: "fileChange", item: node.item });
        else if (node.kind === "commandAction") pushRow({ id: `c:${node.id}`, turnKey, kind: "commandAction", item: node.item });
        else if (node.kind === "commandSession") pushRow({ id: `csess:${node.id}`, turnKey, kind: "commandSession", item: node.item });
        else if (node.kind === "commandRead") pushRow({ id: `cr:${node.id}`, turnKey, kind: "commandRead", item: node.item });
        else if (node.kind === "commandList") pushRow({ id: `cl:${node.id}`, turnKey, kind: "commandList", item: node.item });
        else if (node.kind === "commandSearch") pushRow({ id: `cs:${node.id}`, turnKey, kind: "commandSearch", item: node.item });
        else if (node.kind === "mcpResourceRead") pushRow({ id: `mr:${node.id}`, turnKey, kind: "mcpResourceRead", item: node.item });
        else if (node.kind === "mcpToolGroup") pushRow({ id: `m:${node.id}`, turnKey, kind: "mcpToolGroup", group: node.group });
      }
      return rows;
    },
    [toWebSearchChatItem]
  );

  const rows = useMemo<ChatRenderedRow[]>(() => {
    void contentRevision;
    const threadKey = String(runtimeStore.timelineKey ?? "__app__").trim() || "__app__";
    const definitionsSignature = mcpToolDefinitions instanceof Map ? [...mcpToolDefinitions.keys()].sort().join("|") : "";
    const eventStructureSignature = (event: TimelineEventItem) => {
      const params = toEventParamsObject(event);
      const item = params.item && typeof params.item === "object" ? (params.item as Record<string, any>) : null;
      const base = [
        event.id,
        event.method,
        event.turnId ?? "",
        event.level ?? "",
        event.localKind ?? "",
        event.localState ?? "",
        event.thinkingPhase ?? "",
        event.hidden ? "1" : "0",
        item ? String(item.type ?? "") : "",
        item ? String(item.id ?? "") : "",
        item ? String(item.phase ?? "") : "",
        item ? String(item.status ?? "") : "",
      ];
      if (!DIRECT_STREAMING_MODEL_METHODS.has(event.method)) {
        base.push(String(event.paramsText?.length ?? 0), paramsObjectSignature(event.params));
      }
      return base.join(":");
    };
    const eventTurnGroupKey = (event: TimelineEventItem) => {
      const turnId = String(event.turnId ?? "").trim();
      return turnId ? `turn:${turnId}` : `loose:${String(event.id ?? "").trim() || threadKey || "__app__"}`;
    };
    const groups: Array<{ key: string; events: TimelineEventItem[]; signature: string }> = [];
    const groupIndexByKey = new Map<string, number>();
    for (const event of contentEvents.filter((event) => !event.hidden)) {
      const key = eventTurnGroupKey(event);
      let index = groupIndexByKey.get(key);
      if (index == null) {
        index = groups.length;
        groupIndexByKey.set(key, index);
        groups.push({ key, events: [], signature: "" });
      }
      groups[index].events.push(event);
    }
    for (const group of groups) {
      group.signature = [threadKey, workspaceRoot, definitionsSignature, group.key, ...group.events.map(eventStructureSignature)].join("\n");
    }
    const signature = groups.map((group) => `${group.key}\n${group.signature}`).join("\n\n");
    const updateDirectStreamingRows = (inputRows: ChatRow[]) => {
      const eventsById = new Map(contentEvents.map((event) => [event.id, event]));
      let changed = false;
      const nextRows = inputRows.map((row) => {
        if (row.kind === "assistant" || row.kind === "assistantCommentary") {
          const event = eventsById.get(row.event.id);
          if (!event || event === row.event) return row;
          changed = true;
          return { ...row, event };
        }
        return row;
      });
      return changed ? nextRows : inputRows;
    };
    let baseRows: ChatRow[];
    if (baseRowsCache.current?.signature === signature) {
      baseRows = updateDirectStreamingRows(baseRowsCache.current.rows);
      baseRowsCache.current = { signature, rows: baseRows };
    } else {
      const activeKeys = new Set<string>();
      baseRows = [];
      for (const group of groups) {
        activeKeys.add(group.key);
        const cached = turnRowsCacheByKey.current.get(group.key);
        let groupRows = cached?.signature === group.signature ? cached.rows : null;
        if (!groupRows) {
          const nodes = buildTimelineRenderNodes({
            events: group.events,
            timelineKey: runtimeStore.timelineKey,
            workspaceRoot,
            debug: false,
            mcpToolDefinitions,
          });
          groupRows = buildChatRowsFromNodes(nodes, threadKey);
          turnRowsCacheByKey.current.set(group.key, { signature: group.signature, rows: groupRows });
        }
        baseRows.push(...groupRows);
      }
      for (const key of turnRowsCacheByKey.current.keys()) {
        if (!activeKeys.has(key)) turnRowsCacheByKey.current.delete(key);
      }
      baseRows = updateDirectStreamingRows(baseRows);
      baseRowsCache.current = { signature, rows: baseRows };
    }

    const withUsage: ChatRow[] = (() => {
      const threadId = String(runtimeStore.timelineKey ?? runtimeStore.currentThreadId ?? "").trim();
      if (!threadId || threadId === "__app__") return baseRows;
      const completedTurns = (threadStore.completedTurnsByThread.get(threadId) ?? []) as Array<{
        turnId: string;
        completedAt?: number | null;
      }>;
      const completedByTurnId = new Map(completedTurns.map((entry) => [entry.turnId, entry]));
      if (completedByTurnId.size === 0) return baseRows;
      const appendedTurnIds = new Set<string>();
      const next: ChatRow[] = [];
      for (let index = 0; index < baseRows.length; index += 1) {
        const row = baseRows[index];
        next.push(row);
        if (!row.turnKey.startsWith("turn:") || baseRows[index + 1]?.turnKey === row.turnKey) continue;
        const turnId = row.turnKey.slice("turn:".length).trim();
        if (!turnId || appendedTurnIds.has(turnId)) continue;
        const completed = completedByTurnId.get(turnId);
        const usage = threadStore.tokenUsageForTurn(threadId, turnId);
        if (!completed || !usage) continue;
        appendedTurnIds.add(turnId);
        next.push({
          id: `usage:${threadId}:${turnId}`,
          turnKey: row.turnKey,
          kind: "tokenUsageSummary",
          item: {
            threadId,
            turnId,
            completedAt: Number.isFinite(completed.completedAt) ? Number(completed.completedAt) : null,
            usage,
          },
        });
      }
      return next;
    })();

    const grouped: ChatRow[] = [];
    let pending: ChatAuxiliaryRow[] = [];
    let groupIndex = 0;
    const tid = String(runtimeStore.currentThreadId ?? "").trim();
    const activeTurnId = tid ? String(threadStore.activeTurnIdByThread.get(tid) ?? "").trim() : "";
    const activeTurnKey = activeTurnId ? `turn:${activeTurnId}` : "";
    const currentThreadRunning = Boolean(tid && threadStore.runningThreadIds.has(tid));
    const resolvePendingStartedAt = () => {
      const threadId = String(runtimeStore.timelineKey ?? runtimeStore.currentThreadId ?? "").trim();
      const turnId = String(pending[0]?.turnKey ?? "").startsWith("turn:") ? String(pending[0].turnKey).slice("turn:".length).trim() : "";
      const storedStartedAt = threadId && turnId ? threadStore.turnStartedAtByThread.get(threadId)?.get(turnId) : null;
      if (Number.isFinite(storedStartedAt) && Number(storedStartedAt) > 0) return Math.round(Number(storedStartedAt));
      const rowTimes = pending.map(chatAuxRowCreatedAt).filter((value): value is number => Number.isFinite(value) && Number(value) > 0);
      return rowTimes.length > 0 ? Math.min(...rowTimes) : null;
    };
    const isFinalAnswerRow = (row: ChatRow | null) => row?.kind === "assistant" && row.event.method === "item/agentMessage/delta";
    const flushPending = (interruptedBy: ChatRow | null) => {
      if (pending.length === 0) return;
      const groupStatus = mergeAuxActivityStatus(pending);
      const matchesActiveTurn = Boolean(activeTurnKey && pending.some((row) => row.turnKey === activeTurnKey));
      const finalAnswerStarted = isFinalAnswerRow(interruptedBy);
      const shouldStayOpen = !finalAnswerStarted && (groupStatus === "running" || (currentThreadRunning && matchesActiveTurn));
      const startedAtMs = resolvePendingStartedAt();
      const finalAnswerEvent = finalAnswerStarted && interruptedBy?.kind === "assistant" ? interruptedBy.event : null;
      const answerStartedAtMs = finalAnswerEvent && Number.isFinite(finalAnswerEvent.createdAt) ? Math.max(startedAtMs ?? 0, Math.round(Number(finalAnswerEvent.createdAt))) : null;
      grouped.push(buildAuxActivityGroup({ items: pending, groupIndex, defaultCollapsed: !shouldStayOpen, startedAtMs, answerStartedAtMs, elapsedLive: !finalAnswerStarted && (groupStatus === "running" || (currentThreadRunning && matchesActiveTurn)) }));
      groupIndex += 1;
      pending = [];
    };
    for (const row of withUsage) {
      if (isAuxiliaryRow(row)) {
        pending.push(row);
        continue;
      }
      flushPending(row);
      grouped.push(row);
    }
    flushPending(null);
    return grouped;
  }, [buildChatRowsFromNodes, contentEvents, contentRevision, mcpToolDefinitions, runtimeStore.currentThreadId, runtimeStore.timelineKey, threadStore, workspaceRoot]);

  useEffect(() => {
    const seen = new Set<string>();
    const candidates = new Set<string>();
    for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
      const row = rows[idx];
      if (!row.turnKey) continue;
      if (row.kind === "reasoningBlock") {
        if (seen.has(row.turnKey)) {
          const id = String(row.item.id ?? "").trim();
          if (id) candidates.add(id);
        }
      } else {
        seen.add(row.turnKey);
      }
    }
    const ids = [...candidates].filter((id) => !autoCollapsedReasoningIds.has(id));
    if (ids.length === 0) return;
    setAutoCollapsedReasoningIds((prev) => new Set([...prev, ...ids]));
    setReasoningOpenById((prev) => {
      const next = new Map(prev);
      ids.forEach((id) => next.set(id, false));
      return next;
    });
    onLayoutChange?.();
  }, [autoCollapsedReasoningIds, onLayoutChange, rows]);

  const asTimelineUserMessageParams = (event: TimelineEventItem): TimelineUserMessageParams | null => {
    if (event.method !== "user") return null;
    const params = toRecord(event.params);
    if (params?.role !== "user") return null;
    return params as TimelineUserMessageParams;
  };
  const getUserMessageSnapshot = (event: TimelineEventItem): ChatUserMessageSnapshot => {
    const params = asTimelineUserMessageParams(event);
    if (!params) return { text: "", textElements: undefined, images: [], localImages: [] };
    return {
      text: String(params.text ?? "").replace(/\r\n?/g, "\n"),
      textElements: params.text_elements,
      images: toStringArray(params.images, { keepEmpty: true }),
      localImages: toStringArray(params.local_images),
    };
  };
  const userMessageParts = (event: TimelineEventItem): ChatUserMessagePart[] => {
    const snapshot = getUserMessageSnapshot(event);
    const parts: ChatUserMessagePart[] = [];
    let index = 0;
    for (const segment of buildStructuredTextSegments(snapshot.text, snapshot.textElements, { inferAbsolutePaths: true })) {
      if (segment.type === "text") {
        for (const taggedSegment of splitEnvironmentContextSegments(segment.text)) {
          if (taggedSegment.type === "text") {
            if (taggedSegment.text) parts.push({ key: `${event.id}:text:${index}:${parts.length}`, type: "text", text: taggedSegment.text });
          } else {
            parts.push({ key: `${event.id}:environment:${index}:${parts.length}`, type: "environmentContext", context: taggedSegment.context });
          }
        }
      } else {
        const label = String(segment.placeholder ?? "").trim() || basenameFromPath(segment.path) || segment.path;
        parts.push({ key: `${event.id}:file:${index}:${segment.path}`, type: "file", path: segment.path, label, title: segment.path, icon: resolveVscodeEntryIcon(segment.path, { isDirectory: segment.kind === "directory" }) });
      }
      index += 1;
    }
    if (parts.length > 0) return parts;
    const fallbackText = String(event?.paramsText ?? "");
    return fallbackText
      ? splitEnvironmentContextSegments(fallbackText).map((segment, segmentIndex) =>
          segment.type === "text"
            ? { key: `${event.id}:fallback:${segmentIndex}`, type: "text", text: segment.text }
            : { key: `${event.id}:fallback-environment:${segmentIndex}`, type: "environmentContext", context: segment.context }
        )
      : [];
  };
  const userMessageImageEntries = (event: TimelineEventItem): ChatImageEntry[] => {
    const snapshot = getUserMessageSnapshot(event);
    const entries: ChatImageEntry[] = [];
    snapshot.images.forEach((source, i) => {
      const kind = inferLazyImageSourceKind(source);
      entries.push({ id: `${event.id}:img:${i + 1}:${source.length}`, sourceKind: kind === "localPath" ? "remoteUrl" : kind, source, title: `图片 ${i + 1}` });
    });
    snapshot.localImages.forEach((source, i) => {
      const name = basenameFromPath(source) || source;
      entries.push({ id: `${event.id}:local:${i + 1}:${name}`, sourceKind: "localPath", source, title: name });
    });
    return entries;
  };
  const userMessageImageCount = (event: TimelineEventItem) => {
    const snapshot = getUserMessageSnapshot(event);
    return snapshot.images.length + snapshot.localImages.length;
  };
  const visibleUserMessageImageEntries = (event: TimelineEventItem) => userMessageImageEntries(event).filter((entry) => entry.id && !hiddenImageIds.has(entry.id));
  const visibleImageToolEntries = (item: ImageToolItemWithImages) => (Array.isArray(item?.images) ? item.images : []).filter((entry) => entry?.id && !hiddenImageIds.has(entry.id));
  const onThumbLoadError = (payload: ThumbLoadErrorPayload) => {
    const id = String(payload?.imageId ?? "").trim();
    if (!id || hiddenImageIds.has(id)) return;
    setHiddenImageIds((prev) => new Set(prev).add(id));
    onLayoutChange?.();
  };
  const onUserFileTokenClick = (pathValue: string) => {
    const path = String(pathValue ?? "").trim();
    if (path) void workspaceFilesStore.openFile(path);
  };
  const closeInlineRewrite = () => setInlineRewriteDraft(null);
  const updateInlineRewriteDraft = (patch: Partial<ChatInlineRewriteDraft>) => {
    setInlineRewriteDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        ...patch,
        composeAttachments: patch.composeAttachments ? cloneInlineAttachments(patch.composeAttachments) : current.composeAttachments,
        composeFileMentions: patch.composeFileMentions ? cloneInlineMentions(patch.composeFileMentions) : current.composeFileMentions,
      };
    });
  };
  const openInlineRewrite = (event: TimelineEventItem) => {
    if (window.getSelection?.()?.toString().trim()) return;
    const anchorEventId = String(event?.id ?? "").trim();
    const anchorTurnId = String(event?.turnId ?? "").trim();
    if (!anchorEventId || !anchorTurnId) return;
    if (inlineRewriteDraft?.anchorEventId === anchorEventId) {
      closeInlineRewrite();
      return;
    }
    const snapshot = getUserMessageSnapshot(event);
    const draft = buildComposeDraftFromStructuredText(snapshot.text, snapshot.textElements, {
      inferAbsolutePaths: true,
      idPrefix: "inline-history-file",
    });
    setInlineRewriteDraft({
      anchorEventId,
      anchorTurnId,
      composeInput: draft.composeInput || snapshot.text || String(event?.paramsText ?? ""),
      composeFileMentions: draft.composeFileMentions,
      composeAttachments: buildInlineRewriteAttachments(event, snapshot),
      model: runtimeStore.model,
      reasoningEffort: runtimeStore.reasoningEffort,
      sandboxMode: runtimeStore.sandboxMode,
      composeMode: runtimeStore.composeMode as CollaborationModeKind,
      sending: false,
    });
  };
  const inlineRewriteSendDisabled = inlineRewriteDraft
    ? sendDisabled ||
      inlineRewriteDraft.sending ||
      (!hasMeaningfulComposeText(inlineRewriteDraft.composeInput) &&
        inlineRewriteDraft.composeAttachments.length === 0 &&
        inlineRewriteDraft.composeFileMentions.length === 0)
    : true;
  const sendInlineRewriteDraft = async () => {
    const draft = inlineRewriteDraft;
    if (!draft || inlineRewriteSendDisabled) return;
    setInlineRewriteDraft({ ...draft, sending: true });
    const ok = await getRuntimeOrchestrator().sendHistoryRewriteDraft({
      anchorTurnId: draft.anchorTurnId,
      composeInput: draft.composeInput,
      composeAttachments: cloneInlineAttachments(draft.composeAttachments),
      composeFileMentions: cloneInlineMentions(draft.composeFileMentions),
      model: draft.model,
      reasoningEffort: draft.reasoningEffort,
      sandboxMode: draft.sandboxMode,
      composeMode: draft.composeMode === "plan" ? "plan" : "default",
    });
    if (ok) {
      closeInlineRewrite();
      return;
    }
    setInlineRewriteDraft((current) =>
      current?.anchorEventId === draft.anchorEventId ? { ...current, sending: false } : current
    );
  };
  const updatePlanExecModel = (eventId: string, value: string) => {
    setPlanExecStateByEventId((prev) => {
      const state = prev[eventId];
      return state ? { ...prev, [eventId]: { ...state, model: value } } : prev;
    });
  };
  const updatePlanExecReasoningEffort = (eventId: string, value: string) => {
    setPlanExecStateByEventId((prev) => {
      const state = prev[eventId];
      return state ? { ...prev, [eventId]: { ...state, reasoningEffort: value } } : prev;
    });
  };
  const updatePlanExecSandboxMode = (eventId: string, value: SandboxMode) => {
    setPlanExecStateByEventId((prev) => {
      const state = prev[eventId];
      return state ? { ...prev, [eventId]: { ...state, sandboxMode: value } } : prev;
    });
  };
  const executePlanFromPlanDelta = async (event: TimelineEventItem) => {
    const eventId = String(event?.id ?? "").trim();
    if (!eventId || isTurnRunning) return;
    const state = planExecStateByEventId[eventId];
    if (!state || state.executing) return;
    setPlanExecStateByEventId((prev) => ({
      ...prev,
      [eventId]: { ...state, executing: true, collapseWhileExecuting: true },
    }));

    const prevModel = runtimeStore.model;
    const prevEffort = runtimeStore.reasoningEffort;
    const prevSandbox = runtimeStore.sandboxMode;
    const prevComposeInput = runtimeStore.composeInput;
    const prevAttachments = cloneInlineAttachments(runtimeStore.composeAttachments);
    const prevMentions = cloneInlineMentions(runtimeStore.composeFileMentions);
    const prevRewriteActive = runtimeStore.historyRewriteActive;
    const prevRewriteSource = runtimeStore.historyRewriteSource;
    const prevRewriteAnchorEventId = runtimeStore.historyRewriteAnchorEventId;
    const prevRewriteAnchorTurnId = runtimeStore.historyRewriteAnchorTurnId;
    const prevRewriteSavedDraft = runtimeStore.historyRewriteSavedDraft;
    const prevRewriteSavedAttachments = cloneInlineAttachments(runtimeStore.historyRewriteSavedAttachments);
    const prevRewriteSavedMentions = cloneInlineMentions(runtimeStore.historyRewriteSavedMentions);
    let sendAccepted = false;

    try {
      runtimeStore.model = state.model;
      runtimeStore.reasoningEffort = state.reasoningEffort;
      runtimeStore.sandboxMode = state.sandboxMode;
      runtimeStore.setComposeMode("default");
      runtimeStore.composeAttachments = [];
      runtimeStore.composeFileMentions = [];
      runtimeStore.composeInput = "执行计划中";
      sendAccepted = await getRuntimeOrchestrator().send();
    } finally {
      runtimeStore.model = prevModel;
      runtimeStore.reasoningEffort = prevEffort;
      runtimeStore.sandboxMode = prevSandbox;
      runtimeStore.composeInput = prevComposeInput;
      runtimeStore.composeAttachments = cloneInlineAttachments(prevAttachments);
      runtimeStore.composeFileMentions = cloneInlineMentions(prevMentions);
      runtimeStore.saveThreadComposeAttachments(runtimeStore.currentThreadId);
      runtimeStore.saveThreadComposeFileMentions(runtimeStore.currentThreadId);
      runtimeStore.historyRewriteActive = prevRewriteActive;
      runtimeStore.historyRewriteSource = prevRewriteSource;
      runtimeStore.historyRewriteAnchorEventId = prevRewriteAnchorEventId;
      runtimeStore.historyRewriteAnchorTurnId = prevRewriteAnchorTurnId;
      runtimeStore.historyRewriteSavedDraft = prevRewriteSavedDraft;
      runtimeStore.historyRewriteSavedAttachments = cloneInlineAttachments(prevRewriteSavedAttachments);
      runtimeStore.historyRewriteSavedMentions = cloneInlineMentions(prevRewriteSavedMentions);
      setPlanExecStateByEventId((prev) => {
        const current = prev[eventId];
        if (!current) return prev;
        const stillRunning = Boolean(runtimeStore.currentThreadId && threadStore.runningThreadIds.has(runtimeStore.currentThreadId));
        return {
          ...prev,
          [eventId]: {
            ...current,
            executing: sendAccepted && !stillRunning,
            collapseWhileExecuting: sendAccepted || stillRunning ? current.collapseWhileExecuting : false,
          },
        };
      });
    }
  };

  const threadHistoryById = useMemo(
    () => new Map([...threadStore.threadHistory, ...threadStore.localThreads].map((item) => [String(item?.id ?? "").trim(), item] as const).filter(([id]) => !!id)),
    [threadStore.threadHistory, threadStore.localThreads]
  );
  const handoffDiagnosticsBanner = useMemo(() => {
    const threadId = String(runtimeStore.timelineKey ?? "").trim();
    if (!threadId || threadId === "__app__") return null;
    const historyItem = threadHistoryById.get(threadId);
    const parentThreadId = String(historyItem?.forkedFromId ?? "").trim();
    if (!parentThreadId) return null;
    const resolveThreadLabel = (threadIdValue: unknown) => {
      const tid = String(threadIdValue ?? "").trim();
      if (!tid) return "未知线程";
      const history = threadHistoryById.get(tid);
      const nickname = String(history?.agentNickname ?? "").trim();
      const title = String(history?.title ?? "").trim();
      return nickname || title || (tid.length <= 8 ? tid : `…${tid.slice(-8)}`);
    };
    const currentDiagnostics = threadStore.handoffDiagnosticsByThread.get(threadId) ?? null;
    if (threadStore.handoffDiagnosticsLoadingThreadIds.has(threadId) && !currentDiagnostics) {
      return { text: `正在读取 ${resolveThreadLabel(parentThreadId)} 的 handoff transcript 摘要...`, tone: "running" as const };
    }
    const d = currentDiagnostics;
    if (!d) return null;
    const parentLabel = resolveThreadLabel(d.parentThreadId || parentThreadId);
    const details: string[] = [];
    if (d.parent?.totalTurns != null) details.push(`父线程「${parentLabel}」${d.parent.totalTurns} 轮`);
    else details.push(`父线程「${parentLabel}」摘要暂不可用`);
    details.push(`当前 ${d.current.totalTurns} 轮`);
    if (d.postHandoffTurns != null) details.push(d.postHandoffTurns > 0 ? `handoff 后 +${d.postHandoffTurns}` : "当前仍停留在继承 transcript 阶段");
    const latestDurationMs = typeof d.current.lastTurnDurationMs === "number" ? d.current.lastTurnDurationMs : NaN;
    if (Number.isFinite(latestDurationMs) && latestDurationMs > 0) {
      const seconds = Math.max(1, Math.round(latestDurationMs / 1000));
      const duration = latestDurationMs < 1000 ? `${Math.max(1, Math.round(latestDurationMs))}ms` : seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? `${seconds % 60}s` : ""}`;
      details.push(`最近回合 ${duration}`);
    }
    return { text: details.join("｜"), tone: d.postHandoffTurns == null ? ("warn" as const) : d.postHandoffTurns > 0 ? ("ok" as const) : ("warn" as const) };
  }, [runtimeStore.timelineKey, threadHistoryById, threadStore.handoffDiagnosticsByThread, threadStore.handoffDiagnosticsLoadingThreadIds]);

  const isReasoningOpen = (block: ReasoningBlockNode) => {
    const id = String(block?.id ?? "").trim();
    if (!id) return false;
    const flag = reasoningOpenById.get(id);
    return typeof flag === "boolean" ? flag : Boolean(block.openDefault);
  };
  const setReasoningOpen = (block: ReasoningBlockNode, open: boolean) => {
    const id = String(block?.id ?? "").trim();
    if (!id) return;
    setReasoningOpenById((prev) => new Map(prev).set(id, open));
    onLayoutChange?.();
  };
  const keyed = (id: string) => `${runtimeStore.timelineKey}:${id}`;
  const isMcpToolGroupOpen = (id: string) => mcpToolGroupOpenByKey.get(keyed(id)) ?? false;
  const onMcpToolGroupToggle = (id: string, open: boolean) => {
    setMcpToolGroupOpenByKey((prev) => new Map(prev).set(keyed(id), open));
    onLayoutChange?.();
  };
  const isMcpResourceOpen = (id: string) => mcpResourceOpenByKey.get(keyed(id)) ?? false;
  const setMcpResourceOpen = (id: string, open: boolean) => {
    setMcpResourceOpenByKey((prev) => new Map(prev).set(keyed(id), open));
    onLayoutChange?.();
  };
  const isCommandFilesOpen = (nodeId: string) => commandFilesOpenById.get(String(nodeId ?? "")) ?? false;
  const toggleCommandFilesOpen = (nodeId: string) => {
    const id = String(nodeId ?? "").trim();
    if (!id) return;
    setCommandFilesOpenById((prev) => new Map(prev).set(id, !(prev.get(id) ?? false)));
  };
  const isCommandSessionStopping = (processId: string) => stoppingCommandProcessIds.has(String(processId ?? "").trim());
  const stopCommandSession = async (item: CommandSessionNode) => {
    const processId = String(item?.processId ?? "").trim();
    const serverId = String(runtimeStore.serverId ?? "").trim();
    if (!processId || !serverId || isCommandSessionStopping(processId)) return;
    setStoppingCommandProcessIds((prev) => new Set(prev).add(processId));
    try {
      await codexDesktop.codexServer.rpc({ serverId, method: "command/exec/terminate", params: { processId } }).catch(async () => {
        await codexDesktop.codexServer.rpc({ serverId, method: "process/kill", params: { processHandle: processId } });
      });
      showToast({ kind: "success", title: "已请求停止命令", message: processId });
    } catch (error: any) {
      showToast({ kind: "error", title: "停止命令失败", message: String(error?.message ?? error) });
    } finally {
      setStoppingCommandProcessIds((prev) => {
        const next = new Set(prev);
        next.delete(processId);
        return next;
      });
    }
  };
  const openMcpResourceInPanel = (item: Pick<McpResourceReadNode, "server" | "uri" | "sourceTab" | "templateKey">) => {
    const threadId = String(runtimeStore.timelineKey ?? "").trim();
    const serverId = String(item?.server ?? "").trim();
    const uri = String(item?.uri ?? "").trim();
    if (!threadId || !serverId || !uri) return;
    const sourceTab = item?.sourceTab === "templates" ? "templates" : "resources";
    mcpResourceStore.requestOpen(serverId, sourceTab);
    if (sourceTab === "templates" && String(item?.templateKey ?? "").trim()) mcpResourceStore.selectTemplate(serverId, String(item.templateKey).trim());
    else mcpResourceStore.selectResource(serverId, uri);
    mcpResourceStore.hydrateFromCache(threadId, serverId, uri);
    appShellStore.openSettings("integrations", { integrationsTab: "mcp" });
  };
  const onOpenRelatedMcpResource = (item: any) => {
    if (!item?.relatedResourceUri) return;
    openMcpResourceInPanel({ server: item.server, uri: item.relatedResourceUri, sourceTab: item.relatedResourceSourceTab, templateKey: item.relatedResourceTemplateKey });
  };

  const setLocalViewportAdapter = (adapter: TimelineViewportAdapter | null) => {
    localViewportAdapter.current = adapter;
    onViewportAdapterChange?.(adapter);
  };
  const setPinnedUserRowId = (rowId: string) => {
    const nextRowId = String(rowId ?? "").trim();
    setPinnedUserRowIdState((previousRowId) => {
      if (nextRowId && previousRowId && nextRowId !== previousRowId) {
        const previousIndex = rows.findIndex((item) => item.id === previousRowId);
        const nextIndex = rows.findIndex((item) => item.id === nextRowId);
        if (previousIndex >= 0 && nextIndex >= 0) setPinnedPromptTransitionDirection(nextIndex > previousIndex ? "up" : "down");
      }
      return nextRowId;
    });
  };
  const pinnedUserRow = pinnedUserRowId ? rows.find((item) => item.id === pinnedUserRowId && item.kind === "user") : null;
  const pinnedUserMessage = useMemo(() => {
    if (!pinnedUserRow || pinnedUserRow.kind !== "user") return null;
    const parts = userMessageParts(pinnedUserRow.event);
    const textParts = parts.filter((part) => part.type === "text").map((part) => part.text.replace(/\s+/g, " ").trim()).filter(Boolean);
    const fileCount = parts.filter((part) => part.type === "file").length;
    const imageCount = userMessageImageCount(pinnedUserRow.event);
    const titleParts = parts.map((part) => (part.type === "file" ? part.label : part.type === "text" ? part.text.replace(/\s+/g, " ").trim() : "")).filter(Boolean);
    const suffix = [fileCount > 0 ? `+${fileCount} 文件` : "", imageCount > 0 ? `+${imageCount} 图片` : ""].filter(Boolean);
    const summary = textParts.join(" ").trim() || "用户消息";
    return {
      rowId: pinnedUserRow.id,
      text: summary,
      parts,
      title: [titleParts.join(" ").trim() || summary, ...suffix].filter(Boolean).join(" · "),
      fileCount,
      imageCount,
      formattedTime: formatTime(pinnedUserRow.event.createdAt),
    };
  }, [pinnedUserRow]);
  const pinnedPromptLocateOffsetPx = () => {
    const prompt = pinnedPromptLayerRef.current?.querySelector<HTMLElement>(".chat-pinned-prompt") ?? null;
    const promptHeight = Math.ceil(prompt?.getBoundingClientRect().height ?? 0);
    return Math.max(8, promptHeight + PINNED_PROMPT_TOP_GAP_PX + 15);
  };
  const scrollDomRowToTop = (rowId: string, offsetPx = 0) => {
    const element = scrollElement;
    if (!element) return false;
    const row = Array.from(element.querySelectorAll<HTMLElement>(".chat-timeline-row")).find((item) => String(item.dataset.rowId ?? "").trim() === rowId);
    if (!row) return false;
    const delta = row.getBoundingClientRect().top - element.getBoundingClientRect().top - Math.max(0, Math.round(offsetPx));
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTo({ top: Math.max(0, Math.min(maxScrollTop, element.scrollTop + delta)), behavior: "smooth" });
    return true;
  };
  const onPinnedUserClick = () => {
    const rowId = pinnedUserMessage?.rowId ?? "";
    if (!rowId) return;
    const offsetPx = pinnedPromptLocateOffsetPx();
    if (localViewportAdapter.current?.scrollRowToTop(rowId, offsetPx, "smooth")) return;
    scrollDomRowToTop(rowId, offsetPx);
  };

  const resetImageLightboxView = () => {
    setImageLightboxZoom(1);
    setImageLightboxPan({ x: 0, y: 0 });
    setImageLightboxDragging(false);
    dragState.current.pointerId = null;
  };
  const closeImageLightbox = () => {
    setImageLightboxOpen(false);
    setImageLightboxSrc("");
    setImageLightboxTitle("");
    resetImageLightboxView();
  };
  const onPreviewImage = (payload: ImagePreviewPayload) => {
    const src = String(payload?.src ?? "").trim();
    if (!src) return;
    setImageLightboxSrc(src);
    setImageLightboxTitle(String(payload?.title ?? "").trim());
    resetImageLightboxView();
    setImageLightboxOpen(true);
    requestAnimationFrame(() => imageLightboxCloseButtonRef.current?.focus?.());
  };
  const zoomImageLightbox = (nextZoom: number, origin?: { clientX: number; clientY: number }) => {
    setImageLightboxZoom((previousZoom) => {
      const zoom = clampNumber(nextZoom, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(zoom - previousZoom) < 0.001) return previousZoom;
      if (origin) {
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const pointerX = origin.clientX - cx;
        const pointerY = origin.clientY - cy;
        const ratio = zoom / previousZoom;
        setImageLightboxPan((pan) => ({ x: pointerX - (pointerX - pan.x) * ratio, y: pointerY - (pointerY - pan.y) * ratio }));
      }
      return zoom;
    });
  };
  const zoomImageLightboxIn = () => zoomImageLightbox(imageLightboxZoom * ZOOM_STEP);
  const zoomImageLightboxOut = () => zoomImageLightbox(imageLightboxZoom / ZOOM_STEP);
  const onImageLightboxWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!imageLightboxOpen) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomImageLightbox(imageLightboxZoom * factor, { clientX: event.clientX, clientY: event.clientY });
  };
  const onImageLightboxPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageLightboxOpen || event.button !== 0) return;
    event.preventDefault();
    dragState.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, panX: imageLightboxPan.x, panY: imageLightboxPan.y };
    setImageLightboxDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onImageLightboxPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!imageLightboxDragging || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setImageLightboxPan({ x: drag.panX + (event.clientX - drag.startX), y: drag.panY + (event.clientY - drag.startY) });
  };
  const finishImageLightboxDrag = (event?: React.PointerEvent<HTMLDivElement>) => {
    if (event && dragState.current.pointerId !== event.pointerId) return;
    event?.currentTarget.releasePointerCapture?.(event.pointerId);
    dragState.current.pointerId = null;
    setImageLightboxDragging(false);
  };
  const downloadImageLightboxImage = () => {
    const src = String(imageLightboxSrc ?? "").trim();
    if (!src) return;
    const link = document.createElement("a");
    link.href = src;
    link.download = `${sanitizeDownloadName(imageLightboxTitle || "image")}.${extensionFromImageSrc(src)}`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  useEffect(() => {
    if (!imageLightboxOpen) return undefined;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImageLightbox();
      } else if (event.key === "0") {
        event.preventDefault();
        resetImageLightboxView();
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomImageLightboxIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomImageLightboxOut();
      }
    };
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, [imageLightboxOpen, imageLightboxZoom]);

  const contextCompactionPhase = (trailingContextCompactionEvent?.params as any)?.phase;
  const isContextCompactionRunning = contextCompactionPhase === "started";
  const showTrailingThinkingEvent = Boolean(trailingThinkingEvent && !trailingContextCompactionEvent);
  const imageLightboxTransformStyle = {
    transform: `translate3d(${imageLightboxPan.x}px, ${imageLightboxPan.y}px, 0) scale(${imageLightboxZoom})`,
  } as CSSProperties;

  return (
    <div className="chat-pane flex flex-col">
      {handoffDiagnosticsBanner ? (
        <div className={CHAT_ROW_ACTIVITY_CLASS}>
          <div className="chat-activity-line inline-flex w-full max-w-full items-center gap-2.5 px-2.5 py-0.5 text-xs dim">
            {handoffDiagnosticsBanner.tone !== "running" ? (
              <span className={["chat-activity-dot h-1.5 w-1.5 flex-none rounded-full bg-[var(--ui-activity-dot-bg)] shadow-[var(--ui-activity-dot-shadow)]", chatActivityToneClass(handoffDiagnosticsBanner.tone)].filter(Boolean).join(" ")} aria-hidden="true" />
            ) : null}
            <span className="mono whitespace-nowrap">交接记录</span>
            {handoffDiagnosticsBanner.tone === "running" ? <WaveText className="mono dim" text={handoffDiagnosticsBanner.text} /> : <span>{handoffDiagnosticsBanner.text}</span>}
          </div>
        </div>
      ) : null}

      <div ref={pinnedPromptLayerRef} className="chat-pinned-prompt-layer">
        {pinnedUserMessage ? (
          <ChatPinnedUserPromptBox
            contentKey={pinnedUserMessage.rowId}
            text={pinnedUserMessage.text}
            messageParts={pinnedUserMessage.parts}
            title={pinnedUserMessage.title}
            fileCount={pinnedUserMessage.fileCount}
            imageCount={pinnedUserMessage.imageCount}
            transitionDirection={pinnedPromptTransitionDirection}
            showTimestamp={Boolean(viewPrefs.showTimestamps)}
            formattedTime={pinnedUserMessage.formattedTime}
            onLocate={onPinnedUserClick}
            onFileTokenClick={onUserFileTokenClick}
          />
        ) : null}
      </div>

      <ChatTimelineViewport
        rows={rows}
        timelineKey={timelineKey}
        scrollElement={scrollElement}
        onLayoutChange={onLayoutChange}
        onViewportAdapterChange={setLocalViewportAdapter}
        onPinnedUserRowChange={setPinnedUserRowId}
      >
        {({ row }) => (
          <ChatRowRenderer
            renderedRow={row}
            workspaceRoot={workspaceRoot}
            viewPrefs={viewPrefs}
            isTurnRunning={isTurnRunning}
            planExecStateByEventId={planExecStateByEventId}
            modelOptions={modelOptions}
            reasoningEffortOptions={reasoningEffortOptions}
            sandboxModeOptions={sandboxModeOptions}
            sendDisabled={inlineRewriteSendDisabled}
            inlineRewriteDraft={inlineRewriteDraft}
            userMessageParts={userMessageParts}
            userMessageImageCount={userMessageImageCount}
            visibleUserMessageImageEntries={visibleUserMessageImageEntries}
            visibleImageToolEntries={visibleImageToolEntries}
            handleThumbLoadError={onThumbLoadError}
            handleUserFileTokenClick={onUserFileTokenClick}
            handleUserBubbleClick={openInlineRewrite}
            updateInlineRewriteDraft={updateInlineRewriteDraft}
            closeInlineRewrite={closeInlineRewrite}
            sendInlineRewriteDraft={() => void sendInlineRewriteDraft()}
            executePlanFromPlanDelta={(event) => void executePlanFromPlanDelta(event)}
            updatePlanExecModel={updatePlanExecModel}
            updatePlanExecReasoningEffort={updatePlanExecReasoningEffort}
            updatePlanExecSandboxMode={updatePlanExecSandboxMode}
            handlePreviewImage={onPreviewImage}
            handleLayoutChange={onLayoutChange}
            getMarkdownEventHtml={getMarkdownEventHtml}
            isReasoningOpen={isReasoningOpen}
            setReasoningOpen={setReasoningOpen}
            isCommandFilesOpen={isCommandFilesOpen}
            toggleCommandFilesOpen={toggleCommandFilesOpen}
            isCommandSessionStopping={isCommandSessionStopping}
            stopCommandSession={stopCommandSession}
            isMcpToolGroupOpen={isMcpToolGroupOpen}
            onMcpToolGroupToggle={onMcpToolGroupToggle}
            isMcpResourceOpen={isMcpResourceOpen}
            setMcpResourceOpen={setMcpResourceOpen}
            openMcpResourceInPanel={openMcpResourceInPanel}
            onOpenRelatedMcpResource={onOpenRelatedMcpResource}
          />
        )}
      </ChatTimelineViewport>

      {trailingContextCompactionEvent ? (
        <div className={[CHAT_ROW_BASE_CLASS, "chat-row--tail", "chat-row--context-compaction"].join(" ")}>
          <div className="chat-context-compaction-line flex w-full max-w-full items-center justify-center px-2.5 py-0.5 text-center">
            {isContextCompactionRunning ? (
              <WaveText as="div" className="chat-context-compaction-text mono" color="var(--text-muted)" text={trailingContextCompactionEvent.paramsText} />
            ) : (
              <div className="chat-context-compaction-text is-completed mono">{trailingContextCompactionEvent.paramsText}</div>
            )}
          </div>
        </div>
      ) : null}

      {showTrailingThinkingEvent && trailingThinkingEvent ? (
        <div className={[CHAT_ROW_BASE_CLASS, "chat-row--tail", "chat-row--thinking"].join(" ")}>
          <div className="chat-thinking-line flex w-full max-w-full items-center justify-start pr-2.5">
            <WaveText className="mono dim" text={trailingThinkingEvent.paramsText} />
          </div>
        </div>
      ) : null}

      {imageLightboxOpen
        ? createPortal(
            <div className="composer-lightbox-overlay composer-lightbox-overlay--image" role="dialog" aria-modal="true" aria-label={imageLightboxTitle || "图片预览"}>
              <div className="composer-lightbox-backdrop" aria-hidden="true" onClick={closeImageLightbox} />
              <div className="composer-lightbox-stage composer-lightbox-stage--image" onClick={(event) => event.target === event.currentTarget && closeImageLightbox()}>
                <div
                  className={["composer-lightbox-viewport", imageLightboxDragging ? "is-dragging" : ""].filter(Boolean).join(" ")}
                  onWheel={onImageLightboxWheel}
                  onPointerDown={onImageLightboxPointerDown}
                  onPointerMove={onImageLightboxPointerMove}
                  onPointerUp={finishImageLightboxDrag}
                  onPointerCancel={finishImageLightboxDrag}
                  onLostPointerCapture={finishImageLightboxDrag}
                >
                  <img className="composer-lightbox-image composer-lightbox-image--interactive" src={imageLightboxSrc} alt={imageLightboxTitle || "图片预览"} style={imageLightboxTransformStyle} draggable={false} />
                </div>
                <div className="composer-lightbox-toolbar app-scrollbar" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                  <span className="composer-lightbox-zoom mono">{Math.round(imageLightboxZoom * 100)}%</span>
                  <button className="composer-lightbox-action" type="button" onClick={zoomImageLightboxOut} title="缩小">
                    <ZoomOut aria-hidden="true" />
                  </button>
                  <button className="composer-lightbox-action" type="button" onClick={zoomImageLightboxIn} title="放大">
                    <ZoomIn aria-hidden="true" />
                  </button>
                  <button className="composer-lightbox-action" type="button" onClick={resetImageLightboxView} title="重置">
                    <RotateCcw aria-hidden="true" />
                  </button>
                  <button className="composer-lightbox-action" type="button" onClick={downloadImageLightboxImage} title="下载">
                    <Download aria-hidden="true" />
                  </button>
                  <button ref={imageLightboxCloseButtonRef} className="composer-lightbox-action composer-lightbox-action--close" type="button" onClick={closeImageLightbox} title="关闭">
                    <X aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
