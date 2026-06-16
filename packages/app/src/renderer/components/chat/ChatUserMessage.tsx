import type { HTMLAttributes } from "react";
import { Icon } from "@iconify/react";
import type { EnvironmentContextBlock } from "../../domain/taggedMessageBlocks";
import type { TimelineEventItem } from "../../domain/types";
import type {
  ChatImageEntry,
  ChatInlineRewriteDraft,
  ChatUserMessagePart,
  ImagePreviewPayload,
  ThumbLoadErrorPayload,
} from "../layout/types/chat.types";
import LazyImageThumb from "../ui/LazyImageThumb";
import ChatInlineRewriteOverlay from "./ChatInlineRewriteOverlay";

type Option = string | { value: string; label: string; disabled?: boolean };

export type ChatUserMessageProps = HTMLAttributes<HTMLDivElement> & {
  event?: TimelineEventItem;
  messageParts?: ChatUserMessagePart[];
  imageCount?: number;
  visibleImages?: ChatImageEntry[];
  workspaceRoot?: string;
  showTimestamps?: boolean;
  formattedTime?: string;
  onFileTokenClick?: (path: string) => void;
  onThumbLoadError?: (payload: ThumbLoadErrorPayload) => void;
  onPreviewImage?: (payload: ImagePreviewPayload) => void;
  inlineRewriteDraft?: ChatInlineRewriteDraft | null;
  modelOptions?: readonly Option[];
  reasoningEffortOptions?: readonly Option[];
  sandboxModeOptions?: readonly Option[];
  sendDisabled?: boolean;
  onInlineRewriteUpdate?: (patch: Partial<ChatInlineRewriteDraft>) => void;
  onInlineRewriteCancel?: () => void;
  onInlineRewriteSend?: () => void;
};

function environmentContextRows(context: EnvironmentContextBlock) {
  return [
    { key: "cwd", label: "cwd", value: context.cwd },
    { key: "shell", label: "shell", value: context.shell },
    { key: "current_date", label: "date", value: context.currentDate },
    { key: "timezone", label: "zone", value: context.timezone },
  ].filter((row) => row.value);
}

export default function ChatUserMessage({
  event,
  messageParts = [],
  imageCount = 0,
  visibleImages = [],
  workspaceRoot = "",
  showTimestamps = false,
  formattedTime = "",
  onFileTokenClick,
  onThumbLoadError,
  onPreviewImage,
  inlineRewriteDraft,
  modelOptions = [],
  reasoningEffortOptions = [],
  sandboxModeOptions = [],
  sendDisabled = false,
  onInlineRewriteUpdate,
  onInlineRewriteCancel,
  onInlineRewriteSend,
  className,
  ...props
}: ChatUserMessageProps) {
  const fallbackText = messageParts.length <= 0 ? String(event?.paramsText ?? "") : "";
  const renderPart = (part: ChatUserMessagePart) => {
    if (part.type === "text") return <span key={part.key}>{part.text}</span>;
    if (part.type === "file") {
      return (
        <button
          key={part.key}
          type="button"
          className="chat-inline-file-token"
          title={part.title}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            onFileTokenClick?.(part.path);
          }}
        >
          <Icon className="chat-inline-file-token__icon" icon={part.icon as any} aria-hidden="true" />
          <span className="chat-inline-file-token__label">{part.label}</span>
        </button>
      );
    }

    const rows = environmentContextRows(part.context);
    return (
      <div key={part.key} className="chat-environment-context">
        <div className="chat-environment-context__title mono">环境上下文</div>
        {rows.length > 0 ? (
          <dl className="chat-environment-context__grid">
            {rows.map((row) => (
              <span key={row.key} className="contents">
                <dt className="mono">{row.label}</dt>
                <dd className="mono">{row.value}</dd>
              </span>
            ))}
          </dl>
        ) : (
          <pre className="chat-environment-context__raw mono">{part.context.raw}</pre>
        )}
      </div>
    );
  };

  return (
    <div {...props} className={["chat-row flex min-w-0 m-0 chat-row--user-shell", className].filter(Boolean).join(" ")}>
      <div className={["chat-user-bubble-stack", inlineRewriteDraft ? "is-editing" : ""].filter(Boolean).join(" ")}>
        <div className="chat-bubble chat-bubble-user ml-auto flex max-w-[min(760px,92%)] flex-col gap-2 border px-3 py-2 text-sm">
          <div className="chat-bubble-body min-w-0 whitespace-pre-wrap break-words">
            {messageParts.length > 0 ? messageParts.map(renderPart) : fallbackText || " "}
          </div>
          {imageCount > 0 ? (
            <div className="chat-user-images mt-2.5 flex flex-col gap-2">
              <div className="mono dim text-[11px]">{`附图 ${imageCount} 张`}</div>
              {visibleImages.length > 0 ? (
                <div className="chat-user-image-list flex flex-wrap gap-2 max-[1500px]:gap-1.5">
                  {visibleImages.map((image) => (
                    <LazyImageThumb
                      key={image.id}
                      className="h-[92px] w-[92px] max-w-full"
                      imageId={image.id}
                      source={image.source}
                      sourceKind={image.sourceKind}
                      previewTitle={image.title}
                      workspaceRoot={workspaceRoot}
                      rootMarginPx={260}
                      onLoadError={onThumbLoadError}
                      onPreview={onPreviewImage}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {showTimestamps && formattedTime ? <div className="chat-bubble-meta-right mono">{formattedTime}</div> : null}
        </div>
        {inlineRewriteDraft ? (
          <ChatInlineRewriteOverlay
            draft={inlineRewriteDraft}
            modelOptions={modelOptions}
            reasoningEffortOptions={reasoningEffortOptions}
            sandboxModeOptions={sandboxModeOptions}
            sendDisabled={sendDisabled}
            onUpdate={onInlineRewriteUpdate}
            onCancel={onInlineRewriteCancel}
            onSend={onInlineRewriteSend}
          />
        ) : null}
      </div>
    </div>
  );
}
