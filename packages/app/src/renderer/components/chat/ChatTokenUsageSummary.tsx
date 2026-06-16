import type { HTMLAttributes } from "react";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { TokenUsageState } from "../../domain/types";
import { translate } from "../../i18n/translate";

export type ChatTokenUsageSummaryProps = HTMLAttributes<HTMLDivElement> & {
  usage?: TokenUsageState;
  onLayoutChange?: () => void;
};

function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const rounded = Math.max(0, Math.round(value));
  if (rounded >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}m`;
  if (rounded >= 10_000) return `${(rounded / 1_000).toFixed(1)}k`;
  return rounded.toLocaleString("en-US");
}

export default function ChatTokenUsageSummary({ usage, onLayoutChange, className, ...props }: ChatTokenUsageSummaryProps) {
  const [open, setOpen] = useState(false);
  const contextPercentText = useMemo(() => {
    const used = usage?.usedTokens;
    const contextWindow = usage?.contextWindow;
    if (used == null || contextWindow == null || contextWindow <= 0) return "--";
    return `${Math.max(0, Math.min(100, Math.round((used / contextWindow) * 100)))}%`;
  }, [usage?.contextWindow, usage?.usedTokens]);
  const detailItems = useMemo(
    () => [
      { label: translate("chat.tokenUsage.input"), value: formatCount(usage?.last?.inputTokens) },
      { label: translate("chat.tokenUsage.cachedInput"), value: formatCount(usage?.last?.cachedInputTokens) },
      { label: translate("chat.tokenUsage.output"), value: formatCount(usage?.last?.outputTokens) },
      { label: translate("chat.tokenUsage.reasoningOutput"), value: formatCount(usage?.last?.reasoningOutputTokens) },
      { label: translate("chat.tokenUsage.turnTotal"), value: formatCount(usage?.last?.totalTokens) },
      { label: translate("chat.tokenUsage.cumulativeTotal"), value: formatCount(usage?.total?.totalTokens) },
      { label: translate("chat.tokenUsage.contextWindow"), value: formatCount(usage?.contextWindow) },
    ],
    [usage]
  );

  return (
    <div {...props} className={["chat-row flex min-w-0 m-0 chat-row--activity", className].filter(Boolean).join(" ")}>
      <div className="chat-token-usage">
        <button
          className="chat-token-usage__summary"
          type="button"
          aria-expanded={open ? "true" : "false"}
          onClick={() => {
            setOpen((value) => !value);
            requestAnimationFrame(() => onLayoutChange?.());
          }}
        >
          <span className="chat-activity-dot h-1.5 w-1.5 flex-none rounded-full" aria-hidden="true" />
          <span className="chat-token-usage__label mono">{translate("chat.tokenUsage.title")}</span>
          <span className="chat-token-usage__metric mono">{formatCount(usage?.last?.totalTokens)} token</span>
          <span className="chat-token-usage__metric mono">
            {translate("chat.tokenUsage.cached", { count: formatCount(usage?.last?.cachedInputTokens) })}
          </span>
          <span className="chat-token-usage__metric mono">
            {translate("chat.tokenUsage.context", { percent: contextPercentText })}
          </span>
          <ChevronDown className={["chat-token-usage__chevron", open ? "is-open" : ""].filter(Boolean).join(" ")} aria-hidden="true" />
        </button>

        {open ? (
          <div className="chat-token-usage__details">
            {detailItems.map((item) => (
              <div key={item.label} className="chat-token-usage__detail">
                <span>{item.label}</span>
                <strong className="mono">{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
