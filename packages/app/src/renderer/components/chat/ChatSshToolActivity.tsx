import type { HTMLAttributes } from "react";

export default function ChatSshToolActivity({ group, className, ...props }: HTMLAttributes<HTMLDivElement> & { group?: any }) {
  const items = Array.isArray(group?.items) ? group.items : [];
  return (
    <div {...props} className={["ssh-tool-activity rounded border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-3 text-xs", className].filter(Boolean).join(" ")}>
      <div className="mb-2 flex justify-between gap-3">
        <span className="font-semibold">SSH tools</span>
        <span className="mono dim">{items.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item: any, index: number) => (
          <div key={item?.id ?? index} className="mono truncate">
            {String(item?.title ?? item?.name ?? item?.method ?? "tool")}
          </div>
        ))}
      </div>
    </div>
  );
}
