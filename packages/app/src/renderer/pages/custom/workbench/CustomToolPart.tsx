import { ChevronDown, X } from "lucide-react";
import type { CustomChatPart, CustomChatToolPart } from "../../../stores/customChat.store";
import AgentMarkdownContent from "../../../components/ui/AgentMarkdownContent";
import {
  toolArgsPreview,
  toolArgsSummary,
  toolCategory,
  toolHasPreview,
  toolIcon,
  toolStatusLabel,
} from "./helpers";

// 渲染助手消息里的文本分片（Markdown）。
export function renderTextPart(part: CustomChatPart) {
  if (part.type !== "text") return null;
  return (
    <AgentMarkdownContent
      key={part.id}
      className="cw-msg__body cw-msg__body--md agent-markdown-body"
      markdown={part.text}
    />
  );
}

// 渲染单个工具活动行（可展开查看参数 / 结果 / 错误）。
export default function CustomToolPart({
  part,
  open,
  onToggle,
}: {
  part: CustomChatToolPart;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = toolIcon(part.tool.name);
  const hasArgsPreview = toolHasPreview(part.tool.argsText);
  const hasDetail = hasArgsPreview || Boolean(part.tool.resultText || part.tool.error);
  const category = toolCategory(part.tool.name);
  const summary = toolArgsSummary(part.tool.argsText);
  const rowContent = (
    <>
      <Icon className="cw-tool__cat-icon" aria-hidden={true} />
      <span className="cw-tool__name mono">{part.tool.name}</span>
      {summary ? <span className="cw-tool__sep">·</span> : null}
      <span className="cw-tool__args mono">{summary}</span>
      <span className={`cw-tool__state cw-tool__state--${part.tool.status}`} title={toolStatusLabel(part.tool.status)}>
        {part.tool.status === "running" ? (
          <span className="cw-tool__spinner" role="img" aria-label={toolStatusLabel(part.tool.status)} />
        ) : part.tool.status === "done" ? (
          <span className="cw-tool__check" role="img" aria-label="完成" />
        ) : (
          <X className="cw-tool__err-icon" role="img" aria-label="失败" />
        )}
      </span>
      {hasDetail ? <ChevronDown className={`cw-tool__chevron${open ? " is-open" : ""}`} aria-hidden="true" /> : null}
    </>
  );

  return (
    <div className={`cw-tool cw-tool--${part.tool.status} cw-tool--cat-${category}${open ? " is-open" : ""}`}>
      {hasDetail ? (
        <button className="cw-tool__row is-clickable" type="button" aria-expanded={open ? "true" : "false"} onClick={onToggle}>
          {rowContent}
        </button>
      ) : (
        <div className="cw-tool__row">{rowContent}</div>
      )}
      {hasDetail && open ? (
        <div className="cw-tool__detail-panel">
          {hasArgsPreview ? (
            <>
              <div className="cw-tool__detail-label">参数</div>
              <pre className="cw-tool__detail-body mono">{toolArgsPreview(part.tool.argsText)}</pre>
            </>
          ) : null}
          {part.tool.resultText || part.tool.error ? (
            <>
              <div className={`cw-tool__detail-label${part.tool.error ? " is-error" : ""}`}>
                {part.tool.error ? "错误" : "结果"}
              </div>
              <pre className={`cw-tool__detail-body mono${part.tool.error ? " is-error" : ""}`}>
                {part.tool.error || part.tool.resultText}
              </pre>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
