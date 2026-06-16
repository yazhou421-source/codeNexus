import { buildModelPickerOptions } from "@codenexus/shared/modelCatalog";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { hasMeaningfulComposeText, stripComposeFileTokenChars } from "../../domain/composeFileMentions";
import { CENTER_TIMELINE_SOFT_MIN_WIDTH_PX } from "../../domain/layoutWidthBudget";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import type { CollaborationModeKind, ComposeImageAttachment, TimelineEventItem } from "../../domain/types";
import { isLocalThinkingEvent } from "../../features/timeline/eventKinds";
import { isPendingThreadId } from "../../shared/threadCreateDebug";
import { useAppShellStore } from "../../stores/appShell.store";
import { useConfigStore } from "../../stores/config.store";
import { useMessageQueueStore } from "../../stores/messageQueue.store";
import { useModelCatalogStore } from "../../stores/modelCatalog.store";
import { useRuntimeStore, type SandboxMode } from "../../stores/runtime.store";
import { useSkillsUiStore } from "../../stores/skillsUi.store";
import { useThreadStore } from "../../stores/thread.store";
import { useTimelineStore } from "../../stores/timeline.store";
import { showToast } from "../../ui/toast";
import CenterPaneEmptyState from "./CenterPaneEmptyState";
import ChatPane from "./chat/ChatPane";
import type { TimelineViewportAdapter } from "./chat/timelineScrollPolicy";
import {
  classifyViewportFollowState,
  snapshotTimelineViewport,
  timelineDistanceToBottom,
} from "./chat/timelineScrollPolicy";
import ComposerPanel from "./composer/ComposerPanel";
import ComposerQueueList from "./composer/ComposerQueueList";
import ComposerSlashCommandList, { type SlashCommandListItem } from "./composer/ComposerSlashCommandList";
import SkillsManagerOverlay from "./skills/SkillsManagerOverlay";

type LocalImageFile = File & { path?: string };
type PopoverDirection = "up" | "down";
type PopoverPlacement = { top: number; left: number; width: number; maxHeight: number; dir: PopoverDirection };

const COMPOSER_DOCK_FALLBACK_HEIGHT_PX = 84;
const COMPOSER_DOCK_BOTTOM_INSET_PX = 14;
const COMPOSER_DOCK_GAP_PX = 8;
const TIMELINE_EDGE_FADE_PX = 15;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function popoverStyleFromPlacement(placement: PopoverPlacement | null): CSSProperties {
  if (!placement) return { visibility: "hidden" };
  return {
    top: `${Math.round(placement.top)}px`,
    left: `${Math.round(placement.left)}px`,
    width: `${Math.round(placement.width)}px`,
    maxHeight: `${Math.round(placement.maxHeight)}px`,
  };
}

function resolvePopoverPlacement(anchorEl: HTMLElement, popoverEl: HTMLElement | null): PopoverPlacement {
  const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
  const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0);
  const margin = 12;
  const gap = 4;
  const anchorRect = anchorEl.getBoundingClientRect();
  const maxWidthByViewport = Math.max(220, viewportWidth - margin * 2);
  const width = Math.min(Math.max(300, Math.round(anchorRect.width)), maxWidthByViewport);
  const left = clampNumber(anchorRect.left, margin, Math.max(margin, viewportWidth - margin - width));
  const rawSpaceAbove = Math.max(0, anchorRect.top - margin - gap);
  const rawSpaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - margin - gap);
  const measuredHeight = Math.max(0, Math.round(popoverEl?.getBoundingClientRect().height ?? 0));
  const desiredHeight = clampNumber(measuredHeight || 220, 52, 360);
  const dir: PopoverDirection = rawSpaceAbove >= desiredHeight || rawSpaceAbove > rawSpaceBelow ? "up" : "down";
  const maxHeight = Math.max(52, Math.min(360, dir === "up" ? rawSpaceAbove : rawSpaceBelow));
  const renderedHeight = Math.min(measuredHeight || desiredHeight, maxHeight);
  const topRaw = dir === "down" ? anchorRect.bottom + gap : anchorRect.top - gap - renderedHeight;
  const top = clampNumber(topRaw, margin, Math.max(margin, viewportHeight - margin - renderedHeight));
  return { top, left, width, maxHeight, dir };
}

function parseImageMimeTypeFromDataUrl(value: string): string {
  const match = String(value ?? "")
    .trim()
    .match(/^data:(image\/[^;]+);base64,/i);
  return String(match?.[1] ?? "image/png").toLowerCase();
}

function imageExtensionFromMimeType(mimeTypeValue: string): string {
  const mimeType = String(mimeTypeValue ?? "")
    .trim()
    .toLowerCase();
  if (!mimeType) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  const extension = mimeType.split("/")[1] ?? "png";
  const normalized = extension.replace(/[^a-z0-9.+-]/gi, "");
  return normalized || "png";
}

function fileNameFromPathLike(value: string, fallback: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return fallback;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || fallback;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function buildComposeAttachmentFromFile(file: File, imageIndex: number): Promise<ComposeImageAttachment | null> {
  const imageFile = file as LocalImageFile;
  const filePath = String(imageFile.path ?? "").trim();
  if (filePath) {
    return {
      id: `compose-local-image:${Date.now()}:${imageIndex}:${Math.random().toString(16).slice(2)}`,
      name: fileNameFromPathLike(filePath, file.name || `image-${imageIndex + 1}.png`),
      size: Number(file.size ?? 0),
      mimeType: String(file.type ?? "image/*") || "image/*",
      previewUrl: URL.createObjectURL(file),
      revokePreviewUrlOnDispose: true,
      input: { type: "localImage", path: filePath },
    };
  }

  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl) return null;
  const mimeType = String(file.type ?? "").trim() || parseImageMimeTypeFromDataUrl(dataUrl);
  const extension = imageExtensionFromMimeType(mimeType);
  return {
    id: `compose-image:${Date.now()}:${imageIndex}:${Math.random().toString(16).slice(2)}`,
    name: String(file.name ?? "").trim() || `image-${imageIndex + 1}.${extension}`,
    size: Number(file.size ?? 0),
    mimeType,
    previewUrl: dataUrl,
    revokePreviewUrlOnDispose: false,
    input: { type: "image", url: dataUrl },
  };
}

function firstEnabledSlashIndex(commands: SlashCommandListItem[]): number {
  return commands.findIndex((command) => !command.disabled);
}

function normalizeActiveSlashIndex(commands: SlashCommandListItem[], activeIndex: number): number {
  if (commands.length === 0) return -1;
  if (activeIndex >= 0 && activeIndex < commands.length && !commands[activeIndex]?.disabled) return activeIndex;
  const enabled = firstEnabledSlashIndex(commands);
  return enabled >= 0 ? enabled : 0;
}

function findNextEnabledSlashIndex(
  commands: SlashCommandListItem[],
  startIndex: number,
  direction: 1 | -1
): number {
  if (commands.length === 0) return -1;
  const baseIndex = startIndex >= 0 ? startIndex : direction > 0 ? -1 : 0;
  let cursor = baseIndex;
  for (let i = 0; i < commands.length; i += 1) {
    cursor = direction > 0 ? (cursor + 1 + commands.length) % commands.length : (cursor - 1 + commands.length) % commands.length;
    if (!commands[cursor]?.disabled) return cursor;
  }
  return -1;
}

export default function CenterPane() {
  const runtimeStore = useRuntimeStore();
  const threadStore = useThreadStore();
  const timelineStore = useTimelineStore();
  const messageQueueStore = useMessageQueueStore();
  const modelCatalogStore = useModelCatalogStore();
  const skillsUiStore = useSkillsUiStore();
  const appShellStore = useAppShellStore();
  const configStore = useConfigStore();
  const runtime = getRuntimeOrchestrator();

  const centerContentRef = useRef<HTMLElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const composerPanelRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLDivElement | null>(null);
  const composerImageInputRef = useRef<HTMLInputElement | null>(null);
  const slashPopoverRef = useRef<HTMLDivElement | null>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement | null>(null);
  const loadingOlderRef = useRef(false);

  const [timelineViewportAdapter, setTimelineViewportAdapter] = useState<TimelineViewportAdapter | null>(null);
  const [centerContentWidthPx, setCenterContentWidthPx] = useState(0);
  const [composerDockHeightPx, setComposerDockHeightPx] = useState(0);
  const [hasTopEdgeFade, setHasTopEdgeFade] = useState(false);
  const [hasBottomEdgeFade, setHasBottomEdgeFade] = useState(false);
  const [isFollowingBottom, setIsFollowingBottom] = useState(true);
  const [activeSlashIndex, setActiveSlashIndex] = useState(-1);
  const [slashPopoverPlacement, setSlashPopoverPlacement] = useState<PopoverPlacement | null>(null);
  const [composeLightboxAttachmentId, setComposeLightboxAttachmentId] = useState("");

  const timelineKey = String(runtimeStore.timelineKey ?? "__app__");
  const currentThreadId = String(runtimeStore.currentThreadId ?? "").trim();
  const workspaceRoot = String(runtimeStore.workspacePath ?? "").trim();
  const timelineContentRevision = timelineStore.threadContentRevisionForThread(timelineKey);
  const timelineRevision = timelineStore.threadStructureRevisionForThread(timelineKey);
  const contentTimelineEvents = useMemo(
    () => timelineStore.eventsForThread(timelineKey),
    [timelineStore, timelineKey, timelineContentRevision, timelineRevision]
  );
  const queueItems = messageQueueStore.queueByThread.get(timelineKey) ?? [];
  const currentTokenUsage = threadStore.currentTokenUsage;
  const isTurnRunning = Boolean(currentThreadId && threadStore.runningThreadIds.has(currentThreadId));
  const isTimelineLoading = Boolean(currentThreadId && threadStore.loadingThreadId === currentThreadId);
  const isTimelineCompact = centerContentWidthPx > 0 && centerContentWidthPx < CENTER_TIMELINE_SOFT_MIN_WIDTH_PX;
  const emptyStateMode = isPendingThreadId(currentThreadId) ? "pendingThread" : "default";
  const emptyStateHistoryItems = threadStore.threadHistory.slice(0, 8);
  const shouldShowCenterEmptyState =
    !workspaceRoot ||
    isTimelineLoading ||
    emptyStateMode === "pendingThread" ||
    (contentTimelineEvents.length === 0 && !currentThreadId && emptyStateHistoryItems.length > 0);
  const shouldShowComposerPanel = !skillsUiStore.managerOpen;
  const shouldShowQueueTray = shouldShowComposerPanel && queueItems.length > 0;

  const composerDockSpacePx = Math.max(
    96,
    Math.round((composerDockHeightPx > 0 ? composerDockHeightPx : COMPOSER_DOCK_FALLBACK_HEIGHT_PX) + COMPOSER_DOCK_BOTTOM_INSET_PX + COMPOSER_DOCK_GAP_PX)
  );
  const timelineViewportStyle = {
    "--timeline-edge-fade-top": hasTopEdgeFade ? `${TIMELINE_EDGE_FADE_PX}px` : "0px",
    "--timeline-edge-fade-bottom": hasBottomEdgeFade ? `${TIMELINE_EDGE_FADE_PX}px` : "0px",
    "--composer-dock-space": `${composerDockSpacePx}px`,
    "--composer-dock-bottom-inset": `${COMPOSER_DOCK_BOTTOM_INSET_PX}px`,
  } as CSSProperties;
  const timelinePaneClass = [
    "center-pane timeline-pane",
    skillsUiStore.managerOpen ? "timeline-pane--skills-page" : "timeline-pane--chat",
    runtimeStore.timelineDebugEnabled && !skillsUiStore.managerOpen ? "is-debug-open" : "",
    isTimelineCompact && !skillsUiStore.managerOpen ? "is-compact" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const modelOptions = useMemo(
    () => buildModelPickerOptions({ customIds: modelCatalogStore.customIds, current: runtimeStore.model }),
    [modelCatalogStore.customIds, runtimeStore.model]
  );
  const reasoningEffortOptions = useMemo(
    () => [
      { value: "low", label: "低" },
      { value: "medium", label: "中" },
      { value: "high", label: "高" },
      { value: "xhigh", label: "极高" },
    ],
    []
  );
  const sandboxModeOptions = useMemo(
    () => [
      { value: "read-only", label: "只读" },
      { value: "workspace-write", label: "可写" },
      { value: "danger-full-access", label: "完全" },
    ],
    []
  );
  const sandboxRiskText =
    runtimeStore.sandboxMode === "danger-full-access"
      ? "完全权限：请确认命令来源可信。"
      : runtimeStore.sandboxMode === "read-only"
        ? "只读权限：无法修改工作区文件。"
        : "工作区可写：可修改当前工作区文件。";
  const serviceTierLabel =
    appShellStore.serverConnState === "connected" && configStore.loadState === "ready"
      ? configStore.snapshot.fastModeEnabled
        ? "快速"
        : "标准"
      : "";
  const contextUsagePercent = (() => {
    const usedTokens = Number(currentTokenUsage.usedTokens ?? 0);
    const contextWindow = Number(currentTokenUsage.contextWindow ?? 0);
    if (!Number.isFinite(usedTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
    return Math.max(0, Math.min(100, (usedTokens / contextWindow) * 100));
  })();
  const contextUsageLevel =
    contextUsagePercent >= 95 ? "critical" : contextUsagePercent >= 85 ? "high" : contextUsagePercent >= 70 ? "warn" : "normal";
  const contextUsageTokensText = (() => {
    const usedTokens = currentTokenUsage.usedTokens;
    const contextWindow = currentTokenUsage.contextWindow;
    if (usedTokens == null || contextWindow == null || contextWindow <= 0) return "--/--";
    const fmt = new Intl.NumberFormat();
    return `${fmt.format(Math.max(0, Math.round(usedTokens)))}/${fmt.format(Math.max(0, Math.round(contextWindow)))}`;
  })();
  const contextUsageTooltip =
    currentTokenUsage.usedTokens == null || currentTokenUsage.contextWindow == null || currentTokenUsage.contextWindow <= 0
      ? "上下文窗口信息暂不可用"
      : `上下文使用 ${currentTokenUsage.usedTokens}/${currentTokenUsage.contextWindow} 个 token`;
  const composerStatusText = (() => {
    if (!isPendingThreadId(currentThreadId)) return "";
    const pending = runtimeStore.pendingThreadInitSendCountByThread.get(currentThreadId) ?? 0;
    if (!Number.isFinite(pending) || pending <= 0) return "";
    return pending === 1 ? "正在初始化线程，初始化完成后将自动发送。" : `正在初始化线程，初始化完成后将自动发送（已排队 ${pending} 条）。`;
  })();
  const sendDisabled =
    !hasMeaningfulComposeText(runtimeStore.composeInput) &&
    runtimeStore.composeAttachments.length === 0 &&
    runtimeStore.composeFileMentions.length === 0;
  const sendTitle = isPendingThreadId(currentThreadId)
    ? "发送消息（初始化完成后自动发送）"
    : isTurnRunning
      ? "发送消息（运行中将加入队列）"
      : "发送消息";

  const trailingContextCompactionEvent = useMemo<TimelineEventItem | null>(() => {
    for (let i = contentTimelineEvents.length - 1; i >= 0; i -= 1) {
      const event = contentTimelineEvents[i];
      if (event.method === "local/contextCompaction") return event;
      if (event.hidden) continue;
      break;
    }
    return null;
  }, [contentTimelineEvents]);
  const trailingThinkingEvent = useMemo<TimelineEventItem | null>(() => {
    if (trailingContextCompactionEvent) return null;
    const activeTurnId = String(threadStore.activeTurnIdByThread.get(currentThreadId) ?? "").trim();
    for (let i = contentTimelineEvents.length - 1; i >= 0; i -= 1) {
      const event = contentTimelineEvents[i];
      if (!isLocalThinkingEvent(event)) continue;
      if (activeTurnId && String(event.turnId ?? "").trim() !== activeTurnId) continue;
      return event;
    }
    return null;
  }, [contentTimelineEvents, currentThreadId, threadStore.activeTurnIdByThread, trailingContextCompactionEvent]);

  const compactCommandDisabledHint = !currentThreadId
    ? "需先进入线程"
    : isTurnRunning
      ? "线程运行中不可压缩"
      : "";
  const threadContentCommandDisabledHint = !currentThreadId ? "需先进入线程" : "";
  const goalCommandDisabledHint = !currentThreadId ? "需先进入线程" : "";
  const slashQuery = (() => {
    const text = stripComposeFileTokenChars(String(runtimeStore.composeInput ?? ""));
    const trimmedStart = text.trimStart();
    if (!trimmedStart.startsWith("/")) return "";
    const firstLine = trimmedStart.split(/\r?\n/, 1)[0] ?? "";
    return String(firstLine.match(/^\/([^\s]*)/)?.[1] ?? "")
      .trim()
      .toLowerCase();
  })();
  const slashCommands = useMemo<SlashCommandListItem[]>(
    () => [
      {
        id: "compact",
        code: "compact",
        title: "压缩当前线程",
        hint: "调用线程压缩",
        disabled: Boolean(compactCommandDisabledHint),
        disabledHint: compactCommandDisabledHint || undefined,
      },
      { id: "skills", code: "skills", title: "打开技能管理器", hint: "查看并管理 workspace skills" },
      {
        id: "goal-set",
        code: "goal-set",
        title: "设置线程目标",
        hint: "创建或更新当前线程 goal",
        disabled: Boolean(goalCommandDisabledHint),
        disabledHint: goalCommandDisabledHint || undefined,
      },
      {
        id: "goal-complete",
        code: "goal-complete",
        title: "完成线程目标",
        hint: "将当前线程 goal 标记为完成",
        disabled: Boolean(goalCommandDisabledHint),
        disabledHint: goalCommandDisabledHint || undefined,
      },
      {
        id: "goal-clear",
        code: "goal-clear",
        title: "清除线程目标",
        hint: "删除当前线程 goal",
        disabled: Boolean(goalCommandDisabledHint),
        disabledHint: goalCommandDisabledHint || undefined,
      },
      {
        id: "goal-get",
        code: "goal-get",
        title: "读取线程目标",
        hint: "从 app-server 刷新当前 goal",
        disabled: Boolean(goalCommandDisabledHint),
        disabledHint: goalCommandDisabledHint || undefined,
      },
      {
        id: "thread-content",
        code: "thread-content",
        title: "读取线程内容",
        hint: "调试：读取当前线程消息与事件窗口",
        disabled: Boolean(threadContentCommandDisabledHint),
        disabledHint: threadContentCommandDisabledHint || undefined,
      },
    ],
    [compactCommandDisabledHint, goalCommandDisabledHint, threadContentCommandDisabledHint]
  );
  const filteredSlashCommands = useMemo(() => {
    if (!slashQuery) return slashCommands;
    return slashCommands.filter((command) => {
      const code = command.code.toLowerCase();
      const title = command.title.toLowerCase();
      const hint = String(command.hint ?? "").toLowerCase();
      return code.includes(slashQuery) || title.includes(slashQuery) || hint.includes(slashQuery);
    });
  }, [slashCommands, slashQuery]);
  const slashPopoverVisible = shouldShowComposerPanel && stripComposeFileTokenChars(String(runtimeStore.composeInput ?? "")).trimStart().startsWith("/");
  const slashPopoverDirection = slashPopoverPlacement?.dir ?? "up";
  const slashPopoverStyle = popoverStyleFromPlacement(slashPopoverPlacement);
  const composeLightboxAttachment =
    runtimeStore.composeAttachments.find((item) => item.id === composeLightboxAttachmentId) ?? null;

  const updateTimelineViewportState = useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const snapshot = snapshotTimelineViewport(el);
    setHasTopEdgeFade(snapshot.scrollTop > 2);
    setHasBottomEdgeFade(timelineDistanceToBottom(snapshot) > 2);
    setIsFollowingBottom(classifyViewportFollowState(snapshot) === "following");
  }, []);

  const scrollTimelineToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const adapter = timelineViewportAdapter;
    const el = timelineRef.current;
    if (adapter) {
      adapter.scrollToBottom(behavior);
    } else if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
    requestAnimationFrame(updateTimelineViewportState);
  }, [timelineViewportAdapter, updateTimelineViewportState]);

  const measureComposerDockHeight = useCallback(() => {
    const el = composerPanelRef.current;
    setComposerDockHeightPx(el ? Math.max(0, Math.round(el.getBoundingClientRect().height)) : 0);
  }, []);

  const refreshSlashPopoverPlacement = useCallback(() => {
    if (!slashPopoverVisible) return;
    const anchor = composerPanelRef.current;
    if (!anchor) return;
    setSlashPopoverPlacement(resolvePopoverPlacement(anchor, slashPopoverRef.current));
  }, [slashPopoverVisible]);

  useEffect(() => {
    const measure = () => {
      setCenterContentWidthPx(Math.max(0, Math.round(centerContentRef.current?.getBoundingClientRect().width ?? window.innerWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (centerContentRef.current) observer.observe(centerContentRef.current);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    measureComposerDockHeight();
    const el = composerPanelRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => {
      measureComposerDockHeight();
      refreshSlashPopoverPlacement();
      requestAnimationFrame(updateTimelineViewportState);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureComposerDockHeight, refreshSlashPopoverPlacement, updateTimelineViewportState, shouldShowComposerPanel]);

  useEffect(() => {
    setActiveSlashIndex((value) => normalizeActiveSlashIndex(filteredSlashCommands, value));
    if (!slashPopoverVisible) {
      setSlashPopoverPlacement(null);
      return;
    }
    const raf = requestAnimationFrame(refreshSlashPopoverPlacement);
    return () => cancelAnimationFrame(raf);
  }, [filteredSlashCommands, refreshSlashPopoverPlacement, slashPopoverVisible]);

  useEffect(() => {
    if (!isFollowingBottom) {
      updateTimelineViewportState();
      return;
    }
    scrollTimelineToBottom("auto");
  }, [timelineContentRevision, timelineRevision, queueItems.length, scrollTimelineToBottom, isFollowingBottom, updateTimelineViewportState]);

  useEffect(() => {
    scrollTimelineToBottom("auto");
  }, [runtimeStore.timelineScrollToBottomSeq, scrollTimelineToBottom]);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return undefined;
    updateTimelineViewportState();
    const onScroll = () => {
      updateTimelineViewportState();
      if (!currentThreadId || loadingOlderRef.current || el.scrollTop > 80) return;
      const before = snapshotTimelineViewport(el);
      const anchor = timelineViewportAdapter?.captureVisibleAnchor() ?? null;
      loadingOlderRef.current = true;
      void runtime.loadOlderHistoryTurns(currentThreadId).then((loaded) => {
        requestAnimationFrame(() => {
          if (loaded && anchor && timelineViewportAdapter?.restoreVisibleAnchor(anchor)) {
            updateTimelineViewportState();
          } else if (loaded) {
            const after = snapshotTimelineViewport(el);
            el.scrollTop = Math.max(0, before.scrollTop + Math.max(0, after.scrollHeight - before.scrollHeight));
            updateTimelineViewportState();
          }
          loadingOlderRef.current = false;
        });
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [currentThreadId, runtime, timelineViewportAdapter, updateTimelineViewportState]);

  useEffect(() => {
    const onWindowKeydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (!(event.ctrlKey || event.metaKey) || !event.altKey) return;
      if (event.code !== "KeyJ") return;
      event.preventDefault();
      event.stopPropagation();
      runtimeStore.toggleTimelineDebugEnabled();
    };
    window.addEventListener("keydown", onWindowKeydown);
    window.addEventListener("scroll", refreshSlashPopoverPlacement, true);
    window.addEventListener("resize", refreshSlashPopoverPlacement);
    return () => {
      window.removeEventListener("keydown", onWindowKeydown);
      window.removeEventListener("scroll", refreshSlashPopoverPlacement, true);
      window.removeEventListener("resize", refreshSlashPopoverPlacement);
    };
  }, [refreshSlashPopoverPlacement, runtimeStore]);

  const closeComposeLightbox = useCallback(() => {
    setComposeLightboxAttachmentId("");
    requestAnimationFrame(() => composerInputRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!composeLightboxAttachment) return undefined;
    lightboxCloseRef.current?.focus();
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeComposeLightbox();
    };
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, [closeComposeLightbox, composeLightboxAttachment]);

  const updateComposeInput = (value: string) => {
    useRuntimeStore.setState({ composeInput: value });
    runtimeStore.saveThreadComposeState(runtimeStore.currentThreadId, { save: true });
  };

  const updateComposeFileMentions = (value: typeof runtimeStore.composeFileMentions) => {
    useRuntimeStore.setState({ composeFileMentions: value });
    runtimeStore.saveThreadComposeState(runtimeStore.currentThreadId, { save: true });
  };

  const addComposeImageFiles = async (files: Iterable<File>) => {
    const fileList = Array.from(files ?? []).filter((file) => {
      const mimeType = String(file.type ?? "").toLowerCase();
      const name = String(file.name ?? "").toLowerCase();
      return mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name);
    });
    if (fileList.length === 0) return;
    const attachments: ComposeImageAttachment[] = [];
    let imageIndex = runtimeStore.composeAttachments.length;
    for (const file of fileList) {
      try {
        const attachment = await buildComposeAttachmentFromFile(file, imageIndex);
        if (attachment) attachments.push(attachment);
      } catch {}
      imageIndex += 1;
    }
    if (attachments.length === 0) return;
    runtimeStore.addComposeAttachments(attachments);
    requestAnimationFrame(() => {
      measureComposerDockHeight();
      updateTimelineViewportState();
      refreshSlashPopoverPlacement();
    });
  };

  const runSlashCommand = async (commandId: string) => {
    const command = filteredSlashCommands.find((item) => item.id === commandId);
    if (!command || command.disabled) return;
    if (command.id === "compact") {
      await runtime.compactThread();
    } else if (command.id === "skills") {
      skillsUiStore.openManager();
    } else if (command.id === "goal-set") {
      await runtime.promptAndSetCurrentThreadGoal();
    } else if (command.id === "goal-complete") {
      await runtime.completeCurrentThreadGoal();
    } else if (command.id === "goal-clear") {
      await runtime.clearCurrentThreadGoal();
    } else if (command.id === "goal-get") {
      const goal = await runtime.refreshThreadGoal();
      showToast({
        kind: "info",
        title: goal ? "当前目标" : "没有目标",
        message: goal?.objective ?? "当前线程未设置目标。",
      });
    } else if (command.id === "thread-content") {
      const threadId = currentThreadId;
      const result = await runtime.readThreadContent({
        threadId,
        messageLimit: 80,
        eventLimit: 120,
        includeAux: true,
      });
      if (!result.found) {
        showToast({ kind: "warn", title: "线程未找到", message: threadId || "当前没有可读取线程。" });
        return;
      }
      const messageCount = result.messages.length;
      const eventCount = result.eventsPage.entries.length;
      const totalEvents = result.eventsPage.total;
      const hasMore = result.eventsPage.hasMore;
      showToast({
        kind: "info",
        title: "线程内容已读取",
        message: `消息 ${messageCount} 条；事件 ${eventCount}/${totalEvents}${hasMore ? "（可继续分页）" : ""}`,
      });
    }
    updateComposeInput("");
    setActiveSlashIndex(-1);
    setSlashPopoverPlacement(null);
    requestAnimationFrame(() => document.getElementById("input")?.focus());
  };

  const onComposerKeydown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab" && event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const nextMode: CollaborationModeKind = runtimeStore.composeMode === "plan" ? "default" : "plan";
      runtimeStore.setComposeMode(nextMode);
      requestAnimationFrame(() => document.getElementById("input")?.focus());
      return;
    }

    if (slashPopoverVisible) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = findNextEnabledSlashIndex(filteredSlashCommands, activeSlashIndex, 1);
        if (nextIndex >= 0) setActiveSlashIndex(nextIndex);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex = findNextEnabledSlashIndex(filteredSlashCommands, activeSlashIndex, -1);
        if (prevIndex >= 0) setActiveSlashIndex(prevIndex);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && filteredSlashCommands.some((command) => !command.disabled)) {
        event.preventDefault();
        void runSlashCommand(filteredSlashCommands[normalizeActiveSlashIndex(filteredSlashCommands, activeSlashIndex)]?.id ?? "");
        return;
      }
    }

    if (event.key !== "Enter") return;
    if (event.nativeEvent.isComposing) return;
    if (event.shiftKey) return;
    event.preventDefault();
    void onSendClick();
  };

  const onComposerPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === "file" && String(item.type ?? "").startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;
    event.preventDefault();
    void addComposeImageFiles(files);
  };

  const onSendClick = async () => {
    if (sendDisabled) return;
    await runtime.send();
    scrollTimelineToBottom("auto");
  };

  return (
    <section id="center-content" ref={centerContentRef} className="content content-center">
      <div className="center-workbench">
        <div id="timeline-pane" className={timelinePaneClass} style={timelineViewportStyle}>
          {skillsUiStore.managerOpen ? (
            <SkillsManagerOverlay />
          ) : (
            <>
              <div id="timeline" ref={timelineRef} className="timeline app-scrollbar" style={timelineViewportStyle}>
                {shouldShowCenterEmptyState ? (
                  !workspaceRoot ? (
                    <CenterPaneEmptyState />
                  ) : (
                    <div className="timeline-empty-state-shell">
                      <CenterPaneEmptyState
                        loading={isTimelineLoading}
                        historyItems={emptyStateHistoryItems}
                        mode={emptyStateMode}
                        onSwitchThread={(threadId) => void runtime.switchThread(threadId)}
                      />
                    </div>
                  )
                ) : (
                  <ChatPane
                    contentEvents={contentTimelineEvents}
                    contentRevision={timelineContentRevision}
                    workspaceRoot={workspaceRoot}
                    trailingThinkingEvent={trailingThinkingEvent}
                    trailingContextCompactionEvent={trailingContextCompactionEvent}
                    timelineKey={timelineKey}
                    scrollElement={timelineRef.current}
                    onLayoutChange={() => {
                      measureComposerDockHeight();
                      requestAnimationFrame(updateTimelineViewportState);
                    }}
                    onViewportAdapterChange={setTimelineViewportAdapter}
                    modelOptions={modelOptions}
                    reasoningEffortOptions={reasoningEffortOptions}
                    sandboxModeOptions={sandboxModeOptions}
                    sendDisabled={sendDisabled}
                  />
                )}
              </div>

              {shouldShowQueueTray ? (
                <ComposerQueueList
                  items={queueItems}
                  onEdit={(messageId) => {
                    void runtime.editQueuedMessage(messageId).then(() => document.getElementById("input")?.focus());
                  }}
                  onSendNow={(messageId) => {
                    void runtime.sendQueuedMessageNow(messageId).then(() => scrollTimelineToBottom("auto"));
                  }}
                  onRemove={(messageId) => void runtime.removeQueuedMessage(messageId)}
                />
              ) : null}

              {shouldShowComposerPanel ? (
                <>
                  <input
                    ref={composerImageInputRef}
                    className="composer-image-input-native"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                      void addComposeImageFiles(files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <ComposerPanel
                    composerPanelRef={composerPanelRef}
                    composeInput={runtimeStore.composeInput}
                    composeFileMentions={runtimeStore.composeFileMentions}
                    composeAttachments={runtimeStore.composeAttachments}
                    historyRewriteActive={runtimeStore.historyRewriteActive}
                    historyRewriteSource={runtimeStore.historyRewriteSource}
                    statusText={composerStatusText}
                    composeMode={runtimeStore.composeMode}
                    model={runtimeStore.model}
                    reasoningEffort={runtimeStore.reasoningEffort}
                    sandboxMode={runtimeStore.sandboxMode}
                    modelOptions={modelOptions}
                    reasoningEffortOptions={reasoningEffortOptions}
                    sandboxModeOptions={sandboxModeOptions}
                    sandboxRiskText={sandboxRiskText}
                    serviceTierLabel={serviceTierLabel}
                    contextUsageTooltip={contextUsageTooltip}
                    contextUsagePercent={contextUsagePercent}
                    contextUsageLevel={contextUsageLevel}
                    contextUsageTokensText={contextUsageTokensText}
                    isTurnRunning={isTurnRunning}
                    sendDisabled={sendDisabled}
                    sendTitle={sendTitle}
                    interruptDisabled={!isTurnRunning}
                    interruptTitle="停止当前任务"
                    composerInputRef={composerInputRef}
                    onUpdateComposeInput={updateComposeInput}
                    onUpdateComposeFileMentions={updateComposeFileMentions}
                    onUpdateModel={(value) => {
                      useRuntimeStore.setState({ model: value });
                      runtimeStore.saveThreadComposeState(runtimeStore.currentThreadId, { save: true });
                    }}
                    onUpdateReasoningEffort={(value) => {
                      useRuntimeStore.setState({ reasoningEffort: value });
                      runtimeStore.saveThreadComposeState(runtimeStore.currentThreadId, { save: true });
                    }}
                    onUpdateSandboxMode={(value: SandboxMode) => {
                      runtimeStore.setSandboxMode(value);
                      runtimeStore.saveThreadComposeState(runtimeStore.currentThreadId, { save: true });
                    }}
                    onSetComposeMode={(mode) => {
                      runtimeStore.setComposeMode(mode);
                      runtimeStore.saveThreadComposeState(runtimeStore.currentThreadId, { save: true });
                    }}
                    onComposerKeydown={onComposerKeydown}
                    onPaste={onComposerPaste}
                    onPickImages={() => composerImageInputRef.current?.click()}
                    onPreviewAttachment={(attachmentId) => setComposeLightboxAttachmentId(attachmentId)}
                    onRemoveAttachment={(attachmentId) => {
                      runtimeStore.removeComposeAttachment(attachmentId);
                      if (composeLightboxAttachmentId === attachmentId) setComposeLightboxAttachmentId("");
                    }}
                    onCancelRewrite={() => {
                      runtimeStore.cancelHistoryRewrite({ restoreDraft: true });
                      requestAnimationFrame(() => document.getElementById("input")?.focus());
                    }}
                    onSend={() => void onSendClick()}
                    onInterruptTurn={() => void runtime.interruptTurn()}
                  />
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {slashPopoverVisible
        ? createPortal(
            <div
              ref={slashPopoverRef}
              className="composer-slash-popover app-scrollbar"
              style={slashPopoverStyle}
              data-dir={slashPopoverDirection}
            >
              <ComposerSlashCommandList
                commands={filteredSlashCommands}
                activeIndex={activeSlashIndex}
                onHover={(index) => {
                  if (!filteredSlashCommands[index]?.disabled) setActiveSlashIndex(index);
                }}
                onSelect={(commandId) => void runSlashCommand(commandId)}
              />
            </div>,
            document.body
          )
        : null}

      {composeLightboxAttachment
        ? createPortal(
            <div
              className="composer-lightbox-overlay"
              role="dialog"
              aria-modal="true"
              aria-label="图片预览"
              onClick={(event) => {
                if (event.target === event.currentTarget) closeComposeLightbox();
              }}
            >
              <div className="composer-lightbox-backdrop" onClick={closeComposeLightbox} />
              <div className="composer-lightbox-stage">
                <img
                  className="composer-lightbox-image"
                  src={composeLightboxAttachment.previewUrl}
                  alt={composeLightboxAttachment.name}
                />
                <button
                  ref={lightboxCloseRef}
                  className="composer-lightbox-close"
                  type="button"
                  onClick={closeComposeLightbox}
                >
                  关闭
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </section>
  );
}
