import { ChevronDown, Folder, RefreshCw, SquarePen } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { codexDesktop } from "../../../api/codexDesktopClient";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import type { LocalThreadItem, ThreadHistoryItem } from "../../../domain/types";
import { normalizeThreadTitleOverride } from "../../../features/history/threadTitle";
import { isPendingThreadId } from "../../../shared/threadCreateDebug";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import { useUserInputStore } from "../../../stores/userInput.store";
import { showToast } from "../../../ui/toast";
import Collapsible from "../../ui/Collapsible";
import ThreadRow from "./ThreadRow";

type ThreadHistoryPaneProps = {
  className?: string;
};

type ThreadListItem = Pick<
  ThreadHistoryItem,
  | "id"
  | "title"
  | "meta"
  | "updatedAt"
  | "cwd"
  | "forkedFromId"
  | "agentNickname"
  | "agentRole"
  | "agentPath"
  | "gitInfoSummary"
> & {
  localStatus?: LocalThreadItem["status"];
};

export type ThreadRowModel = {
  item: ThreadListItem;
  depth: number;
};

type ThreadGroup = {
  key: string;
  title: string;
  cwdFull: string;
  updatedAt: number;
  rows: ThreadRowModel[];
};

function normalizeFsPath(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let s = raw.replace(/\//g, "\\");
  while (s.endsWith("\\") && s.length > 3) s = s.slice(0, -1);
  return s.toLowerCase();
}

function normalizeThreadId(value: unknown): string {
  return String(value ?? "").trim();
}

function toBasename(pathValue: string): string {
  const normalized = String(pathValue ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "");
  if (!normalized) return "";
  const parts = normalized.split("\\").filter(Boolean);
  return parts.length > 0 ? String(parts[parts.length - 1] ?? "").trim() : normalized;
}

const workspaceTitleCollator =
  typeof Intl !== "undefined" && typeof Intl.Collator === "function"
    ? new Intl.Collator(["zh-Hans-u-co-pinyin", "zh-CN-u-co-pinyin", "zh-CN", "en"], {
        usage: "sort",
        sensitivity: "base",
        numeric: true,
        ignorePunctuation: true,
      })
    : null;

function compareWorkspaceTitle(a: string, b: string) {
  if (workspaceTitleCollator) return workspaceTitleCollator.compare(String(a ?? "").trim(), String(b ?? "").trim());
  return String(a ?? "")
    .trim()
    .localeCompare(String(b ?? "").trim(), "zh-CN", { sensitivity: "base", numeric: true });
}

function sortByUpdatedAtDesc(a: ThreadListItem, b: ThreadListItem) {
  return a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.title.localeCompare(b.title);
}

function extractInvalidWorkspacePathFromError(errorText: string): string {
  const text = String(errorText ?? "");
  for (const re of [
    /Workspace directory does not exist:\s*([^\r\n.]+)(?:\.|$)/i,
    /Workspace path is not a directory:\s*([^\r\n.]+)(?:\.|$)/i,
    /Workspace directory is not accessible:\s*([^\r\n(]+)(?:\(|\.|$)/i,
  ]) {
    const candidate = String(text.match(re)?.[1] ?? "").trim();
    if (candidate) return candidate;
  }
  return "";
}

function threadRowDepthStyle(depth: number) {
  return { "--lsb-thread-depth": String(Math.max(0, Math.round(depth))) } as CSSProperties;
}

export default function ThreadHistoryPane({ className }: ThreadHistoryPaneProps) {
  const { t } = useTranslation();
  const runtime = getRuntimeOrchestrator();
  const appShellStore = useAppShellStore();
  const runtimeStore = useRuntimeStore();
  const threadStore = useThreadStore();
  const userInputStore = useUserInputStore();
  const [isRefreshingHistory, setIsRefreshingHistory] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const visibleThreadItems = useMemo<ThreadListItem[]>(() => {
    const map = new Map<string, ThreadListItem>();
    for (const item of threadStore.threadHistory) {
      const id = normalizeThreadId(item.id);
      if (id) map.set(id, item);
    }
    for (const item of threadStore.localThreads) {
      const id = normalizeThreadId(item.id);
      if (!id || map.has(id)) continue;
      map.set(id, {
        id,
        title: String(item.title ?? ""),
        meta: String(item.meta ?? ""),
        updatedAt: Number(item.updatedAt ?? item.createdAt ?? Date.now()),
        cwd: item.cwd,
        forkedFromId: item.forkedFromId,
        agentNickname: item.agentNickname,
        agentRole: item.agentRole,
        agentPath: item.agentPath,
        gitInfoSummary: item.gitInfoSummary,
        localStatus: item.status,
      });
    }
    return [...map.values()].sort(sortByUpdatedAtDesc);
  }, [threadStore.threadHistory, threadStore.localThreads]);

  const threadHistoryById = useMemo(() => {
    const map = new Map<string, ThreadListItem>();
    for (const item of visibleThreadItems) {
      const id = normalizeThreadId(item.id);
      if (id) map.set(id, item);
    }
    return map;
  }, [visibleThreadItems]);

  const threadGroups = useMemo<ThreadGroup[]>(() => {
    const groups = new Map<
      string,
      { key: string; title: string; cwdFull: string; updatedAt: number; items: ThreadListItem[] }
    >();
    for (const sourceItem of visibleThreadItems) {
      const item: ThreadListItem = {
        id: String(sourceItem.id ?? ""),
        title: threadStore.displayThreadTitle(sourceItem.id, sourceItem.title),
        meta: String(sourceItem.meta ?? ""),
        updatedAt: Number(sourceItem.updatedAt ?? 0),
        cwd: sourceItem.cwd,
        forkedFromId: sourceItem.forkedFromId,
        agentNickname: sourceItem.agentNickname,
        agentRole: sourceItem.agentRole,
        agentPath: sourceItem.agentPath,
        gitInfoSummary: sourceItem.gitInfoSummary,
        localStatus: sourceItem.localStatus,
      };
      const cwd = String(item.cwd ?? "").trim();
      const key = cwd ? normalizeFsPath(cwd) : "__no_workspace__";
      const title = cwd ? toBasename(cwd) : t("threadHistory.noWorkspace");
      const existing = groups.get(key);
      if (existing) {
        existing.updatedAt = Math.max(existing.updatedAt, item.updatedAt);
        existing.items.push(item);
      } else {
        groups.set(key, { key, title, cwdFull: cwd, updatedAt: item.updatedAt, items: [item] });
      }
    }

    const out: ThreadGroup[] = [];
    for (const group of groups.values()) {
      const items = [...group.items].sort(sortByUpdatedAtDesc);
      out.push({
        key: group.key,
        title: group.title,
        cwdFull: group.cwdFull,
        updatedAt: group.updatedAt,
        rows: items.map((item) => ({ item, depth: 0 })),
      });
    }
    out.sort((a, b) => {
      if (a.key === "__no_workspace__" && b.key !== "__no_workspace__") return 1;
      if (b.key === "__no_workspace__" && a.key !== "__no_workspace__") return -1;
      const byTitle = compareWorkspaceTitle(a.title, b.title);
      return byTitle !== 0 ? byTitle : compareWorkspaceTitle(a.cwdFull || a.key, b.cwdFull || b.key);
    });
    return out;
  }, [t, threadStore, visibleThreadItems]);

  const visibleThreadGroupKeys = useMemo(() => new Set(threadGroups.map((group) => group.key).filter(Boolean)), [threadGroups]);
  const currentThreadGroupKey = useMemo(() => {
    const currentId = normalizeThreadId(runtimeStore.currentThreadId);
    if (!currentId) return "";
    const currentThread = threadHistoryById.get(currentId);
    if (currentThread) {
      const cwd = String(currentThread.cwd ?? "").trim();
      return cwd ? normalizeFsPath(cwd) : "__no_workspace__";
    }
    const fallbackWorkspace = String(threadStore.currentWorkspace ?? runtimeStore.workspacePath ?? "").trim();
    return fallbackWorkspace ? normalizeFsPath(fallbackWorkspace) : "__no_workspace__";
  }, [runtimeStore.currentThreadId, runtimeStore.workspacePath, threadHistoryById, threadStore.currentWorkspace]);
  const currentThreadGroupCollapsed = currentThreadGroupKey
    ? appShellStore.isThreadWorkspaceGroupCollapsed(currentThreadGroupKey)
    : false;

  useEffect(() => {
    if (!currentThreadGroupKey || !visibleThreadGroupKeys.has(currentThreadGroupKey)) return;
    if (!currentThreadGroupCollapsed) return;
    useAppShellStore.getState().setThreadWorkspaceGroupCollapsed(currentThreadGroupKey, false);
  }, [currentThreadGroupCollapsed, currentThreadGroupKey, visibleThreadGroupKeys]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const totalThreadListCount = visibleThreadItems.length;
  const runningThreadsCount = threadStore.runningThreadIds.size;
  const threadsCountText = t("threadHistory.totalCount", { count: totalThreadListCount });
  const invalidWorkspacePath =
    appShellStore.serverConnState === "failed" ? extractInvalidWorkspacePathFromError(appShellStore.serverError) : "";
  const isInvalidWorkspaceItem = (item: { cwd?: string }) => {
    const bad = normalizeFsPath(invalidWorkspacePath);
    const cwd = normalizeFsPath(String(item?.cwd ?? ""));
    return Boolean(bad && cwd && cwd === bad);
  };
  const shouldShowUserInputBadge = (threadIdValue: string) =>
    userInputStore.queueSizeForThread(String(threadIdValue ?? "").trim()) > 0;
  const shouldShowThreadAttention = (threadId: string) => {
    const tid = String(threadId ?? "").trim();
    return Boolean(tid && tid !== runtimeStore.currentThreadId && threadStore.attentionThreadIds.has(tid));
  };
  const threadAriaLabel = (row: ThreadRowModel) => {
    const title = threadStore.displayThreadTitle(row.item.id, row.item.title);
    const git = String(row.item.gitInfoSummary ?? "").trim();
    return git ? `${t("threadHistory.openThreadAria", { title })} · ${git}` : t("threadHistory.openThreadAria", { title });
  };
  const formatRelativeTime = (updatedAt: number) => {
    const ts = Number(updatedAt);
    if (!Number.isFinite(ts) || ts <= 0) return "";
    const deltaSec = Math.floor(Math.max(0, nowMs - ts) / 1000);
    if (deltaSec < 90) return "Now";
    const deltaMin = Math.floor(deltaSec / 60);
    if (deltaMin < 60) return `${deltaMin}m`;
    const deltaH = Math.floor(deltaMin / 60);
    if (deltaH < 24) return `${deltaH}h`;
    return `${Math.floor(deltaH / 24)}d`;
  };

  const onRefreshHistoryClick = async () => {
    if (isRefreshingHistory) return;
    setIsRefreshingHistory(true);
    try {
      await runtime.refreshHistory(true);
    } finally {
      setIsRefreshingHistory(false);
    }
  };

  const onThreadItemClick = (threadId: string) => {
    const tid = String(threadId ?? "").trim();
    if (!tid) return;
    threadStore.clearThreadAttention(tid);
    if (tid === runtimeStore.currentThreadId) return;
    void runtime.switchThread(tid);
  };

  const onRenameThread = async (threadIdValue: string, titleValue: string) => {
    const threadId = normalizeThreadId(threadIdValue);
    if (!threadId) return;
    const normalized = normalizeThreadTitleOverride(titleValue);
    const previous = threadStore.threadTitleOverridesByThreadId.get(threadId) ?? "";
    if (normalized) threadStore.setThreadTitleOverride(threadId, normalized);
    else threadStore.clearThreadTitleOverride(threadId);

    try {
      if (normalized) await codexDesktop.history.setThreadTitleOverride({ threadId, title: normalized });
      else await codexDesktop.history.clearThreadTitleOverride({ threadId });
    } catch (error) {
      if (previous) threadStore.setThreadTitleOverride(threadId, previous);
      else threadStore.clearThreadTitleOverride(threadId);
      showToast({
        kind: "error",
        title: t("threadHistory.renameFailed"),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className={["lsb-pane-content", className].filter(Boolean).join(" ")}>
      <div className="lsb-pane-head">
        <div className="lsb-pane-head-row">
          <div className="lsb-pane-title">{t("threadHistory.title")}</div>
          <div className="lsb-head-badges">
            <span className="lsb-head-badge is-accent mono">{threadsCountText}</span>
            {runningThreadsCount > 0 ? (
              <span className="lsb-head-badge is-success mono">{t("threadHistory.runningCount", { count: runningThreadsCount })}</span>
            ) : null}
          </div>
        </div>

        <div className="lsb-pane-toolbar lsb-thread-toolbar">
          <button id="btn-add-thread" className="lsb-nav-row lsb-thread-create-btn" type="button" onClick={() => void runtime.createThread()}>
            <SquarePen className="lsb-nav-icon" aria-hidden="true" />
            <span className="lsb-nav-text">{t("threadHistory.newThread")}</span>
          </button>
          <button
            id="btn-refresh-history"
            className="lsb-icon-btn lsb-thread-refresh-btn"
            type="button"
            aria-label={t("common.refresh")}
            disabled={isRefreshingHistory}
            onClick={() => void onRefreshHistoryClick()}
          >
            <span className={["inline-flex", isRefreshingHistory ? "spin" : ""].filter(Boolean).join(" ")}>
              <RefreshCw aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>

      <div id="thread-history" className="lsb-scroll app-scrollbar">
        <div className={["lsb-thread-groups", totalThreadListCount === 0 ? "dim" : ""].filter(Boolean).join(" ")}>
          {totalThreadListCount === 0 ? (
            <div className="lsb-empty lsb-thread-empty mono">
              <div className="dim">{t("threadHistory.empty")}</div>
              <button className="lsb-nav-row lsb-nav-row--workspace" type="button" onClick={() => void runtime.createThread()}>
                <span className="lsb-nav-text">{t("threadHistory.newThread")}</span>
              </button>
            </div>
          ) : (
            threadGroups.map((group) => {
              const open = !appShellStore.isThreadWorkspaceGroupCollapsed(group.key);
              return (
                <section key={group.key} className="lsb-section">
                  <Collapsible
                    className="lsb-section-collapsible"
                    open={open}
                    onOpenChange={(next) => appShellStore.setThreadWorkspaceGroupCollapsed(group.key, !next)}
                    trigger={({ open: isOpen, triggerProps }) => (
                      <div role="heading" aria-level={3}>
                        <button className="lsb-group-head lsb-group-head-toggle" type="button" {...triggerProps}>
                          <span className="lsb-group-head-left">
                            <Folder className="lsb-group-icon" aria-hidden="true" />
                            <span className="lsb-group-title">{group.title}</span>
                          </span>
                          <ChevronDown className={["lsb-chevron", isOpen ? "open" : ""].filter(Boolean).join(" ")} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  >
                    <div className="lsb-group-body">
                      {group.rows.map((row) => (
                        <ThreadRow
                          key={`row:${row.item.id}`}
                          row={row}
                          activeThreadId={runtimeStore.currentThreadId}
                          isInvalidWorkspaceItem={isInvalidWorkspaceItem}
                          isPendingThreadId={isPendingThreadId}
                          shouldShowUserInputBadge={shouldShowUserInputBadge}
                          shouldShowThreadAttention={shouldShowThreadAttention}
                          runningThreadIds={threadStore.runningThreadIds}
                          recentlyCompletedThreadIds={threadStore.recentlyCompletedThreadIds}
                          threadAriaLabel={threadAriaLabel}
                          threadRowDepthStyle={threadRowDepthStyle}
                          formatRelativeTime={formatRelativeTime}
                          onOpenThread={onThreadItemClick}
                          onClearThreadAttention={(threadId) => threadStore.clearThreadAttention(threadId)}
                          onRenameThread={onRenameThread}
                          onDeleteThread={(threadId) => void runtime.deleteHistoryThread(threadId)}
                        />
                      ))}
                    </div>
                  </Collapsible>
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
