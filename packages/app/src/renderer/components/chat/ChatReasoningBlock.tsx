import type { HTMLAttributes } from "react";
import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { CHAT_ROW_TOOL_CLASS } from "../layout/chat/chatPresentation";
import AgentMarkdownContent from "../ui/AgentMarkdownContent";
import Collapsible from "../ui/Collapsible";

export type ChatReasoningBlockProps = HTMLAttributes<HTMLDivElement> & {
  isOpen?: boolean;
  summaryTitle?: string;
  durationText?: string;
  html?: string;
  rawText?: string;
  rawContentCount?: number;
  onToggle?: (open: boolean) => void;
};

export default function ChatReasoningBlock({
  isOpen,
  summaryTitle = "Reasoning",
  durationText = "",
  html = "",
  rawText = "",
  rawContentCount = 0,
  onToggle,
  className,
  ...props
}: ChatReasoningBlockProps) {
  const [rawOpen, setRawOpen] = useState(false);
  const hasRawText = String(rawText ?? "").trim().length > 0;
  const rawContentCountText = `${Math.max(1, Math.max(0, Math.round(Number(rawContentCount) || 0)))} 段`;

  return (
    <div {...props} className={[CHAT_ROW_TOOL_CLASS, className].filter(Boolean).join(" ")}>
      <Collapsible
        className="reasoning-summary-event w-full"
        open={isOpen}
        defaultOpen={false}
        onOpenChange={onToggle}
        trigger={({ triggerProps, open }) => (
          <div
            className="reasoning-summary-meta flex w-full min-w-0 items-center gap-2.5 overflow-hidden text-xs dim cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-warning-hover)] focus-visible:outline-offset-2"
            {...triggerProps}
          >
            <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <span className="ui-leading-icon-slot" aria-hidden="true">
                <Brain className="h-3 w-3 flex-none text-[var(--fg-warning)] [stroke-width:2.2]" />
              </span>
              <span className="min-w-0 truncate">{summaryTitle || "思考"}</span>
              {durationText ? <span className="mono dim whitespace-nowrap">{durationText}</span> : null}
            </span>
            <ChevronDown
              className={["ml-auto h-3.5 w-3.5 flex-none opacity-80 transition-transform duration-150 [stroke-width:2.4]", open ? "rotate-180" : ""]
                .filter(Boolean)
                .join(" ")}
              aria-hidden="true"
            />
          </div>
        )}
      >
        <AgentMarkdownContent className="body agent-markdown-body mt-1 text-[var(--text-muted)]" html={html || undefined} markdown={html ? undefined : rawText} />
        {hasRawText ? (
          <Collapsible
            className="reasoning-raw mt-2 w-full"
            open={rawOpen}
            onOpenChange={setRawOpen}
            trigger={({ triggerProps, open }) => (
              <div
                className="reasoning-raw-trigger inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2 py-1 text-[11px] text-[var(--text-muted)] cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-warning-hover)] focus-visible:outline-offset-2"
                {...triggerProps}
              >
                <span className="min-w-0 truncate">原始推理</span>
                <span className="mono dim whitespace-nowrap">{rawContentCountText}</span>
                <ChevronDown
                  className={["h-3 w-3 flex-none opacity-80 transition-transform duration-150 [stroke-width:2.4]", open ? "rotate-180" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  aria-hidden="true"
                />
              </div>
            )}
          >
            <pre className="reasoning-raw-body app-scrollbar m-0 mt-1.5 max-h-[280px] overflow-auto rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2.5 text-[12px] leading-[1.5] text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words mono">
              {rawText}
            </pre>
          </Collapsible>
        ) : null}
      </Collapsible>
    </div>
  );
}
