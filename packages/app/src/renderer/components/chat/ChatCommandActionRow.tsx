import type { HTMLAttributes } from "react";
import { ChevronDown, TerminalSquare } from "lucide-react";
import type { CommandActionNode } from "../../features/timeline/renderModel/buildTimelineNodes";
import {
  commandGroupItemActionDetailText,
  commandGroupItemActionText,
} from "../../features/timeline/renderModel/formatters";
import ExecutionWaveText from "../ui/ExecutionWaveText";

export type ChatCommandActionRowProps = HTMLAttributes<HTMLDivElement> & {
  item?: CommandActionNode | any;
  isFilesOpen?: boolean;
  renderLimit?: number;
  onToggleFiles?: () => void;
};

export default function ChatCommandActionRow({ item, isFilesOpen, renderLimit = 1000, onToggleFiles, className, ...props }: ChatCommandActionRowProps) {
  const commandItem = item?.item ?? item;
  const files = Array.isArray(commandItem?.files) ? commandItem.files : [];
  const filesCount = Number(commandItem?.filesCount ?? files.length);
  const isRunning = commandItem?.status === "running";
  const main = commandGroupItemActionText(commandItem);
  const detail = commandGroupItemActionDetailText(commandItem);
  const actionText = detail ? `${main} · ${detail}` : main;
  const visibleFiles = files.slice(0, renderLimit);
  return (
    <div
      {...props}
      className={[
        "chat-inline-activity chat-terminal-action-wrap w-full max-w-full min-w-0",
        isRunning ? "is-running" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "chat-inline-activity__line chat-inline-activity__line--compact chat-inline-activity__line--full chat-terminal-action-line inline-flex w-full max-w-full min-w-0 items-center gap-1.5 p-0 m-0 box-border border-0 bg-transparent text-xs",
          isRunning ? "is-running" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="chat-inline-activity__icon ui-leading-icon-slot" aria-hidden="true">
          <TerminalSquare className="chat-inline-activity__svg chat-terminal-action-icon h-[14px] w-[14px] flex-none [stroke-width:2.4]" />
        </span>
        {isRunning ? (
          <ExecutionWaveText
            className="chat-inline-activity__text chat-terminal-action-text"
            color="var(--accent)"
            text={actionText}
            cycleMaxChars={0}
          />
        ) : (
          <span className="chat-inline-activity__text chat-terminal-action-text">{actionText}</span>
        )}
        {filesCount > 0 ? (
          <button
            className="chat-terminal-action-toggle !ml-auto !inline-flex !h-[22px] !w-[22px] !items-center !justify-center !rounded-[4px] !border !border-[var(--ui-well-border)] !bg-[var(--ui-well-bg)] !p-0 !text-inherit !shadow-none opacity-80 transition-[opacity,border-color,background] duration-150 hover:opacity-100 hover:!border-[var(--ui-well-border-hover)] hover:!bg-[var(--ui-well-bg-strong)] focus-visible:!outline-none focus-visible:!ring-2 focus-visible:!ring-[var(--ui-well-focus-outline)] active:!translate-y-0"
            type="button"
            aria-expanded={isFilesOpen ? "true" : "false"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFiles?.();
            }}
          >
            <ChevronDown
              className={[
                "chat-terminal-action-toggle-icon h-[14px] w-[14px] opacity-80 transition-[transform,opacity] duration-150",
                isFilesOpen ? "rotate-180" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>
      {filesCount > 0 && isFilesOpen ? (
        <div className="chat-terminal-action-files mx-2.5 rounded-xl border border-[var(--ui-well-border)] bg-[var(--ui-well-bg-strong)] px-2.5 py-2">
          <div className="chat-terminal-action-files-title mb-1.5 text-xs mono dim">
            {`文件（${filesCount}）`}
          </div>
          <div className="chat-terminal-action-files-list app-scrollbar grid max-h-[180px] gap-0.5 overflow-y-auto text-xs text-[var(--text)] mono">
            {visibleFiles.map((file: any, index: number) => (
              <div key={`${item?.id ?? "command"}:file:${String(file?.path ?? file ?? index)}`} className="chat-terminal-action-files-row truncate whitespace-nowrap">
                {String(file?.path ?? file)}
              </div>
            ))}
            {filesCount > renderLimit ? (
              <div className="chat-terminal-action-files-more mt-1.5 dim">
                {`还有 ${filesCount - renderLimit} 项未展示`}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
