import DetailDisclosure from "../ui/DetailDisclosure";
import {
  collectGuardianApprovalReviewDiagnosticItems,
  type GuardianApprovalReviewDiagnosticItem,
} from "../../features/guardian/guardianApprovalReview";
import { formatTime } from "../../features/timeline/renderModel/formatters";
import { useTimelineStore } from "../../stores/timeline.store";

type GuardianReviewDiagnosticsProps = {
  threadId?: string;
  focusTargetItemId?: string;
  maxItems?: number;
  title?: string;
  className?: string;
};

function guardianStatusClass(tone: GuardianApprovalReviewDiagnosticItem["tone"]) {
  if (tone === "running") return "border-[var(--border-accent)] bg-[var(--bg-accent-soft)] text-[var(--fg-accent)]";
  if (tone === "ok") return "border-[var(--border-success)] bg-[var(--bg-success-soft)] text-[var(--fg-success)]";
  if (tone === "warn") return "border-[var(--border-warning)] bg-[var(--bg-warning-soft)] text-[var(--fg-warning)]";
  if (tone === "error") return "border-[var(--border-danger)] bg-[var(--bg-danger-soft)] text-[var(--fg-danger)]";
  return "border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] text-[var(--text-muted)]";
}

export default function GuardianReviewDiagnostics({
  threadId,
  focusTargetItemId,
  maxItems = 5,
  title = "",
  className,
}: GuardianReviewDiagnosticsProps) {
  const timelineStore = useTimelineStore();
  const normalizedThreadId = String(threadId ?? "").trim() || "__app__";
  const titleText = String(title ?? "").trim() || "最近 Guardian 复核";
  const items = collectGuardianApprovalReviewDiagnosticItems(timelineStore.eventsForThread(normalizedThreadId), {
    focusTargetItemId,
    maxItems,
  });

  const guardianMetaText = (item: GuardianApprovalReviewDiagnosticItem) => {
    const parts: string[] = [];
    parts.push(formatTime(item.createdAt));
    if (item.riskText) parts.push(`风险 ${item.riskText}`);
    if (item.userAuthorizationText) parts.push(`授权 ${item.userAuthorizationText}`);
    if (item.decisionSourceText) parts.push(`来源 ${item.decisionSourceText}`);
    if (item.targetItemId) parts.push(`target ${item.targetItemId.slice(0, 12)}`);
    return parts.join(" ｜ ");
  };

  if (items.length === 0) return null;

  return (
    <section className={["guardian-review-diagnostics", "grid gap-2", className].filter(Boolean).join(" ")}>
      <div className="row" style={{ alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div className="user-input-header">{titleText}</div>
        <div className="mono dim text-[11px]">{items.length} 条</div>
      </div>

      {items.map((item) => (
        <DetailDisclosure
          key={item.reviewId}
          className="rounded-[6px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2 py-1.5"
          summaryClass="flex min-w-0 items-start gap-2"
          defaultOpen={item.matchesTarget}
          motion="fade"
          summary={
            <>
              <span
                className={[
                  "inline-flex h-[22px] flex-none items-center rounded-[4px] border px-[9px] text-[11px] mono",
                  guardianStatusClass(item.tone),
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {item.statusText}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-[color:var(--text)]">
                  {item.actionSummary || item.summaryText}
                </span>
                <span className="block truncate mono text-[11px] text-[color:var(--text-muted)]">
                  {guardianMetaText(item)}
                </span>
              </span>
              {item.matchesTarget ? (
                <span className="inline-flex h-[22px] flex-none items-center rounded-[4px] border border-[var(--border-accent)] bg-[var(--bg-accent-soft)] px-[8px] text-[10px] mono text-[var(--fg-accent)]">
                  当前项
                </span>
              ) : null}
            </>
          }
        >
          <div className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] break-words rounded-lg border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] p-2 text-[11px] leading-[1.45] text-[color:var(--text-muted)] mono">
            {item.detailText}
          </div>
        </DetailDisclosure>
      ))}
    </section>
  );
}
