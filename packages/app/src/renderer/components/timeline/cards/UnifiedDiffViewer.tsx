import type { HTMLAttributes } from "react";

export type UnifiedDiffViewerProps = HTMLAttributes<HTMLDivElement> & {
  diffText?: string;
  ariaLabel?: string;
  maxHeightClass?: string;
  showTruncatedHint?: boolean;
  compact?: boolean;
  wrapLines?: boolean;
};

function lineKind(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) return "meta";
  return "ctx";
}

export default function UnifiedDiffViewer({
  diffText = "",
  ariaLabel = "diff-view",
  maxHeightClass = "max-h-[340px]",
  showTruncatedHint = true,
  compact = false,
  wrapLines = true,
  className,
  ...props
}: UnifiedDiffViewerProps) {
  const lines = String(diffText ?? "").split(/\r?\n/);
  const truncated = diffText.length > 60_000;
  return (
    <div {...props} className={className}>
      {truncated && showTruncatedHint ? <div className="mono dim mb-1.5 text-[11px]">Diff truncated for display</div> : null}
      <div
        className={[
          "unified-diff-scroll app-scrollbar overflow-auto rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] text-[var(--ui-code-text)]",
          maxHeightClass,
          compact ? "text-[10.5px]" : "text-[11px]",
        ]
          .filter(Boolean)
          .join(" ")}
        role="table"
        aria-label={ariaLabel}
      >
        {lines.map((line, index) => {
          const kind = lineKind(line);
          if (kind === "hunk") return <div key={index} className="mono px-2 py-1 text-[var(--accent)]">{line}</div>;
          const content = kind === "add" || kind === "del" || line.startsWith(" ") ? line.slice(1) : line;
          const sign = kind === "add" ? "+" : kind === "del" ? "-" : "";
          return (
            <div
              key={index}
              className={[
                "grid grid-cols-[30px_minmax(0,1fr)] gap-1.5 py-[1px]",
                kind === "add" ? "bg-[var(--bg-success-soft)] text-[var(--fg-success)]" : "",
                kind === "del" ? "bg-[var(--bg-danger-soft)] text-[var(--fg-danger)]" : "",
                kind === "meta" ? "text-[var(--ui-code-text-muted)]" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="mono select-none text-center opacity-80">{sign}</span>
              <span className={["mono min-w-0", wrapLines ? "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" : "whitespace-pre"].join(" ")}>
                {content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
