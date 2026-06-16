import { Activity, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { translate } from "../../i18n/translate";
import type { ChatAuxActivityStatus, ChatAuxActivitySummaryItem, ChatAuxiliaryRow } from "../layout/types/chat.types";
import { CHAT_ROW_BASE_CLASS } from "../layout/chat/chatPresentation";

export type ChatAuxActivityGroupProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  id?: string;
  items?: ChatAuxiliaryRow[];
  summaryItems?: ChatAuxActivitySummaryItem[];
  summaryText?: string;
  status?: ChatAuxActivityStatus;
  defaultCollapsed?: boolean;
  startedAtMs?: number | null;
  answerStartedAtMs?: number | null;
  elapsedLive?: boolean;
  onLayoutChange?: () => void;
  children?: ReactNode | ((args: { item: ChatAuxiliaryRow }) => ReactNode);
};

function unsignedDeltaText(value: string): string {
  return String(value ?? "").replace(/^[+-]/, "");
}

function elapsedText(startedAtMs: number | null | undefined, answerStartedAtMs: number | null | undefined, elapsedLive: boolean, nowMs: number) {
  const startedAt = Number(startedAtMs);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return "";
  const completedAt = Number(answerStartedAtMs);
  const endAt = Number.isFinite(completedAt) && completedAt > 0 ? completedAt : elapsedLive ? nowMs : null;
  if (endAt == null) return "";
  const totalSeconds = Math.max(1, Math.round(Math.max(0, endAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export default function ChatAuxActivityGroup({
  id = "",
  items = [],
  summaryItems = [],
  status = "completed",
  defaultCollapsed = true,
  startedAtMs = null,
  answerStartedAtMs = null,
  elapsedLive = false,
  onLayoutChange,
  children,
  className,
  ...props
}: ChatAuxActivityGroupProps) {
  const activityRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(!defaultCollapsed);
  const [userTouched, setUserTouched] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [meteorSize, setMeteorSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    if (!elapsedLive || !startedAtMs) return undefined;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [elapsedLive, startedAtMs]);

  useEffect(() => {
    setUserTouched(false);
    setOpen(!defaultCollapsed);
    requestAnimationFrame(() => onLayoutChange?.());
  }, [defaultCollapsed, id, onLayoutChange]);

  useEffect(() => {
    if (!activityRef.current || typeof ResizeObserver === "undefined") return undefined;
    const sync = () => {
      const rect = activityRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMeteorSize({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(activityRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => onLayoutChange?.());
  }, [items.map((item) => item.id).join("\n"), onLayoutChange]);

  const meteorMotionStyle = useMemo(() => {
    const width = Math.max(1, meteorSize.width);
    const height = Math.max(1, meteorSize.height);
    const inset = 3;
    const right = Math.max(inset, width - inset);
    const bottom = Math.max(inset, height - inset);
    const radius = Math.min(8, Math.max(0, Math.floor((Math.min(width, height) - inset * 2) / 2)));
    const leftCurve = inset + radius;
    const rightCurve = Math.max(leftCurve, right - radius);
    const topCurve = inset + radius;
    const bottomCurve = Math.max(topCurve, bottom - radius);
    const path = [
      `M ${leftCurve} ${inset}`,
      `H ${rightCurve}`,
      `Q ${right} ${inset} ${right} ${topCurve}`,
      `V ${bottomCurve}`,
      `Q ${right} ${bottom} ${rightCurve} ${bottom}`,
      `H ${leftCurve}`,
      `Q ${inset} ${bottom} ${inset} ${bottomCurve}`,
      `V ${topCurve}`,
      `Q ${inset} ${inset} ${leftCurve} ${inset}`,
      "Z",
    ].join(" ");
    return { offsetPath: `path("${path}")` } as CSSProperties;
  }, [meteorSize.height, meteorSize.width]);

  const elapsed = elapsedText(startedAtMs, answerStartedAtMs, elapsedLive, nowMs);
  const statusText = elapsedLive && elapsed
    ? translate("chat.activity.runningElapsed", { elapsed })
    : elapsedLive
      ? translate("chat.activity.running")
      : elapsed
        ? open
          ? translate("chat.activity.expandedElapsed", { elapsed })
          : translate("chat.activity.collapsedElapsed", { elapsed })
        : open
          ? translate("chat.activity.expanded")
          : translate("chat.activity.collapsed");
  const activityClass = [status === "running" ? "is-running" : "", open ? "is-open" : ""].filter(Boolean).join(" ");

  const toggleOpen = () => {
    setUserTouched(true);
    setOpen((value) => !value);
    requestAnimationFrame(() => onLayoutChange?.());
  };

  useEffect(() => {
    if (!defaultCollapsed && !userTouched) setOpen(true);
  }, [defaultCollapsed, userTouched]);

  return (
    <div {...props} className={[CHAT_ROW_BASE_CLASS, "chat-row--aux-activity", className].filter(Boolean).join(" ")}>
      <section ref={activityRef} className={["chat-aux-activity", activityClass].filter(Boolean).join(" ")} aria-busy={status === "running"}>
        <span className="chat-aux-activity__meteor" style={meteorMotionStyle} aria-hidden="true" />
        <span className="chat-aux-activity__meteor chat-aux-activity__meteor--opposite" style={meteorMotionStyle} aria-hidden="true" />
        <button className="chat-aux-activity__summary" type="button" aria-expanded={open ? "true" : "false"} onClick={toggleOpen}>
          <span className="chat-aux-activity__icon" aria-hidden="true">
            <Activity className="h-3.5 w-3.5 [stroke-width:2.25]" />
          </span>
          <span className="chat-aux-activity__main min-w-0">
            <span className="chat-aux-activity__title">{translate("chat.activity.auxTitle")}</span>
            <span className="chat-aux-activity__counts">
              {summaryItems.map((item) => (
                <span key={item.key} className="chat-aux-activity__count">
                  <span className="chat-aux-activity__count-label">{item.label}</span>
                  <span className="chat-aux-activity__count-value">{item.valueText ?? item.count}</span>
                  {item.addText ? (
                    <span className="chat-aux-activity__count-delta chat-aux-activity__count-delta--add">
                      <span className="chat-aux-activity__count-delta-sign">+</span>
                      <span className="chat-aux-activity__count-delta-number">{unsignedDeltaText(item.addText)}</span>
                    </span>
                  ) : null}
                  {item.delText ? (
                    <span className="chat-aux-activity__count-delta chat-aux-activity__count-delta--del">
                      <span className="chat-aux-activity__count-delta-sign">-</span>
                      <span className="chat-aux-activity__count-delta-number">{unsignedDeltaText(item.delText)}</span>
                    </span>
                  ) : null}
                </span>
              ))}
            </span>
          </span>
          <span className="chat-aux-activity__state">{statusText}</span>
          <ChevronDown className={["chat-aux-activity__chevron h-3.5 w-3.5 [stroke-width:2.35]", open ? "rotate-180" : ""].filter(Boolean).join(" ")} aria-hidden="true" />
        </button>
        <div className={["chat-aux-activity__body-shell", open ? "is-open" : ""].filter(Boolean).join(" ")} aria-hidden={open ? "false" : "true"} onTransitionEnd={(event) => event.propertyName === "grid-template-rows" && onLayoutChange?.()}>
          <div className="chat-aux-activity__body-frame">
            <div className="chat-aux-activity__body app-scrollbar">
              <div className="chat-aux-activity__items">
                {items.map((item, index) => (
                  <div key={item?.id ?? index} className="chat-aux-activity__item" data-aux-kind={item.kind}>
                    {typeof children === "function" ? children({ item }) : children}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
