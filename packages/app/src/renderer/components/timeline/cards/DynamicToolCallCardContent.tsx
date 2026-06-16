import type { HTMLAttributes } from "react";
import { translate } from "../../../i18n/translate";
import DetailDisclosure from "../../ui/DetailDisclosure";
import ExecutionWaveText from "../../ui/ExecutionWaveText";

export default function DynamicToolCallCardContent({ item, className, ...props }: HTMLAttributes<HTMLDivElement> & { item?: any }) {
  const contentItems = Array.isArray(item?.contentItems) ? item.contentItems : [];
  const imageItems = contentItems.filter((entry: any) => entry?.type === "inputImage");
  const textItems = contentItems.filter((entry: any) => entry?.type === "inputText").map((entry: any) => String(entry.text ?? ""));
  const label = String(item?.label ?? "");
  const durationText =
    item?.durationMs == null ? "" : item.durationMs >= 1000 ? `${(item.durationMs / 1000).toFixed(item.durationMs >= 10_000 ? 0 : 1)}s` : `${Math.max(0, Math.round(item.durationMs))}ms`;
  const resultRawText = [...textItems, ...imageItems.map((entry: any, index: number) => `image[${index + 1}]: ${entry.imageUrl}`)]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div {...props} className={["grid gap-2", className].filter(Boolean).join(" ")}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {item?.status === "running" ? (
          <ExecutionWaveText className="text-[13px] font-semibold" color="var(--accent)" text={label} cycleMaxChars={0} />
        ) : (
          <span className="text-[13px] font-semibold text-[var(--text)]">{label}</span>
        )}
        {item?.approvalRequired ? (
          <span className="inline-flex h-[22px] items-center rounded-[4px] border border-[var(--border-warning)] bg-[var(--bg-warning-soft)] px-[9px] text-[11px] mono text-[var(--fg-warning)]">
            {translate("dynamicTool.approvalRequired")}
          </span>
        ) : null}
        {durationText ? <span className="mono text-[11px] dim">{durationText}</span> : null}
      </div>
      {item?.argsSummary ? <div className="mono dim whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[11px]">{item.argsSummary}</div> : null}
      {item?.resultSummary ? (
        <div className="mono whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[11px] text-[var(--text)]">{item.resultSummary}</div>
      ) : null}
      {item?.errorText ? (
        <div className="mono whitespace-pre-wrap [overflow-wrap:anywhere] break-words text-[11px] text-[var(--text)]">{item.errorText}</div>
      ) : null}
      {imageItems.length > 0 ? (
        <div className="grid gap-2">
          {imageItems.map((image: any, index: number) => (
            <img
              key={`${item?.callId ?? "tool"}:image:${index}`}
              src={image.imageUrl}
              className="max-h-[240px] rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] object-contain"
              alt="dynamic-tool-image"
            />
          ))}
        </div>
      ) : null}
      {item?.argsRaw ? (
        <DetailDisclosure summary={translate("dynamicTool.viewFullArgs")} summaryClass="mono text-[11px] dim" motion="fade">
          <pre className="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words">
            {String(item.argsRaw)}
          </pre>
        </DetailDisclosure>
      ) : null}
      {resultRawText ? (
        <DetailDisclosure summary={translate("dynamicTool.viewFullResult")} summaryClass="mono text-[11px] dim" motion="fade">
          <pre className="mono mt-1.5 max-h-[240px] overflow-y-auto app-scrollbar rounded-[4px] border border-[var(--ui-code-border)] bg-[var(--ui-code-bg)] p-2 text-[var(--ui-code-text)] whitespace-pre-wrap [overflow-wrap:anywhere] break-words">
            {resultRawText}
          </pre>
        </DetailDisclosure>
      ) : null}
    </div>
  );
}
