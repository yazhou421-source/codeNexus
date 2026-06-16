import type { TimelineEventItem } from "../../../domain/types";
import { stripInlineMemoryCitation } from "../../../domain/taggedMessageBlocks";
import { tryParseStructuredFinalAnswerV1 } from "../../../domain/structuredFinalAnswer";
import { renderMarkdownToSafeHtml } from "../../../features/timeline/markdownRenderer";
import { formatTime } from "../../../features/timeline/renderModel/formatters";
import type { ChatInlineRewriteDraft, ChatRenderedRow, PlanDeltaExecUiState } from "../types/chat.types";
import type { SandboxMode } from "../../../stores/runtime.store";
import ChatActivityRow from "../../chat/ChatActivityRow";
import ChatAssistantMessage from "../../chat/ChatAssistantMessage";
import ChatAuxActivityGroup from "../../chat/ChatAuxActivityGroup";
import ChatCommandActionRow from "../../chat/ChatCommandActionRow";
import ChatCommandSessionCard from "../../chat/ChatCommandSessionCard";
import ChatImageToolCard from "../../chat/ChatImageToolCard";
import ChatReasoningBlock from "../../chat/ChatReasoningBlock";
import ChatSshToolActivity from "../../chat/ChatSshToolActivity";
import ChatSystemRow from "../../chat/ChatSystemRow";
import ChatTokenUsageSummary from "../../chat/ChatTokenUsageSummary";
import ChatUserMessage from "../../chat/ChatUserMessage";
import ChatWebSearchCard from "../../chat/ChatWebSearchCard";
import AgentMarkdownContent from "../../ui/AgentMarkdownContent";
import DynamicToolCallCardContent from "../../timeline/cards/DynamicToolCallCardContent";
import FileChangeCardContent from "../../timeline/cards/FileChangeCardContent";
import McpResourceReadCardContent from "../../timeline/cards/McpResourceReadCardContent";
import McpToolCardContent from "../../timeline/cards/McpToolCardContent";
import CommandReadActivityRow from "../../timeline/activities/CommandReadActivityRow";
import CommandListActivityRow from "../../timeline/activities/CommandListActivityRow";
import CommandSearchActivityRow from "../../timeline/activities/CommandSearchActivityRow";
import { CHAT_ROW_ACTIVITY_CLASS, CHAT_ROW_TOOL_CLASS } from "./chatPresentation";
import { chatActivityToneClass } from "./chatStyle";

export type ChatRowRendererProps = {
  renderedRow?: ChatRenderedRow;
  workspaceRoot?: string;
  viewPrefs?: { showTimestamps?: boolean };
  planExecStateByEventId?: Record<string, PlanDeltaExecUiState>;
  isTurnRunning?: boolean;
  modelOptions?: readonly (string | { value: string; label: string; disabled?: boolean })[];
  reasoningEffortOptions?: readonly (string | { value: string; label: string; disabled?: boolean })[];
  sandboxModeOptions?: readonly (string | { value: string; label: string; disabled?: boolean })[];
  sendDisabled?: boolean;
  inlineRewriteDraft?: ChatInlineRewriteDraft | null;
  userMessageParts?: (event: TimelineEventItem) => any[];
  userMessageImageCount?: (event: TimelineEventItem) => number;
  visibleUserMessageImageEntries?: (event: TimelineEventItem) => any[];
  visibleImageToolEntries?: (item: any) => any[];
  handleThumbLoadError?: (payload: any) => void;
  handleUserFileTokenClick?: (path: string) => void;
  handleUserBubbleClick?: (event: TimelineEventItem) => void;
  updateInlineRewriteDraft?: (patch: Partial<ChatInlineRewriteDraft>) => void;
  closeInlineRewrite?: () => void;
  sendInlineRewriteDraft?: () => void;
  executePlanFromPlanDelta?: (event: TimelineEventItem) => void;
  updatePlanExecModel?: (eventId: string, value: string) => void;
  updatePlanExecReasoningEffort?: (eventId: string, value: string) => void;
  updatePlanExecSandboxMode?: (eventId: string, value: SandboxMode) => void;
  handlePreviewImage?: (payload: any) => void;
  handleLayoutChange?: () => void;
  getMarkdownEventHtml?: (event: TimelineEventItem) => string;
  isReasoningOpen?: (item: any) => boolean;
  setReasoningOpen?: (item: any, open: boolean) => void;
  isCommandFilesOpen?: (nodeId: string) => boolean;
  toggleCommandFilesOpen?: (nodeId: string) => void;
  isCommandSessionStopping?: (processId: string) => boolean;
  stopCommandSession?: (item: any) => void;
  isMcpToolGroupOpen?: (id: string) => boolean;
  onMcpToolGroupToggle?: (id: string, open: boolean) => void;
  isMcpResourceOpen?: (id: string) => boolean;
  setMcpResourceOpen?: (id: string, open: boolean) => void;
  openMcpResourceInPanel?: (item: any) => void;
  onOpenRelatedMcpResource?: (item: any) => void;
};

function markdownHtml(event: TimelineEventItem, getMarkdownEventHtml?: (event: TimelineEventItem) => string) {
  if (getMarkdownEventHtml) return getMarkdownEventHtml(event);
  return renderMarkdownToSafeHtml(String(event.paramsText ?? ""), { cache: true });
}

function GenericToolCard({ title, item }: { title: string; item: any }) {
  const body = (() => {
    try {
      return JSON.stringify(item ?? {}, null, 2);
    } catch {
      return String(item ?? "");
    }
  })();
  return (
    <div className={CHAT_ROW_TOOL_CLASS}>
      <div className="chat-tool-wrap w-full max-w-full min-w-0">
        <div className="dynamic-tool-chat-card rounded border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-3 text-xs">
          <div className="mb-2 font-semibold">{title}</div>
          <pre className="app-scrollbar m-0 max-h-64 overflow-auto whitespace-pre-wrap">{body}</pre>
        </div>
      </div>
    </div>
  );
}

export default function ChatRowRenderer(props: ChatRowRendererProps) {
  const row = props.renderedRow;
  if (!row) return null;

  if (row.kind === "user") {
    return (
      <ChatUserMessage
        event={row.event}
        workspaceRoot={props.workspaceRoot}
        messageParts={props.userMessageParts?.(row.event)}
        imageCount={props.userMessageImageCount?.(row.event)}
        visibleImages={props.visibleUserMessageImageEntries?.(row.event)}
        showTimestamps={Boolean(props.viewPrefs?.showTimestamps)}
        formattedTime={new Date(row.event.createdAt).toLocaleTimeString()}
        onClick={() => props.handleUserBubbleClick?.(row.event)}
        onFileTokenClick={props.handleUserFileTokenClick}
        onThumbLoadError={props.handleThumbLoadError}
        onPreviewImage={props.handlePreviewImage}
        inlineRewriteDraft={props.inlineRewriteDraft?.anchorEventId === String(row.event.id ?? "") ? props.inlineRewriteDraft : null}
        modelOptions={props.modelOptions}
        reasoningEffortOptions={props.reasoningEffortOptions}
        sandboxModeOptions={props.sandboxModeOptions}
        sendDisabled={props.sendDisabled}
        onInlineRewriteUpdate={props.updateInlineRewriteDraft}
        onInlineRewriteCancel={props.closeInlineRewrite}
        onInlineRewriteSend={props.sendInlineRewriteDraft}
      />
    );
  }
  if (row.kind === "assistant") {
    const text = stripInlineMemoryCitation(String(row.event.paramsText ?? ""));
    return (
      <ChatAssistantMessage
        event={row.event}
        markdownHtml={markdownHtml(row.event, props.getMarkdownEventHtml)}
        isStructuredFinalAnswer={Boolean(tryParseStructuredFinalAnswerV1(text))}
        execState={props.planExecStateByEventId?.[String(row.event.id ?? "")] ?? null}
        modelOptions={props.modelOptions}
        isTurnRunning={props.isTurnRunning}
        reasoningEffortOptions={props.reasoningEffortOptions}
        sandboxModeOptions={props.sandboxModeOptions}
        onExecutePlan={props.executePlanFromPlanDelta}
        onUpdateModel={(value) => props.updatePlanExecModel?.(String(row.event.id ?? ""), value)}
        onUpdateReasoningEffort={(value) => props.updatePlanExecReasoningEffort?.(String(row.event.id ?? ""), value)}
        onUpdateSandboxMode={(value) => props.updatePlanExecSandboxMode?.(String(row.event.id ?? ""), value)}
      />
    );
  }
  if (row.kind === "system") return <ChatSystemRow text={row.text} />;
  if (row.kind === "activity") {
    return <ChatActivityRow text={row.text} activityDotClass={chatActivityToneClass(row.tone)} />;
  }
  if (row.kind === "assistantCommentary") {
    return (
      <div className={CHAT_ROW_ACTIVITY_CLASS}>
        <AgentMarkdownContent className="chat-assistant-commentary min-w-0" html={markdownHtml(row.event, props.getMarkdownEventHtml)} />
      </div>
    );
  }
  if (row.kind === "auxActivityGroup") {
    return (
      <ChatAuxActivityGroup
        id={row.id}
        items={row.items}
        summaryItems={row.summaryItems}
        summaryText={row.summaryText}
        status={row.status}
        defaultCollapsed={row.defaultCollapsed}
        startedAtMs={row.startedAtMs}
        answerStartedAtMs={row.answerStartedAtMs}
        elapsedLive={row.elapsedLive}
        onLayoutChange={props.handleLayoutChange}
      >
        {({ item }: any) => <ChatRowRenderer {...props} renderedRow={item} />}
      </ChatAuxActivityGroup>
    );
  }
  if (row.kind === "tokenUsageSummary") return <ChatTokenUsageSummary usage={row.item.usage} onLayoutChange={props.handleLayoutChange} />;
  if (row.kind === "imageTool") {
    return (
      <div className={CHAT_ROW_TOOL_CLASS}>
        <ChatImageToolCard
          item={row.item}
          visibleImages={props.visibleImageToolEntries?.(row.item)}
          workspaceRoot={props.workspaceRoot}
          showTimestamps={Boolean(props.viewPrefs?.showTimestamps)}
          formattedTime={formatTime(row.createdAt)}
          onLoadError={props.handleThumbLoadError}
          onPreview={props.handlePreviewImage}
        />
      </div>
    );
  }
  if (row.kind === "webSearch") {
    return (
      <div className={CHAT_ROW_TOOL_CLASS}>
        <ChatWebSearchCard item={row.item} />
      </div>
    );
  }
  if (row.kind === "reasoningBlock") {
    return (
      <ChatReasoningBlock
        isOpen={props.isReasoningOpen?.(row.item)}
        summaryTitle={row.item.title || undefined}
        durationText={row.item.durationMs ? `${Math.max(1, Math.round(row.item.durationMs / 1000))}s` : ""}
        rawText={row.item.rawText}
        html={renderMarkdownToSafeHtml(String(row.item.text ?? row.item.rawText ?? ""), { cache: true })}
        rawContentCount={row.item.rawContentCount}
        onToggle={(open) => props.setReasoningOpen?.(row.item, open)}
      />
    );
  }
  if (row.kind === "dynamicTool") {
    return (
      <div className={CHAT_ROW_TOOL_CLASS}>
        <div className="chat-tool-wrap w-full max-w-full min-w-0">
          <DynamicToolCallCardContent className="dynamic-tool-chat-card w-full rounded-xl border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-3" item={row.item} />
        </div>
      </div>
    );
  }
  if (row.kind === "fileChange") {
    return (
      <div className={CHAT_ROW_TOOL_CLASS}>
        <div className="chat-tool-wrap w-full max-w-full min-w-0">
          <FileChangeCardContent item={row.item} mode="chat" wrapDiffLines={false} onLayoutChange={props.handleLayoutChange} />
        </div>
      </div>
    );
  }
  if (row.kind === "commandAction") {
    return (
      <ChatCommandActionRow
        item={row.item}
        isFilesOpen={props.isCommandFilesOpen?.(row.item.id)}
        onToggleFiles={() => props.toggleCommandFilesOpen?.(row.item.id)}
      />
    );
  }
  if (row.kind === "commandSession") {
    return (
      <div className={CHAT_ROW_TOOL_CLASS}>
        <ChatCommandSessionCard
          item={row.item}
          stopping={props.isCommandSessionStopping?.(row.item.processId)}
          onStop={props.stopCommandSession}
          onLayoutChange={props.handleLayoutChange}
        />
      </div>
    );
  }
  if (row.kind === "commandRead") return <CommandReadActivityRow item={row.item} />;
  if (row.kind === "commandList") return <CommandListActivityRow item={row.item} />;
  if (row.kind === "commandSearch") return <CommandSearchActivityRow item={row.item} />;
  if (row.kind === "mcpResourceRead") {
    return (
      <div className={CHAT_ROW_TOOL_CLASS}>
        <div className="chat-tool-wrap w-full max-w-full min-w-0">
          <McpResourceReadCardContent
            open={props.isMcpResourceOpen?.(row.item.id)}
            item={row.item}
            onOpenInPanel={props.openMcpResourceInPanel}
            onOpenChange={(open: boolean) => props.setMcpResourceOpen?.(row.item.id, open)}
          />
        </div>
      </div>
    );
  }
  if (row.kind === "mcpToolGroup") {
    const isSsh = (row.group.items ?? []).some((item: any) => String(item?.server ?? "").toLowerCase().includes("ssh"));
    if (isSsh) return <ChatSshToolActivity group={row.group} className={CHAT_ROW_TOOL_CLASS} />;
    return (
      <div className={CHAT_ROW_TOOL_CLASS}>
        <div className="chat-tool-wrap w-full max-w-full min-w-0">
          <McpToolCardContent
            open={props.isMcpToolGroupOpen?.(row.group.id)}
            group={row.group}
            items={row.group.items}
            onOpenRelatedResource={props.onOpenRelatedMcpResource}
            onOpenChange={(open: boolean) => props.onMcpToolGroupToggle?.(row.group.id, open)}
          />
        </div>
      </div>
    );
  }
  return <GenericToolCard title={String((row as any).kind ?? "Tool")} item={row} />;
}
