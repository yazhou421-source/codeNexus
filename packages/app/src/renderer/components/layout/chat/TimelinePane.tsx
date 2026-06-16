import type { HTMLAttributes, ReactNode } from "react";

export type TimelinePaneProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

export default function TimelinePane({ className, children, ...props }: TimelinePaneProps) {
  return (
    <div {...props} className={["center-pane timeline-pane timeline-pane--chat", className].filter(Boolean).join(" ")}>
      <div className="timeline app-scrollbar">{children}</div>
    </div>
  );
}
