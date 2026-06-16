import type { HTMLAttributes, ReactNode } from "react";

export default function TimelineCardShell({
  title,
  subtitle,
  status,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { title?: string; subtitle?: string; status?: string; children?: ReactNode }) {
  return (
    <article {...props} className={["event rounded border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-3", className].filter(Boolean).join(" ")}>
      {(title || subtitle || status) ? (
        <header className="mb-2 flex items-center justify-between gap-3 text-xs">
          <div className="min-w-0">
            {title ? <div className="font-semibold truncate">{title}</div> : null}
            {subtitle ? <div className="mono dim truncate">{subtitle}</div> : null}
          </div>
          {status ? <span className="mono dim">{status}</span> : null}
        </header>
      ) : null}
      {children}
    </article>
  );
}
