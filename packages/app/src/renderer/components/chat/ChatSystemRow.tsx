import type { HTMLAttributes } from "react";

export type ChatSystemRowProps = HTMLAttributes<HTMLDivElement> & {
  text?: string;
};

export default function ChatSystemRow({ text = "", className, ...props }: ChatSystemRowProps) {
  return (
    <div {...props} className={["chat-row flex min-w-0 m-0 chat-row--system", className].filter(Boolean).join(" ")}>
      <div className="chat-system-line chat-system-line--error w-full px-3 py-2 text-xs">{text}</div>
    </div>
  );
}
