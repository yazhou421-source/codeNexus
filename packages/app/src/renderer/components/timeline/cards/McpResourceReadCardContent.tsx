import type { HTMLAttributes } from "react";
import { Database } from "lucide-react";
import type { McpResourceReadNode } from "../../../features/timeline/renderModel/buildTimelineNodes";
import DetailDisclosure from "../../ui/DetailDisclosure";
import ExecutionWaveText from "../../ui/ExecutionWaveText";

type McpResourceReadCardContentProps = HTMLAttributes<HTMLDivElement> & {
  item?: McpResourceReadNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenInPanel?: (item: McpResourceReadNode) => void;
};

function displayResourceLabel(item?: McpResourceReadNode) {
  return String(item?.resourceLabel || item?.uri || "未命名资源");
}

export default function McpResourceReadCardContent({
  item,
  open = false,
  onOpenChange,
  onOpenInPanel,
  className,
  ...props
}: McpResourceReadCardContentProps) {
  const toolNames = Array.isArray(item?.toolNames) ? item.toolNames : [];
  const parameterEntries = Array.isArray(item?.parameterEntries) ? item.parameterEntries : [];
  const resourceLabel = displayResourceLabel(item);
  const isRunning = item?.status === "running";

  return (
    <div
      {...props}
      className={[
        "event timeline-card-shell group mb-2.5 min-w-0 max-w-full rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-timeline-card-bg)] p-[var(--timeline-card-padding,10px)] shadow-[var(--ui-timeline-card-shadow)] last:mb-0 w-full",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <DetailDisclosure
        open={open}
        keepMounted
        motion="fade"
        onOpenChange={(next) => onOpenChange?.(next)}
        summaryClass="timeline-card-shell-summary min-w-0 cursor-pointer select-none"
        summary={() => (
          <div className="min-w-0">
            <div className="timeline-card-shell-title-wrap min-w-0 inline-flex items-center gap-1.5">
              <Database className="h-[13px] w-[13px] flex-none text-[color:var(--accent)] [stroke-width:2.2]" aria-hidden="true" />
              <span className="inline-flex h-[22px] max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg-strong)] px-[9px] text-[11px] tracking-[0.2px] text-[var(--text-muted)]">
                MCP 资源
              </span>
            </div>
            <div className="timeline-card-shell-summaryline min-w-0">
              <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px]">
                {resourceLabel}
              </div>
            </div>
          </div>
        )}
      >
        <div className="grid gap-2 px-2.5 pb-2.5">
          {isRunning ? (
            <ExecutionWaveText
              className="mono inline-flex items-center gap-2 text-[11px]"
              text="读取资源"
            />
          ) : null}

          <div className="grid gap-1">
            <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
              资源名
            </div>
            <div className="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] text-[var(--text)]">
              {resourceLabel}
            </div>
          </div>

          <div className="grid gap-1">
            <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
              工具
            </div>
            {toolNames.length === 0 ? (
              <div className="mono dim text-[11px]">无工具</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {toolNames.map((toolName) => (
                  <span
                    key={toolName}
                    className="inline-flex items-center rounded-[6px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2 py-1 mono text-[11px] text-[var(--text)]"
                  >
                    {toolName}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-1">
            <div className="text-[12px] font-medium text-[color:var(--text-muted)]">
              配置参数
            </div>
            {parameterEntries.length === 0 ? (
              <div className="mono dim text-[11px]">无配置参数</div>
            ) : (
              <div className="grid gap-1">
                {parameterEntries.map((entry) => (
                  <div
                    key={`${entry.key}:${entry.value}`}
                    className="rounded-[6px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2.5 py-2"
                  >
                    <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px]">
                      {entry.key}
                    </div>
                    <div className="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] text-[var(--text)]">
                      {entry.value || "未填写"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {item?.errorText ? (
            <div className="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4] text-[var(--text)]">
              {item.errorText}
            </div>
          ) : null}

          {item && onOpenInPanel ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-mini"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenInPanel(item);
                }}
              >
                在 MCP 页打开
              </button>
            </div>
          ) : null}
        </div>
      </DetailDisclosure>
    </div>
  );
}
