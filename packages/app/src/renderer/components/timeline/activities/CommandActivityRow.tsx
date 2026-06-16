import { FileText, ListTree, Search } from "lucide-react";
import type { HTMLAttributes } from "react";
import type {
  CommandListNode,
  CommandReadNode,
  CommandSearchNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import ExecutionWaveText from "../../ui/ExecutionWaveText";

type CommandActivityKind = "read" | "list" | "search";
type CommandActivityItem = CommandReadNode | CommandListNode | CommandSearchNode;

function basename(value: string) {
  return (
    String(value ?? "")
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? ""
  );
}

export default function CommandActivityRow({
  kind = "read",
  item,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { kind?: CommandActivityKind; item?: CommandActivityItem }) {
  const isRunning = item?.status === "running";
  const Icon = kind === "read" ? FileText : kind === "list" ? ListTree : Search;
  const readItem = item as CommandReadNode | undefined;
  const listItem = item as CommandListNode | undefined;
  const searchItem = item as CommandSearchNode | undefined;
  const fileLabel =
    readItem?.name || basename(readItem?.path ?? "") || readItem?.path || "读取内容";
  const readPathText = readItem?.path || fileLabel;
  const listScopeText = listItem?.path || "当前目录";
  const searchScopeText = searchItem?.path || "";
  const queryText = searchItem?.query || "搜索";
  const text =
    kind === "read"
      ? `读取文件：${readPathText}`
      : kind === "list"
        ? `列出文件：${listScopeText}`
        : `搜索："${queryText}"${searchScopeText ? `（${searchScopeText}）` : ""}`;
  const meta = kind === "list" ? `${listItem?.filesCount ?? 0} 项` : "";

  return (
    <div {...props} className={["chat-tool-wrap command-activity-wrap w-full max-w-full min-w-0", className].filter(Boolean).join(" ")}>
      <article
        className={[
          "chat-inline-activity command-activity",
          isRunning ? "is-running" : "",
          item?.status === "completed" ? "is-completed" : "",
          `is-${kind}`,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-busy={isRunning}
        tabIndex={0}
      >
        <div className="chat-inline-activity__line chat-inline-activity__line--compact command-activity-line">
          <span className="chat-inline-activity__icon command-activity-icon-wrap" aria-hidden="true">
            <Icon className="chat-inline-activity__svg command-activity-icon" aria-hidden="true" />
          </span>
          {isRunning ? (
            <ExecutionWaveText className="chat-inline-activity__text command-activity-text" color="var(--accent)" text={text} cycleMaxChars={0} />
          ) : (
            <span className="chat-inline-activity__text command-activity-text">{text}</span>
          )}
          {meta ? <span className="chat-inline-activity__meta command-activity-meta mono">{meta}</span> : null}
        </div>
      </article>
    </div>
  );
}
