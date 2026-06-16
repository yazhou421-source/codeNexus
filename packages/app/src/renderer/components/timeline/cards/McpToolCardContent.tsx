import type { HTMLAttributes } from "react";
import { useState } from "react";
import { Terminal } from "lucide-react";
import type {
  McpToolCallItem,
  McpToolGroupNode,
} from "../../../features/timeline/renderModel/buildTimelineNodes";
import {
  mcpToolGroupClass,
  mcpToolGroupStatsText,
  mcpToolGroupSummaryText,
  mcpToolGroupTagText,
  mcpToolItemClass,
  mcpToolItemMetaText,
  mcpToolItemMetricsText,
  mcpToolItemTitle,
} from "../../../features/timeline/renderModel/formatters";
import { translate } from "../../../i18n/translate";
import DetailDisclosure from "../../ui/DetailDisclosure";
import ExecutionWaveText from "../../ui/ExecutionWaveText";

type McpToolCardContentProps = HTMLAttributes<HTMLDivElement> & {
  group?: McpToolGroupNode | any;
  items?: McpToolCallItem[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenRelatedResource?: (item: McpToolCallItem) => void;
  tagText?: string;
  summaryText?: string;
  statsText?: string;
};

function RawDetail({
  detailKey,
  label,
  value,
  isOpen,
  onToggle,
}: {
  detailKey: string;
  label: string;
  value: string;
  isOpen: (detailKey: string) => boolean;
  onToggle: (detailKey: string, next: boolean) => void;
}) {
  if (!value) return null;
  return (
    <DetailDisclosure
      open={isOpen(detailKey)}
      motion="fade"
      summaryClass="mono text-[11px] dim"
      summary={label}
      onOpenChange={(next) => onToggle(detailKey, next)}
    >
      <pre className="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words">
        {value}
      </pre>
    </DetailDisclosure>
  );
}

export default function McpToolCardContent({
  group,
  items,
  open = false,
  onOpenChange,
  onOpenRelatedResource,
  tagText,
  summaryText,
  statsText,
  className,
  ...props
}: McpToolCardContentProps) {
  const list = Array.isArray(items) ? items : Array.isArray(group?.items) ? group.items : [];
  const safeGroup: McpToolGroupNode = group ?? {
    id: "mcp-tool-group",
    createdAt: 0,
    secondBucket: 0,
    turnId: "",
    items: list,
    stats: {
      total: list.length,
      running: list.filter((item) => item.status === "running").length,
      completed: list.filter((item) => item.status === "completed").length,
      failed: list.filter((item) => item.status === "failed").length,
      unknown: list.filter((item) => item.status === "unknown").length,
    },
  };
  const [openDetailKeys, setOpenDetailKeys] = useState<Set<string>>(() => new Set());
  const isDetailOpen = (detailKey: string) => openDetailKeys.has(String(detailKey ?? ""));
  const onDetailToggle = (detailKey: string, next: boolean) => {
    const key = String(detailKey ?? "").trim();
    if (!key) return;
    setOpenDetailKeys((prev) => {
      const out = new Set(prev);
      if (next) out.add(key);
      else out.delete(key);
      return out;
    });
  };

  const resolvedTagText = tagText || mcpToolGroupTagText(safeGroup);
  const resolvedSummaryText = summaryText || mcpToolGroupSummaryText(safeGroup);
  const resolvedStatsText = statsText || mcpToolGroupStatsText(safeGroup);

  return (
    <div
      {...props}
      className={[
        "event timeline-card-shell group mb-2.5 min-w-0 max-w-full rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-timeline-card-bg)] p-[var(--timeline-card-padding,10px)] shadow-[var(--ui-timeline-card-shadow)] last:mb-0 simple-mcp-tool-event w-full",
        mcpToolGroupClass(safeGroup),
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
          <div className="timeline-card-shell-title-wrap min-w-0 inline-flex items-center gap-1.5">
            <Terminal className="h-[13px] w-[13px] flex-none text-[color:var(--accent)] [stroke-width:2.2]" aria-hidden="true" />
            <span className="inline-flex h-[22px] max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg-strong)] px-[9px] text-[11px] tracking-[0.2px] text-[var(--text-muted)]">
              {resolvedTagText}
            </span>
          </div>
        )}
      >
        <div className="grid gap-1.5 px-2.5 pb-2.5">
          <div className="mono dim">{resolvedSummaryText}</div>
          <div className="mono dim text-[11px]">{resolvedStatsText}</div>
          <ol className="m-0 grid gap-1.5 pl-4">
            {list.map((item) => (
              <li
                key={item.id}
                className={[
                  "grid gap-1 rounded-[4px] border border-[var(--ui-well-border)] bg-[var(--ui-well-bg)] px-2 py-1.5",
                  mcpToolItemClass(item),
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="mcp-tool-item-status inline-flex min-w-0 items-center gap-1.5 text-[11px]">
                    {item.status === "running" ? (
                      <ExecutionWaveText className="mono" color="var(--accent)" text={item.tool} cycleMaxChars={0} />
                    ) : (
                      <span className="mono">{item.tool}</span>
                    )}
                  </span>
                  <span className="mono dim flex-none whitespace-nowrap text-[10px]">{mcpToolItemMetricsText(item)}</span>
                </div>
                <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[10px]">
                  {mcpToolItemTitle(item)}
                </div>
                <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[10px]">
                  {mcpToolItemMetaText(item)}
                </div>
                <div className="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4] text-[var(--text)]">
                  {item.argumentsSummary}
                </div>
                {item.resultSummary ? (
                  <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4]">
                    {item.resultSummary}
                  </div>
                ) : null}
                {item.pageSummary ? (
                  <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4]">
                    {item.pageSummary}
                  </div>
                ) : null}
                {item.snapshotSummary ? (
                  <div className="mono dim whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4]">
                    {item.snapshotSummary}
                  </div>
                ) : null}
                {item.errorText ? (
                  <div className="mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-[11px] leading-[1.4] text-[var(--text)]">
                    {item.errorText}
                  </div>
                ) : null}
                {item.relatedResourceLabel && onOpenRelatedResource ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-mini" onClick={(event) => {
                      event.stopPropagation();
                      onOpenRelatedResource(item);
                    }}>
                      {item.relatedResourceLabel}
                    </button>
                  </div>
                ) : null}
                <RawDetail
                  detailKey={item.argumentsKey}
                  label={translate("dynamicTool.viewFullArgs")}
                  value={item.argumentsRaw}
                  isOpen={isDetailOpen}
                  onToggle={onDetailToggle}
                />
                <RawDetail
                  detailKey={item.resultKey}
                  label={translate("dynamicTool.viewFullResult")}
                  value={item.resultRaw}
                  isOpen={isDetailOpen}
                  onToggle={onDetailToggle}
                />
                <RawDetail
                  detailKey={item.structuredContentKey}
                  label={translate("mcpTool.viewStructuredContent")}
                  value={item.structuredContentRaw}
                  isOpen={isDetailOpen}
                  onToggle={onDetailToggle}
                />
                <RawDetail
                  detailKey={item.metaKey}
                  label={translate("mcpTool.viewMeta")}
                  value={item.metaRaw}
                  isOpen={isDetailOpen}
                  onToggle={onDetailToggle}
                />
                <RawDetail
                  detailKey={item.outputSchemaKey}
                  label={translate("mcpTool.viewOutputSchema")}
                  value={item.outputSchemaRaw}
                  isOpen={isDetailOpen}
                  onToggle={onDetailToggle}
                />
              </li>
            ))}
          </ol>
        </div>
      </DetailDisclosure>
    </div>
  );
}
