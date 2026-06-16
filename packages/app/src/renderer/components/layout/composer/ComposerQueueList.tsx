import { Pencil, SendHorizontal, Trash2 } from "lucide-react";
import type { HTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import type { QueuedMessage } from "../../../stores/messageQueue.store";

export default function ComposerQueueList({
  items,
  queue,
  onEdit,
  onSendNow,
  "onSend-now": onSendNowKebab,
  onRemove,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  items?: QueuedMessage[];
  queue?: QueuedMessage[];
  onEdit?: (messageId: string) => void;
  onSendNow?: (messageId: string) => void;
  "onSend-now"?: (messageId: string) => void;
  onRemove?: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  const list = Array.isArray(items) ? items : Array.isArray(queue) ? queue : [];
  if (list.length === 0) return null;

  const firstItem = list[0];
  const failedCount = list.filter((msg) => msg.status === "failed").length;
  const restItems = list.slice(1);
  const previewText = (message: QueuedMessage) => {
    const displayText = String(message.displayText ?? "").trim();
    if (displayText) return displayText;
    const text = String(message.text ?? "").trim();
    if (text) return text;
    const inputs = Array.isArray(message.inputs) ? message.inputs : [];
    const imageCount = inputs.filter((item) => item?.type === "image" || item?.type === "localImage").length;
    if (imageCount > 0) return t("composer.imageCount", { count: imageCount });
    return t("composer.emptyMessage");
  };
  const sendNow = onSendNow ?? onSendNowKebab;
  const preview = firstItem ? previewText(firstItem) : "";

  return (
    <div
      {...props}
      className={[
        "composer-queue-tray",
        failedCount > 0 ? "has-failed" : "",
        restItems.length > 0 ? "has-stack" : "",
        restItems.length > 1 ? "has-deep-stack" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {firstItem ? (
        <div className="composer-queue-main" role="list">
          <div
            className={[
              "composer-queue-item composer-queue-item--primary",
              firstItem.status === "failed" ? "is-failed" : "",
              firstItem.status === "sending" ? "is-sending" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="listitem"
          >
            <span
              className={[
                "composer-queue-status-dot",
                firstItem.status === "failed" ? "is-failed" : "",
                firstItem.status === "sending" ? "is-sending" : "",
                firstItem.status === "queued" ? "is-queued" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-hidden="true"
            />

            <span className="composer-queue-copy">
              <span className="composer-queue-message font-medium">{preview}</span>
            </span>

            <div className="composer-queue-actions">
              <button
                className="composer-queue-action"
                type="button"
                disabled={firstItem.status === "sending"}
                aria-label={t("composer.editQueuedAria", { preview })}
                onClick={() => onEdit?.(firstItem.id)}
              >
                <Pencil className="composer-queue-action-icon" aria-hidden="true" />
              </button>
              <button
                className="composer-queue-action composer-queue-action--primary"
                type="button"
                disabled={firstItem.status === "sending"}
                aria-label={t("composer.sendQueuedAria", { preview })}
                onClick={() => sendNow?.(firstItem.id)}
              >
                <SendHorizontal className="composer-queue-action-icon" aria-hidden="true" />
              </button>
              <button
                className="composer-queue-action composer-queue-action--danger"
                type="button"
                disabled={firstItem.status === "sending"}
                aria-label={t("composer.deleteQueuedAria", { preview })}
                onClick={() => onRemove?.(firstItem.id)}
              >
                <Trash2 className="composer-queue-action-icon" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
