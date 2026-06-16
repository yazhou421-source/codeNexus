import type { ReactNode } from "react";

type ChatUserBubbleFrameProps = {
  text?: string;
  children?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export default function ChatUserBubbleFrame({ text, children, meta, className }: ChatUserBubbleFrameProps) {
  return (
    <div
      className={[
        "chat-bubble chat-bubble-user w-full max-w-full min-w-0 cursor-pointer rounded-[4px] border border-[color:var(--bubble-user-border)] bg-[var(--bubble-user-bg)] bg-clip-padding px-3 py-2.5 shadow-[var(--bubble-shadow)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="chat-bubble-inline flex min-w-0 items-center justify-between gap-2.5">
        <div className="chat-bubble-body flex-1 min-w-0 whitespace-pre-wrap break-words">{children ?? text}</div>
        <span className="chat-bubble-meta-right inline-flex flex-none min-w-0 items-center justify-end gap-2.5 whitespace-nowrap">
          {meta}
        </span>
      </div>
    </div>
  );
}
