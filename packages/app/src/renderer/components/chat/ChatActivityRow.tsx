import type { HTMLAttributes } from "react";

export type ChatActivityRowProps = HTMLAttributes<HTMLDivElement> & {
  text?: string;
  activityDotClass?: string;
};

export default function ChatActivityRow({ text = "", activityDotClass = "", className, ...props }: ChatActivityRowProps) {
  return (
    <div {...props} className={["chat-row flex min-w-0 m-0 chat-row--activity", className].filter(Boolean).join(" ")}>
      <div className="chat-activity-line inline-flex w-full max-w-full items-center gap-2.5 px-2.5 py-0.5 text-xs dim">
        <span
          className={["chat-activity-dot h-1.5 w-1.5 flex-none rounded-full", activityDotClass].filter(Boolean).join(" ")}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{text}</span>
      </div>
    </div>
  );
}
