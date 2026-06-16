import { BellRing, CheckCircle2, MessageCircleQuestionMark, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useThreadStore } from "../../../stores/thread.store";
import LoadingDots from "../../ui/LoadingDots";
import type { ThreadRowModel } from "./ThreadHistoryPane";

type ThreadVisualStatus = "question" | "running" | "attention" | "completed" | "idle";

type ThreadRowProps = {
  row: ThreadRowModel;
  activeThreadId: string;
  isInvalidWorkspaceItem: (item: { cwd?: string }) => boolean;
  isPendingThreadId: (threadId: string) => boolean;
  shouldShowUserInputBadge: (threadId: string) => boolean;
  shouldShowThreadAttention: (threadId: string) => boolean;
  runningThreadIds: Set<string>;
  recentlyCompletedThreadIds: Set<string>;
  threadAriaLabel: (row: ThreadRowModel) => string;
  threadRowDepthStyle: (depth: number) => CSSProperties;
  formatRelativeTime: (updatedAt: number) => string;
  onOpenThread?: (threadId: string) => void;
  onClearThreadAttention?: (threadId: string) => void;
  onRenameThread?: (threadId: string, title: string) => void;
  onDeleteThread?: (threadId: string) => void;
  className?: string;
};

function truncateAgentNickname(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.length > 12 ? `${raw.slice(0, 12)}…` : raw;
}

export default function ThreadRow({
  row,
  activeThreadId,
  isInvalidWorkspaceItem,
  isPendingThreadId,
  shouldShowUserInputBadge,
  shouldShowThreadAttention,
  runningThreadIds,
  recentlyCompletedThreadIds,
  threadAriaLabel,
  threadRowDepthStyle,
  formatRelativeTime,
  onOpenThread,
  onClearThreadAttention,
  onRenameThread,
  onDeleteThread,
  className,
}: ThreadRowProps) {
  const { t } = useTranslation();
  const threadStore = useThreadStore();
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const threadId = String(row.item.id ?? "").trim();
  const displayTitle = threadStore.displayThreadTitle(row.item.id, row.item.title);
  const titleTooltip = String(row.item.gitInfoSummary ?? "").trim()
    ? `${displayTitle}\n${String(row.item.gitInfoSummary ?? "").trim()}`
    : displayTitle;
  const hasUserInputQuestion = shouldShowUserInputBadge(threadId);
  const threadVisualStatus = useMemo<ThreadVisualStatus>(() => {
    if (!threadId) return "idle";
    if (hasUserInputQuestion) return "question";
    if (runningThreadIds.has(threadId)) return "running";
    if (shouldShowThreadAttention(threadId)) return "attention";
    if (recentlyCompletedThreadIds.has(threadId)) return "completed";
    return "idle";
  }, [hasUserInputQuestion, recentlyCompletedThreadIds, runningThreadIds, shouldShowThreadAttention, threadId]);
  const threadStatusClass = threadVisualStatus === "idle" ? "" : `is-status-${threadVisualStatus}`;
  const agentNicknameBadge = truncateAgentNickname(row.item.agentNickname);
  const pending = isPendingThreadId(threadId) || row.item.localStatus === "creating";
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameCancelValue, setRenameCancelValue] = useState("");

  useEffect(() => {
    if (!isRenaming) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [isRenaming]);

  const beginRename = () => {
    if (pending) return;
    if (!threadId) return;
    const current = String(displayTitle ?? "").trim();
    setRenameCancelValue(current);
    setRenameDraft(current);
    setIsRenaming(true);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setRenameDraft(renameCancelValue);
    setRenameCancelValue("");
  };

  const commitRename = () => {
    if (!isRenaming) return;
    setIsRenaming(false);
    setRenameCancelValue("");
    if (!threadId) return;
    onRenameThread?.(threadId, renameDraft);
  };

  const onRowKeydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isRenaming) return;
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    onOpenThread?.(threadId);
  };

  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isRenaming) {
      event.preventDefault();
      return;
    }
    onOpenThread?.(threadId);
  };

  const onRenameKeydown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isRenaming) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRename();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commitRename();
    }
  };

  return (
    <div
      className={[
        "lsb-thread-row",
        row.item.id === activeThreadId ? "active" : "",
        isInvalidWorkspaceItem(row.item) ? "invalid-workspace" : "",
        threadStatusClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="lsb-thread-row-shell" style={threadRowDepthStyle(row.depth)}>
        <span className="lsb-thread-toggle-spacer" aria-hidden="true" />
        <div
          className="lsb-thread-item"
          role="button"
          tabIndex={0}
          aria-label={threadAriaLabel(row)}
          onClick={onRowClick}
          onKeyDown={onRowKeydown}
        >
          <span className="lsb-thread-title">
            {pending ? (
              <LoadingDots
                className="lsb-thread-title-text"
                baseText={t("threadRow.creating")}
                intervalMs={350}
                maxDots={3}
                ariaLabel={t("threadRow.creating")}
              />
            ) : isRenaming ? (
              <input
                ref={renameInputRef}
                className="lsb-thread-title-input mono"
                type="text"
                maxLength={80}
                aria-label={t("threadRow.renameAria")}
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.currentTarget.value)}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={onRenameKeydown}
                onBlur={commitRename}
              />
            ) : (
              <span className="lsb-thread-title-text" title={titleTooltip} onDoubleClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                beginRename();
              }}>
                {displayTitle}
              </span>
            )}
            {hasUserInputQuestion ? <span className="lsb-badge is-question">{t("threadRow.qa")}</span> : null}
            {agentNicknameBadge ? <span className="lsb-badge">{agentNicknameBadge}</span> : null}
            {isInvalidWorkspaceItem(row.item) ? <span className="lsb-badge">{t("threadRow.invalid")}</span> : null}
          </span>

          <span className="lsb-thread-right">
            <span className="lsb-thread-status">
              {threadVisualStatus === "question" ? (
                <MessageCircleQuestionMark className="lsb-thread-status-icon is-question" aria-hidden="true" />
              ) : threadVisualStatus === "running" ? (
                <span className="running-indicator is-thread-running" aria-hidden="true" />
              ) : threadVisualStatus === "attention" ? (
                <button
                  className="lsb-thread-attention-btn"
                  type="button"
                  aria-label={t("threadRow.clearAttention")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClearThreadAttention?.(threadId);
                  }}
                >
                  <BellRing className="lsb-thread-status-icon is-attention" aria-hidden="true" />
                </button>
              ) : threadVisualStatus === "completed" ? (
                <CheckCircle2 className="lsb-thread-status-icon is-completed" aria-hidden="true" />
              ) : null}
            </span>

            <span className="lsb-thread-time">{formatRelativeTime(row.item.updatedAt)}</span>

            <button
              className="lsb-icon-btn lsb-delete"
              type="button"
              aria-label={t("threadRow.deleteHistory")}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteThread?.(threadId);
              }}
            >
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
