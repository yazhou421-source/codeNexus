import type { HTMLAttributes } from "react";
import { useState } from "react";
import { ChevronDown, ExternalLink, Square, TerminalSquare } from "lucide-react";
import type { CommandSessionNode } from "../../features/timeline/renderModel/buildTimelineNodes";
import ExecutionWaveText from "../ui/ExecutionWaveText";

export type ChatCommandSessionCardProps = HTMLAttributes<HTMLDivElement> & {
  item?: CommandSessionNode;
  stopping?: boolean;
  allowStop?: boolean;
  onStop?: (item: CommandSessionNode) => void;
  onLayoutChange?: () => void;
};

function urlLabel(value: string) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

export default function ChatCommandSessionCard({
  item,
  stopping = false,
  allowStop = true,
  onStop,
  onLayoutChange,
  className,
  ...props
}: ChatCommandSessionCardProps) {
  const [open, setOpen] = useState(false);
  if (!item) return null;

  const isRunning = item.status === "running";
  const primaryUrl = item.urls[0] ?? "";
  const titleText = item.commandShort || item.commandFull || "后台命令";
  const logText = String(item.outputFull ?? "").trimEnd() || "暂无输出";
  const toggleOpen = () => {
    setOpen((value) => !value);
    requestAnimationFrame(() => onLayoutChange?.());
  };

  return (
    <div {...props} className={["chat-tool-wrap command-session-wrap w-full max-w-full min-w-0", className].filter(Boolean).join(" ")}>
      <article
        className={[
          "command-session",
          item.status === "running" ? "is-running" : "",
          item.status === "failed" ? "is-failed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-busy={isRunning ? "true" : "false"}
      >
        <div className="command-session__summary">
          <span className="command-session__icon" aria-hidden="true">
            <TerminalSquare className="command-session__svg" />
          </span>

          <button className="command-session__main" type="button" aria-expanded={open ? "true" : "false"} onClick={toggleOpen}>
            <span className="command-session__title-row">
              {isRunning ? (
                <ExecutionWaveText className="command-session__title" color="var(--accent)" text={titleText} cycleMaxChars={0} />
              ) : (
                <span className="command-session__title">{titleText}</span>
              )}
            </span>
          </button>

          {primaryUrl ? (
            <a
              className="command-session__url"
              href={primaryUrl}
              target="_blank"
              rel="noreferrer"
              title={primaryUrl}
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className="command-session__url-icon" aria-hidden="true" />
              <span>{urlLabel(primaryUrl)}</span>
            </a>
          ) : null}

          {allowStop && isRunning && item.processId ? (
            <button
              className="command-session__stop"
              type="button"
              disabled={stopping}
              title="停止进程"
              onClick={(event) => {
                event.stopPropagation();
                onStop?.(item);
              }}
            >
              <Square className="command-session__button-icon" aria-hidden="true" />
              <span>{stopping ? "停止中" : "停止"}</span>
            </button>
          ) : null}

          <button
            className="command-session__icon-button"
            type="button"
            aria-expanded={open ? "true" : "false"}
            title="展开日志"
            aria-label="展开日志"
            onClick={(event) => {
              event.stopPropagation();
              toggleOpen();
            }}
          >
            <ChevronDown className={["command-session__chevron", open ? "is-open" : ""].filter(Boolean).join(" ")} aria-hidden="true" />
          </button>
        </div>

        {open ? (
          <div className="command-session__details">
            <pre className="command-session__log app-scrollbar mono">{logText}</pre>
          </div>
        ) : null}
      </article>
    </div>
  );
}
