import type { CustomChatMessage } from "../../../stores/customChat.store";
import ExecutionWaveText from "../../../components/ui/ExecutionWaveText";
import CustomToolPart, { renderTextPart } from "./CustomToolPart";

// 单条对话消息：角色标签 + 可选思考过程 + 文本/工具分片或纯文本正文。
export default function CustomMessage({
  message,
  openTools,
  onToggleTool,
}: {
  message: CustomChatMessage;
  openTools: Record<string, boolean>;
  onToggleTool: (key: string, defaultOpen: boolean) => void;
}) {
  const roleLabel = message.role === "user" ? "你" : message.error ? "错误" : "助手";
  const hasParts = message.role === "assistant" && !message.error && message.parts && message.parts.length > 0;
  return (
    <div className={`cw-msg cw-msg--${message.role}${message.error ? " is-error" : ""}`}>
      <div className="cw-msg__role">{roleLabel}</div>
      {message.role === "assistant" && message.reasoning ? (
        <details className="cw-think">
          <summary>
            思考过程
            {message.streaming ? <ExecutionWaveText text="(生成中)" enabled className="cw-think__status" /> : null}
          </summary>
          <pre className="cw-think__body mono">{message.reasoning}</pre>
        </details>
      ) : null}
      {hasParts ? (
        <div className="cw-msg__parts">
          {message.parts!.map((part) => {
            if (part.type === "text") return renderTextPart(part);
            const key = part.tool.callId || `${message.id}:${part.id}`;
            const defaultOpen = part.tool.status === "running";
            return (
              <CustomToolPart
                key={part.id}
                part={part}
                open={openTools[key] ?? defaultOpen}
                onToggle={() => onToggleTool(key, defaultOpen)}
              />
            );
          })}
        </div>
      ) : (
        <div className={`cw-msg__body${message.streaming && !message.content ? " cw-msg__body--pending" : ""}`}>
          {message.streaming && !message.content ? <ExecutionWaveText text="思考中" enabled /> : message.content}
        </div>
      )}
    </div>
  );
}
