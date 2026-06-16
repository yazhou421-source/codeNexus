import type { HTMLAttributes } from "react";
import UnifiedDiffViewer from "./UnifiedDiffViewer";

export default function TurnDiffSummaryCard({ diffText, item, className, ...props }: HTMLAttributes<HTMLDivElement> & { diffText?: string; item?: any }) {
  const diff = String(diffText ?? item?.diffText ?? "");
  return (
    <div {...props} className={["turn-diff-summary-card grid gap-2", className].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold">Turn diff</span>
        <span className="mono dim">{diff ? `${diff.split(/\r?\n/).length} lines` : "empty"}</span>
      </div>
      {diff ? <UnifiedDiffViewer diffText={diff} /> : null}
    </div>
  );
}
