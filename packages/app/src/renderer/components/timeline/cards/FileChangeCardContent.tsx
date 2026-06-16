import type { HTMLAttributes } from "react";
import UnifiedDiffViewer from "./UnifiedDiffViewer";

export default function FileChangeCardContent({
  item,
  mode = "timeline",
  wrapDiffLines = true,
  onLayoutChange: _onLayoutChange,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { item?: any; mode?: string; wrapDiffLines?: boolean; onLayoutChange?: () => void }) {
  const files = Array.isArray(item?.files) ? item.files : [];
  return (
    <div {...props} className={["file-change-card grid gap-2", className].filter(Boolean).join(" ")}>
      <div className="flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="font-semibold">
          {mode === "chat" ? "File changes" : "Workspace file changes"} · {item?.status ?? "unknown"}
        </span>
        <span className="mono dim">{files.length} file{files.length === 1 ? "" : "s"}</span>
      </div>
      {files.map((file: any, index: number) => (
        <section key={`${file?.pathAbs ?? file?.pathRel ?? index}`} className="grid gap-1.5">
          <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
            <span className="mono min-w-0 truncate">{file?.pathRelTo || file?.pathRel || file?.pathAbs || "file"}</span>
            <span className="mono dim">{file?.kind || "modify"}</span>
          </div>
          {file?.diffText ? (
            <UnifiedDiffViewer diffText={String(file.diffText)} wrapLines={wrapDiffLines} compact={mode === "chat"} />
          ) : (
            <div className="mono rounded border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-xs dim">
              No diff content
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
