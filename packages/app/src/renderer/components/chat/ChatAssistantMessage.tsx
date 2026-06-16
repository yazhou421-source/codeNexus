import type { HTMLAttributes } from "react";
import type { MemoryCitation, MemoryCitationEntry } from "@codenexus/generated/codex-app-server/v2";
import type { TimelineEventItem } from "../../domain/types";
import {
  extractInlineMemoryCitation,
  stripInlineMemoryCitation,
  type ParsedMemoryCitation,
} from "../../domain/taggedMessageBlocks";
import { tryParseStructuredFinalAnswerV1 } from "../../domain/structuredFinalAnswer";
import { translate } from "../../i18n/translate";
import type { SandboxMode } from "../../stores/runtime.store";
import type { PlanDeltaExecUiState } from "../layout/types/chat.types";
import AgentMarkdownContent from "../ui/AgentMarkdownContent";
import MarkdownPlanOutputCard from "../ui/MarkdownPlanOutputCard";
import StructuredFinalAnswerCard from "../ui/StructuredFinalAnswerCard";
import ChatPlanDeltaActions from "./ChatPlanDeltaActions";

type Option = string | { value: string; label: string; disabled?: boolean };

export type ChatAssistantMessageProps = HTMLAttributes<HTMLDivElement> & {
  event?: TimelineEventItem;
  markdownHtml?: string;
  isStructuredFinalAnswer?: boolean;
  execState?: PlanDeltaExecUiState | null;
  modelOptions?: readonly Option[];
  isTurnRunning?: boolean;
  reasoningEffortOptions?: readonly Option[];
  sandboxModeOptions?: readonly Option[];
  onExecutePlan?: (event: TimelineEventItem) => void;
  onUpdateModel?: (value: string) => void;
  onUpdateReasoningEffort?: (value: string) => void;
  onUpdateSandboxMode?: (value: SandboxMode) => void;
};

function normalizeMemoryCitation(value: unknown): ParsedMemoryCitation | null {
  const citation = value && typeof value === "object" && !Array.isArray(value) ? (value as MemoryCitation) : null;
  if (!citation) return null;
  const entries = Array.isArray(citation.entries) ? citation.entries : [];
  const threadIds = Array.isArray(citation.threadIds) ? citation.threadIds : [];
  if (entries.length <= 0 && threadIds.length <= 0) return null;
  return { entries, threadIds, raw: "" };
}

function memoryCitationEntryLine(entry: MemoryCitationEntry) {
  const path = String(entry?.path ?? "").trim();
  const start = Number(entry?.lineStart ?? 0);
  const end = Number(entry?.lineEnd ?? 0);
  const range = start > 0 && end > 0 ? `${start}-${end}` : "";
  return range ? `${path}:${range}` : path;
}

export default function ChatAssistantMessage({
  event,
  markdownHtml,
  isStructuredFinalAnswer = false,
  execState = null,
  modelOptions = [],
  isTurnRunning = false,
  reasoningEffortOptions = [],
  sandboxModeOptions = [],
  onExecutePlan,
  onUpdateModel,
  onUpdateReasoningEffort,
  onUpdateSandboxMode,
  className,
  ...props
}: ChatAssistantMessageProps) {
  const rawText = String(event?.paramsText ?? "").trim();
  const displayText = stripInlineMemoryCitation(rawText);
  const isPlanDelta = event?.method === "item/plan/delta";
  const structured = isStructuredFinalAnswer || Boolean(tryParseStructuredFinalAnswerV1(displayText));
  const planActionDisabled = isTurnRunning || Boolean(execState?.executing);
  const shouldCollapsePlan = Boolean(execState?.collapseWhileExecuting && (execState.executing || isTurnRunning));
  const memoryCitation =
    normalizeMemoryCitation((event?.params as any)?.item?.memoryCitation) ?? extractInlineMemoryCitation(rawText);
  const memoryCitationEntries = memoryCitation?.entries ?? [];
  const memoryCitationThreadIds = memoryCitation?.threadIds ?? [];
  const memoryCitationRaw = memoryCitation?.raw ?? "";
  const memoryCitationSummary =
    memoryCitation && (memoryCitationEntries.length > 0 || memoryCitationThreadIds.length > 0 || memoryCitationRaw)
      ? translate("chat.memoryCitation.summary", {
          entries: memoryCitationEntries.length,
          threads: memoryCitationThreadIds.length,
        })
      : "";
  const planActions = execState && event ? (
    <ChatPlanDeltaActions
      execState={execState}
      modelOptions={modelOptions}
      reasoningEffortOptions={reasoningEffortOptions}
      sandboxModeOptions={sandboxModeOptions}
      disabled={planActionDisabled}
      embedded
      onExecutePlan={() => onExecutePlan?.(event)}
      onUpdateModel={onUpdateModel}
      onUpdateReasoningEffort={onUpdateReasoningEffort}
      onUpdateSandboxMode={onUpdateSandboxMode}
    />
  ) : null;
  const compactPlanActions = execState && event ? (
    <ChatPlanDeltaActions
      execState={execState}
      modelOptions={modelOptions}
      reasoningEffortOptions={reasoningEffortOptions}
      sandboxModeOptions={sandboxModeOptions}
      disabled={planActionDisabled}
      embedded
      compact
      onExecutePlan={() => onExecutePlan?.(event)}
      onUpdateModel={onUpdateModel}
      onUpdateReasoningEffort={onUpdateReasoningEffort}
      onUpdateSandboxMode={onUpdateSandboxMode}
    />
  ) : null;

  return (
    <div {...props} className={["chat-row flex min-w-0 m-0 chat-row--assistant", className].filter(Boolean).join(" ")}>
      <div className="chat-bubble chat-bubble-assistant w-full max-w-full min-w-0 px-1 py-2 text-sm">
        {isPlanDelta ? (
          <MarkdownPlanOutputCard
            rawText={rawText}
            forceCollapsed={shouldCollapsePlan}
            headerActions={compactPlanActions}
            actions={planActions}
          />
        ) : structured ? (
          <StructuredFinalAnswerCard className="chat-bubble-body min-w-0" rawText={displayText} />
        ) : (
          <AgentMarkdownContent
            className="chat-bubble-body agent-markdown-body min-w-0"
            html={displayText === rawText ? markdownHtml || undefined : undefined}
            markdown={displayText === rawText && markdownHtml ? undefined : displayText}
          />
        )}
        {memoryCitationSummary ? (
          <details className="assistant-memory-citation">
            <summary className="assistant-memory-citation__summary mono">{memoryCitationSummary}</summary>
            <div className="assistant-memory-citation__body">
              {memoryCitationEntries.length > 0 ? (
                <ul className="assistant-memory-citation__entries">
                  {memoryCitationEntries.map((entry) => (
                    <li key={`${entry.path}:${entry.lineStart}:${entry.lineEnd}`}>
                      <div className="assistant-memory-citation__path mono">{memoryCitationEntryLine(entry)}</div>
                      {entry.note ? <div className="assistant-memory-citation__note">{entry.note}</div> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {memoryCitationThreadIds.length > 0 ? (
                <div className="assistant-memory-citation__threads mono">
                  {translate("chat.memoryCitation.threadIds")} {memoryCitationThreadIds.join(", ")}
                </div>
              ) : null}
              {memoryCitationEntries.length === 0 && memoryCitationThreadIds.length === 0 && memoryCitationRaw ? (
                <pre className="assistant-memory-citation__raw mono">{memoryCitationRaw}</pre>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
