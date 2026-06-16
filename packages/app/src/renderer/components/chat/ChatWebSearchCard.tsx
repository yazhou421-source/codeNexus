import type { HTMLAttributes } from "react";
import { CircleDashed, FileSearch, Globe, Search } from "lucide-react";
import type { ChatWebSearchItem } from "../layout/types/chat.types";
import ExecutionWaveText from "../ui/ExecutionWaveText";

export type ChatWebSearchCardProps = HTMLAttributes<HTMLDivElement> & {
  item?: ChatWebSearchItem;
};

export default function ChatWebSearchCard({ item, className, ...props }: ChatWebSearchCardProps) {
  const running = item?.status === "running";
  const target = item?.primaryText || item?.summaryText || item?.title || "网页操作";
  const activityText = (() => {
    if (running) {
      if (item?.actionType === "openPage") return `正在打开 ${target}`;
      if (item?.actionType === "findInPage") return `正在页内查找 ${target}`;
      if (item?.actionType === "other") return `正在处理 ${target}`;
      return `正在搜索 ${target}`;
    }
    if (item?.actionType === "openPage") return `已打开 ${target}`;
    if (item?.actionType === "findInPage") return `已查找 ${target}`;
    if (item?.actionType === "other") return `已处理 ${target}`;
    return `已搜索 ${target}`;
  })();
  const Icon = item?.actionType === "openPage" ? Globe : item?.actionType === "findInPage" ? FileSearch : item?.actionType === "other" ? CircleDashed : Search;

  return (
    <div {...props} className={["chat-tool-wrap w-full max-w-full min-w-0", className].filter(Boolean).join(" ")}>
      <article
        className={[
          "chat-inline-activity web-search-activity",
          running ? "is-running" : "",
          item?.actionType === "search" ? "is-search" : "",
          item?.actionType === "openPage" ? "is-open-page" : "",
          item?.actionType === "findInPage" ? "is-find-in-page" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-busy={running}
        tabIndex={0}
      >
        <div className="chat-inline-activity__line web-search-line">
          <span className="chat-inline-activity__icon web-search-icon-wrap" aria-hidden="true">
            <Icon className="chat-inline-activity__svg web-search-icon" />
          </span>
          <ExecutionWaveText
            className="chat-inline-activity__text web-search-wave"
            text={activityText}
            enabled={running}
            color="var(--web-search-wave-color)"
            charDelaySec={0.045}
            charAnimDurationSec={0.78}
            pauseSec={0.5}
            cycleMaxChars={0}
            minOpacity={running ? 0.34 : 0.72}
            maxOpacity={1}
          />
        </div>
      </article>
    </div>
  );
}
