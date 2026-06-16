import type { KeyboardEvent } from "react";
import type { ChatUserMessagePart } from "../layout/types/chat.types";

type ChatPinnedUserPromptBoxProps = {
  text?: string;
  messageParts?: ChatUserMessagePart[];
  title?: string;
  fileCount?: number;
  imageCount?: number;
  showTimestamp?: boolean;
  formattedTime?: string;
  contentKey?: string;
  transitionDirection?: "up" | "down";
  onLocate?: () => void;
  onFileTokenClick?: (path: string) => void;
};

function normalizeCount(value: number | undefined): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function displayParts(parts: ChatUserMessagePart[] | undefined, fallbackText: string): ChatUserMessagePart[] {
  const normalized: ChatUserMessagePart[] = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (part.type === "environmentContext") continue;
    if (part.type === "file") {
      normalized.push(part);
      continue;
    }
    const text = part.text.replace(/\s+/g, " ");
    if (text) normalized.push({ ...part, text });
  }
  return normalized.length > 0 ? normalized : [{ key: "fallback", type: "text", text: fallbackText }];
}

export default function ChatPinnedUserPromptBox({
  text = "",
  messageParts,
  title = "",
  fileCount = 0,
  imageCount = 0,
  showTimestamp = false,
  formattedTime = "",
  contentKey = "",
  transitionDirection = "up",
  onLocate,
  onFileTokenClick,
}: ChatPinnedUserPromptBoxProps) {
  const normalizedFileCount = normalizeCount(fileCount);
  const normalizedImageCount = normalizeCount(imageCount);
  const hasMeta = normalizedFileCount > 0 || normalizedImageCount > 0;
  const displayText = String(text ?? "").replace(/\s+/g, " ").trim() || "用户消息";
  const parts = displayParts(messageParts, displayText);
  const tooltipText = String(title ?? "").trim() || displayText;
  const metaVisible = Boolean((showTimestamp && formattedTime) || hasMeta);
  const transitionClass = `chat-pinned-prompt-content-${transitionDirection}`;

  const handleKeydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onLocate?.();
  };

  return (
    <div
      className="chat-bubble chat-bubble-user chat-pinned-prompt w-full max-w-full min-w-0 cursor-pointer rounded-[4px] border border-[color:var(--bubble-user-border)] bg-[var(--bubble-user-bg)] bg-clip-padding px-3 py-2.5 shadow-[var(--bubble-shadow)]"
      title={tooltipText}
      role="button"
      tabIndex={0}
      aria-label="定位到当前提问"
      onClick={onLocate}
      onKeyDown={handleKeydown}
    >
      <div className="chat-bubble-inline flex min-w-0 items-center justify-between gap-2.5">
        <div className="chat-bubble-body flex-1 min-w-0 whitespace-pre-wrap break-words">
          <span className="chat-pinned-prompt__content-clip">
            <span key={contentKey || displayText} className={["chat-pinned-prompt__content", transitionClass].join(" ")}>
              <span className="chat-pinned-prompt__text">
                {parts.map((part) =>
                  part.type === "file" ? (
                    <button
                      key={part.key}
                      className="chat-inline-file-token chat-pinned-prompt__file-token"
                      type="button"
                      title={part.title}
                      onClick={(event) => {
                        event.stopPropagation();
                        onFileTokenClick?.(part.path);
                      }}
                    >
                      <span className="chat-inline-file-token__label">{part.label}</span>
                    </button>
                  ) : part.type === "text" ? (
                    <span key={part.key} className="chat-pinned-prompt__text-part">
                      {part.text}
                    </span>
                  ) : null
                )}
              </span>
            </span>
          </span>
        </div>
        {metaVisible ? (
          <span className="chat-bubble-meta-right inline-flex flex-none min-w-0 items-center justify-end gap-2.5 whitespace-nowrap">
            <span className="chat-pinned-prompt__meta-clip">
              <span className="chat-pinned-prompt__meta">
                {showTimestamp && formattedTime ? <span className="mono dim">{formattedTime}</span> : null}
                {hasMeta ? (
                  <span className="chat-pinned-prompt__tags" aria-hidden="true">
                    {normalizedFileCount > 0 ? <span className="chat-pinned-prompt__tag">{`+${normalizedFileCount} 文件`}</span> : null}
                    {normalizedImageCount > 0 ? <span className="chat-pinned-prompt__tag">{`+${normalizedImageCount} 图片`}</span> : null}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
