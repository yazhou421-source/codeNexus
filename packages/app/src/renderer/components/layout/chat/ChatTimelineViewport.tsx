import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatRenderedRow } from "../types/chat.types";
import { getChatRowPresentation, type ChatTimelineRowGroup } from "./chatPresentation";
import { TIMELINE_FOLLOW_THRESHOLD_PX, type TimelineViewportAdapter } from "./timelineScrollPolicy";

export type ChatTimelineViewportProps = {
  rows?: ChatRenderedRow[];
  timelineKey?: string;
  scrollElement?: HTMLElement | null;
  virtualThreshold?: number;
  onLayoutChange?: () => void;
  onViewportAdapterChange?: (adapter: TimelineViewportAdapter | null) => void;
  onPinnedUserRowChange?: (rowId: string) => void;
  children?: ReactNode | ((args: { row: ChatRenderedRow }) => ReactNode);
};

type RenderedTimelineRow = {
  row: ChatRenderedRow;
  index: number;
  top: number;
  height: number;
  bottom: number;
  presentation: ReturnType<typeof getChatRowPresentation>;
};

type RowGapMetrics = Record<ChatTimelineRowGroup | "mixed", number>;
type PendingHeightRestore = {
  anchor: ReturnType<TimelineViewportAdapter["captureVisibleAnchor"]>;
  wasFollowing: boolean;
  scrollTopAtCapture: number;
};

const DEFAULT_VIRTUAL_THRESHOLD = 250;
const OVERSCAN_VIEWPORT_MULTIPLIER = 1.5;
const MIN_OVERSCAN_ROWS = 8;
const ROW_HEIGHT_EPSILON_PX = 1;
const FALLBACK_CLIENT_HEIGHT_PX = 720;
const DEFAULT_ROW_GAPS = {
  activity: 2,
  body: 5,
  command: 2,
  mixed: 5,
} satisfies RowGapMetrics;

function parseCssPx(value: string, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
}

export default function ChatTimelineViewport({
  rows = [],
  timelineKey = "__app__",
  scrollElement = null,
  virtualThreshold = DEFAULT_VIRTUAL_THRESHOLD,
  onLayoutChange,
  onViewportAdapterChange,
  onPinnedUserRowChange,
  children,
}: ChatTimelineViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pendingLayoutNotifyRafIdRef = useRef<number | null>(null);
  const pendingHeightRestoreRafIdRef = useRef<number | null>(null);
  const pendingHeightRestoreRef = useRef<PendingHeightRestore | null>(null);
  const rowHeightsByKeyRef = useRef(new Map<string, number>());
  const rowElementsByIdRef = useRef(new Map<string, HTMLElement>());
  const rowResizeObserversByIdRef = useRef(new Map<string, ResizeObserver>());

  const [scrollTopPx, setScrollTopPx] = useState(0);
  const [clientHeightPx, setClientHeightPx] = useState(FALLBACK_CLIENT_HEIGHT_PX);
  const [viewportTopPx, setViewportTopPx] = useState(0);
  const [rowGapPx, setRowGapPx] = useState<RowGapMetrics>({ ...DEFAULT_ROW_GAPS });
  const [heightVersion, setHeightVersion] = useState(0);

  const renderedRows = useMemo<RenderedTimelineRow[]>(() => {
    const heightCacheKey = (rowId: string) => `${String(timelineKey || "__app__")}:${rowId}`;
    const measuredOrEstimatedHeight = (rowId: string, estimatedHeightPx: number) => {
      const measured = rowHeightsByKeyRef.current.get(heightCacheKey(rowId));
      if (Number.isFinite(measured) && measured && measured > 0) return measured;
      return Math.max(1, Math.round(estimatedHeightPx || 1));
    };
    const gapForGroup = (group: ChatTimelineRowGroup) => rowGapPx[group];
    const rowGapBefore = (index: number) => {
      if (index <= 0) return 0;
      const previous = rows[index - 1];
      const current = rows[index];
      if (!previous || !current) return 0;
      const previousGroup = getChatRowPresentation(previous).group;
      const currentGroup = getChatRowPresentation(current).group;
      if (previousGroup === currentGroup) return gapForGroup(currentGroup);
      return rowGapPx.mixed;
    };

    let nextTop = 0;
    return rows.map((row, index) => {
      const presentation = getChatRowPresentation(row);
      const height = measuredOrEstimatedHeight(row.id, presentation.estimatedHeightPx);
      const top = nextTop + rowGapBefore(index);
      const bottom = top + height;
      nextTop = bottom;
      return { row, index, top, height, bottom, presentation };
    });
  }, [heightVersion, rowGapPx, rows, timelineKey]);

  const totalHeightPx = useMemo(() => Math.max(0, renderedRows[renderedRows.length - 1]?.bottom ?? 0), [renderedRows]);
  const virtualEnabled = rows.length > Math.max(0, Math.round(virtualThreshold)) && Boolean(scrollElement);

  const virtualRange = useMemo(() => {
    if (!virtualEnabled || renderedRows.length === 0) return { start: 0, end: renderedRows.length };
    const viewportHeight = Math.max(1, clientHeightPx || FALLBACK_CLIENT_HEIGHT_PX);
    const overscanPx = viewportHeight * OVERSCAN_VIEWPORT_MULTIPLIER;
    const localScrollTop = Math.max(0, scrollTopPx - viewportTopPx);
    const minTop = Math.max(0, localScrollTop - overscanPx);
    const maxBottom = localScrollTop + viewportHeight + overscanPx;

    let start = firstRowIndexAtOrAfter(minTop);
    let end = firstRowIndexAfter(maxBottom);
    start = Math.max(0, Math.min(start, renderedRows.length));
    end = Math.max(start, Math.min(end, renderedRows.length));
    start = Math.max(0, start - MIN_OVERSCAN_ROWS);
    end = Math.min(renderedRows.length, end + MIN_OVERSCAN_ROWS);
    return { start, end };
  }, [clientHeightPx, renderedRows, scrollTopPx, viewportTopPx, virtualEnabled]);

  const virtualRows = useMemo(() => renderedRows.slice(virtualRange.start, virtualRange.end), [renderedRows, virtualRange]);
  const rowStructureSignature = useMemo(
    () =>
      [
        `gaps:${rowGapPx.body}:${rowGapPx.command}:${rowGapPx.activity}:${rowGapPx.mixed}`,
        ...renderedRows.map(
          (item) =>
            `${String(item.row.id ?? "")}:${String(item.row.kind ?? "")}:${item.presentation.group}:${item.presentation.estimatedHeightPx}`,
        ),
      ].join("\n"),
    [renderedRows, rowGapPx],
  );
  const rowsIdSignature = useMemo(() => rows.map((row) => row.id).join("\n"), [rows]);

  function heightCacheKey(rowId: string) {
    return `${String(timelineKey || "__app__")}:${rowId}`;
  }

  function firstRowIndexAtOrAfter(offsetPx: number): number {
    let low = 0;
    let high = renderedRows.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((renderedRows[mid]?.bottom ?? 0) < offsetPx) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function firstRowIndexAfter(offsetPx: number): number {
    let low = 0;
    let high = renderedRows.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((renderedRows[mid]?.top ?? 0) <= offsetPx) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  function clampScrollTop(value: number): number {
    const maxScrollTop = Math.max(0, (scrollElement?.scrollHeight ?? totalHeightPx) - (scrollElement?.clientHeight ?? clientHeightPx));
    return Math.max(0, Math.min(maxScrollTop, Math.round(value)));
  }

  function distanceToBottom(element: HTMLElement): number {
    return Math.max(0, Math.round(element.scrollHeight - element.clientHeight - element.scrollTop));
  }

  function isFollowingBottom(element: HTMLElement): boolean {
    return distanceToBottom(element) <= TIMELINE_FOLLOW_THRESHOLD_PX;
  }

  function viewportContentTop(): number {
    const element = scrollElement;
    const viewport = viewportRef.current;
    if (!element || !viewport) return 0;
    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    return Math.max(0, Math.round(viewportRect.top - elementRect.top + element.scrollTop));
  }

  function syncTimelineGapMetrics() {
    const viewport = viewportRef.current;
    if (!viewport) return false;
    const styles = getComputedStyle(viewport);
    const next = {
      activity: parseCssPx(styles.getPropertyValue("--chat-row-gap-activity"), DEFAULT_ROW_GAPS.activity),
      body: parseCssPx(styles.getPropertyValue("--chat-row-gap-body"), DEFAULT_ROW_GAPS.body),
      command: parseCssPx(styles.getPropertyValue("--chat-row-gap-command"), DEFAULT_ROW_GAPS.command),
      mixed: parseCssPx(styles.getPropertyValue("--chat-row-gap-mixed"), DEFAULT_ROW_GAPS.mixed),
    } satisfies RowGapMetrics;
    let changed = false;
    setRowGapPx((previous) => {
      changed =
        previous.activity !== next.activity ||
        previous.body !== next.body ||
        previous.command !== next.command ||
        previous.mixed !== next.mixed;
      return changed ? next : previous;
    });
    return changed;
  }

  function updateScrollMetrics() {
    setScrollTopPx(Math.max(0, Math.round(scrollElement?.scrollTop ?? 0)));
    setClientHeightPx(Math.max(1, Math.round(scrollElement?.clientHeight ?? FALLBACK_CLIENT_HEIGHT_PX)));
    setViewportTopPx(viewportContentTop());
  }

  function scheduleLayoutChangeNotify() {
    if (!onLayoutChange || pendingLayoutNotifyRafIdRef.current != null) return;
    pendingLayoutNotifyRafIdRef.current = requestAnimationFrame(() => {
      pendingLayoutNotifyRafIdRef.current = null;
      updateScrollMetrics();
      onLayoutChange();
    });
  }

  function captureVisibleAnchor() {
    const element = scrollElement;
    if (!element || renderedRows.length === 0) return null;
    const scrollTop = Math.max(0, Math.round(element.scrollTop));
    const viewportTop = viewportContentTop();
    const localScrollTop = Math.max(0, scrollTop - viewportTop);
    const index = firstRowIndexAtOrAfter(localScrollTop);
    const item = renderedRows[Math.min(index, renderedRows.length - 1)];
    if (!item) return null;
    return {
      rowId: item.row.id,
      topOffsetPx: viewportTop + item.top - scrollTop,
    };
  }

  function restoreVisibleAnchor(anchor: { rowId: string; topOffsetPx: number }) {
    const element = scrollElement;
    if (!element) return false;
    const item = renderedRows.find((row) => row.row.id === anchor.rowId);
    if (!item) return false;
    element.scrollTop = clampScrollTop(viewportContentTop() + item.top - anchor.topOffsetPx);
    updateScrollMetrics();
    return true;
  }

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    if (!scrollElement) return;
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior });
    updateScrollMetrics();
  }

  function scrollRowToTop(rowId: string, offsetPx = 0, behavior: ScrollBehavior = "auto") {
    const element = scrollElement;
    const id = String(rowId ?? "").trim();
    if (!element || !id) return false;
    const item = renderedRows.find((row) => row.row.id === id);
    if (!item) return false;
    const targetTop = clampScrollTop(viewportContentTop() + item.top - Math.max(0, Math.round(offsetPx)));
    element.scrollTo({ top: targetTop, behavior });
    updateScrollMetrics();
    return true;
  }

  function scrollLastRowByKindToTop(kind: string, offsetPx = 0, behavior: ScrollBehavior = "auto") {
    const normalizedKind = String(kind ?? "").trim();
    if (!normalizedKind) return false;
    for (let index = renderedRows.length - 1; index >= 0; index -= 1) {
      const item = renderedRows[index];
      if (item?.row.kind !== normalizedKind) continue;
      return scrollRowToTop(item.row.id, offsetPx, behavior);
    }
    return false;
  }

  function getScrollMetrics() {
    return {
      scrollTop: Math.max(0, Math.round(scrollElement?.scrollTop ?? 0)),
      scrollHeight: Math.max(0, Math.round(scrollElement?.scrollHeight ?? totalHeightPx ?? 0)),
      clientHeight: Math.max(1, Math.round(scrollElement?.clientHeight ?? clientHeightPx)),
    };
  }

  function scheduleHeightChangeRestore() {
    if (!virtualEnabled || !scrollElement) return;
    if (!pendingHeightRestoreRef.current) {
      pendingHeightRestoreRef.current = {
        anchor: captureVisibleAnchor(),
        wasFollowing: isFollowingBottom(scrollElement),
        scrollTopAtCapture: Math.max(0, Math.round(scrollElement.scrollTop)),
      };
    }
    if (pendingHeightRestoreRafIdRef.current != null) return;
    pendingHeightRestoreRafIdRef.current = requestAnimationFrame(() => {
      pendingHeightRestoreRafIdRef.current = null;
      const restore = pendingHeightRestoreRef.current;
      pendingHeightRestoreRef.current = null;
      const element = scrollElement;
      if (!restore || !element) {
        updateScrollMetrics();
        return;
      }
      const scrollTop = Math.max(0, Math.round(element.scrollTop));
      if (Math.abs(scrollTop - restore.scrollTopAtCapture) > ROW_HEIGHT_EPSILON_PX) {
        updateScrollMetrics();
        return;
      }
      if (restore.wasFollowing) scrollToBottom("auto");
      else if (restore.anchor) restoreVisibleAnchor(restore.anchor);
      else updateScrollMetrics();
    });
  }

  function updateMeasuredHeight(rowId: string, element: HTMLElement) {
    const nextHeight = Math.max(1, Math.round(element.getBoundingClientRect().height));
    const key = heightCacheKey(rowId);
    const previousHeight = rowHeightsByKeyRef.current.get(key) ?? 0;
    if (Math.abs(previousHeight - nextHeight) <= ROW_HEIGHT_EPSILON_PX) return;
    scheduleHeightChangeRestore();
    rowHeightsByKeyRef.current.set(key, nextHeight);
    setHeightVersion((value) => value + 1);
    scheduleLayoutChangeNotify();
  }

  function bindVirtualRowElement(rowId: string, element: HTMLElement | null) {
    const existing = rowElementsByIdRef.current.get(rowId);
    if (existing === element) return;
    rowResizeObserversByIdRef.current.get(rowId)?.disconnect();
    rowResizeObserversByIdRef.current.delete(rowId);
    rowElementsByIdRef.current.delete(rowId);
    if (!element) return;
    rowElementsByIdRef.current.set(rowId, element);
    updateMeasuredHeight(rowId, element);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateMeasuredHeight(rowId, element));
    observer.observe(element);
    rowResizeObserversByIdRef.current.set(rowId, observer);
  }

  function disconnectVirtualRowObservers() {
    for (const observer of rowResizeObserversByIdRef.current.values()) observer.disconnect();
    rowResizeObserversByIdRef.current.clear();
    rowElementsByIdRef.current.clear();
  }

  function pruneHeightCache() {
    const allowed = new Set(rows.map((row) => heightCacheKey(row.id)));
    let changed = false;
    for (const key of rowHeightsByKeyRef.current.keys()) {
      if (allowed.has(key)) continue;
      rowHeightsByKeyRef.current.delete(key);
      changed = true;
    }
    if (changed) setHeightVersion((value) => value + 1);
  }

  function findPinnedUserRowId(): string {
    const element = scrollElement;
    if (!element || renderedRows.length === 0) return "";
    if (!virtualEnabled) {
      const viewport = viewportRef.current;
      if (!viewport) return "";
      const top = element.getBoundingClientRect().top;
      let pinned = "";
      for (const row of Array.from(viewport.querySelectorAll<HTMLElement>(".chat-timeline-row"))) {
        const kind = String(row.dataset.rowKind ?? "").trim();
        if (kind !== "user") continue;
        const rowRect = row.getBoundingClientRect();
        if (rowRect.top > top) break;
        if (rowRect.bottom <= top) pinned = String(row.dataset.rowId ?? "").trim();
      }
      return pinned;
    }
    const localScrollTop = Math.max(0, scrollTopPx - viewportTopPx);
    let pinned = "";
    for (const item of renderedRows) {
      if (item.top > localScrollTop) break;
      if (item.row.kind === "user" && item.bottom <= localScrollTop) pinned = item.row.id;
    }
    return pinned;
  }

  const viewportAdapter = useMemo<TimelineViewportAdapter>(
    () => ({
      captureVisibleAnchor,
      restoreVisibleAnchor,
      scrollToBottom,
      scrollRowToTop,
      scrollLastRowByKindToTop,
      getScrollMetrics,
      notifyLayoutChange: scheduleLayoutChangeNotify,
    }),
    [clientHeightPx, renderedRows, scrollElement, scrollTopPx, totalHeightPx, viewportTopPx],
  );

  useEffect(() => {
    onViewportAdapterChange?.(virtualEnabled ? viewportAdapter : null);
    return () => onViewportAdapterChange?.(null);
  }, [onViewportAdapterChange, viewportAdapter, virtualEnabled]);

  useEffect(() => {
    const element = scrollElement;
    if (!element) {
      updateScrollMetrics();
      return undefined;
    }

    const onScroll = () => updateScrollMetrics();
    element.addEventListener("scroll", onScroll, { passive: true });
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        const gapChanged = syncTimelineGapMetrics();
        updateScrollMetrics();
        if (gapChanged) scheduleLayoutChangeNotify();
      });
      resizeObserver.observe(element);
    }
    syncTimelineGapMetrics();
    updateScrollMetrics();
    return () => {
      element.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
    };
  }, [scrollElement]);

  useEffect(() => {
    onPinnedUserRowChange?.(findPinnedUserRowId());
  }, [onPinnedUserRowChange, renderedRows, scrollTopPx, viewportTopPx, virtualEnabled]);

  useEffect(() => {
    scheduleLayoutChangeNotify();
  }, [rowStructureSignature]);

  useEffect(() => {
    rowHeightsByKeyRef.current = new Map();
    disconnectVirtualRowObservers();
    updateScrollMetrics();
    scheduleLayoutChangeNotify();
    setHeightVersion((value) => value + 1);
  }, [timelineKey]);

  useEffect(() => {
    pruneHeightCache();
    requestAnimationFrame(() => {
      updateScrollMetrics();
      scheduleLayoutChangeNotify();
    });
  }, [rowsIdSignature]);

  useEffect(() => {
    if (!virtualEnabled) disconnectVirtualRowObservers();
    requestAnimationFrame(() => {
      syncTimelineGapMetrics();
      updateScrollMetrics();
      scheduleLayoutChangeNotify();
    });
  }, [virtualEnabled]);

  useEffect(() => {
    syncTimelineGapMetrics();
    updateScrollMetrics();
    scheduleLayoutChangeNotify();
    return () => {
      onPinnedUserRowChange?.("");
      onViewportAdapterChange?.(null);
      if (pendingHeightRestoreRafIdRef.current != null) cancelAnimationFrame(pendingHeightRestoreRafIdRef.current);
      pendingHeightRestoreRafIdRef.current = null;
      pendingHeightRestoreRef.current = null;
      disconnectVirtualRowObservers();
      if (pendingLayoutNotifyRafIdRef.current != null) cancelAnimationFrame(pendingLayoutNotifyRafIdRef.current);
      pendingLayoutNotifyRafIdRef.current = null;
    };
  }, []);

  const viewportStyle: CSSProperties | undefined = virtualEnabled ? { height: `${totalHeightPx}px` } : undefined;
  const renderRow = (item: RenderedTimelineRow, virtual: boolean) => (
    <div
      key={item.row.id}
      className={["chat-timeline-row", item.presentation.className].filter(Boolean).join(" ")}
      data-row-id={item.row.id}
      data-row-kind={item.row.kind}
      data-row-group={item.presentation.group}
      data-row-role={item.presentation.role}
      data-row-density={item.presentation.density}
      data-row-status={item.presentation.status}
      data-row-expandable={item.presentation.expandable ? "true" : "false"}
      data-row-estimated-height={item.presentation.estimatedHeightPx}
      data-row-index={item.index}
      style={virtual ? { transform: `translate3d(0, ${item.top}px, 0)` } : undefined}
      ref={virtual ? (element) => bindVirtualRowElement(item.row.id, element) : undefined}
    >
      {typeof children === "function" ? children({ row: item.row }) : children}
    </div>
  );

  return (
    <div
      ref={viewportRef}
      className={["chat-timeline-viewport", virtualEnabled ? "chat-timeline-viewport--virtual" : ""].filter(Boolean).join(" ")}
      data-virtualized={virtualEnabled ? "true" : "false"}
      style={viewportStyle}
    >
      {(virtualEnabled ? virtualRows : renderedRows).map((item) => renderRow(item, virtualEnabled))}
    </div>
  );
}
