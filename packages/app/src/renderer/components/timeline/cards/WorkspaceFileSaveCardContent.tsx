import { CheckCircle2, XCircle } from "lucide-react";
import type { HTMLAttributes } from "react";

export default function WorkspaceFileSaveCardContent({ item, className, ...props }: HTMLAttributes<HTMLDivElement> & { item?: any }) {
  const ok = item?.status === "success" || item?.status === "completed";
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div {...props} className={["workspace-file-save-card rounded border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-3 text-xs", className].filter(Boolean).join(" ")}>
      <div className="flex items-center gap-2">
        <Icon size={15} className={ok ? "text-[var(--success)]" : "text-[var(--danger)]"} />
        <span className="mono min-w-0 truncate">{item?.path || "Workspace file"}</span>
        <span className="mono dim ml-auto">{item?.chars != null ? `${item.chars} chars` : item?.status}</span>
      </div>
      {item?.errorText ? <div className="mt-2 text-[var(--fg-danger)] whitespace-pre-wrap">{item.errorText}</div> : null}
    </div>
  );
}
