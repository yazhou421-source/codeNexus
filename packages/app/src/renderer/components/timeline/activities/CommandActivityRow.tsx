import { FileText, ListTree, Search } from "lucide-react";
import type { HTMLAttributes } from "react";
import type {
  CommandListNode,
  CommandReadNode,
  CommandSearchNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import { translate } from "../../../i18n/translate";
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
    readItem?.name || basename(readItem?.path ?? "") || readItem?.path || translate("commandActivity.readContent");
  const readPathText = readItem?.path || fileLabel;
  const listScopeText = listItem?.path || translate("commandActivity.currentDirectory");
  const searchScopeText = searchItem?.path || "";
  const queryText = searchItem?.query || translate("commandActivity.search");
  const text =
    kind === "read"
      ? translate("commandActivity.readFile", { target: readPathText })
      : kind === "list"
        ? translate("commandActivity.listFiles", { scope: listScopeText })
        : translate("commandActivity.searchInScope", {
            query: queryText,
            scope: searchScopeText ? translate("commandActivity.searchScope", { scope: searchScopeText }) : "",
          });
  const meta = kind === "list" ? translate("commandActivity.itemCount", { count: listItem?.filesCount ?? 0 }) : "";

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
