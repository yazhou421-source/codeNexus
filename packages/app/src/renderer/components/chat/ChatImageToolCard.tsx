import type { HTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Eye, Image as ImageIcon, Loader2 } from "lucide-react";
import type { ChatImageEntry, ChatImageToolItem, ImagePreviewPayload, ThumbLoadErrorPayload } from "../layout/types/chat.types";
import LazyImageThumb from "../ui/LazyImageThumb";
import { translate } from "../../i18n/translate";

export type ChatImageToolCardProps = HTMLAttributes<HTMLDivElement> & {
  item?: ChatImageToolItem;
  visibleImages?: ChatImageEntry[];
  workspaceRoot?: string;
  showTimestamps?: boolean;
  formattedTime?: string;
  onLoadError?: (payload: ThumbLoadErrorPayload) => void;
  onPreview?: (payload: ImagePreviewPayload) => void;
};

function statusText(item?: ChatImageToolItem) {
  if (item?.status === "running") {
    return item.itemType === "imageView" ? translate("chat.imageTool.reading") : translate("chat.imageTool.generating");
  }
  if (item?.status === "completed") {
    return item.itemType === "imageView" ? translate("chat.imageTool.read") : translate("chat.imageTool.generated");
  }
  if (item?.status === "failed") {
    return item.itemType === "imageView" ? translate("chat.imageTool.readFailed") : translate("chat.imageTool.generationFailed");
  }
  return translate("chat.imageTool.unknown");
}

function subtitleText(item: ChatImageToolItem | undefined, imageCount: number) {
  if (item?.itemType === "imageView") {
    return imageCount > 0 ? translate("chat.imageTool.viewResult") : translate("chat.imageTool.viewRequest");
  }
  if (item?.status === "running") return translate("chat.imageTool.waitingGeneration");
  if (item?.status === "failed") return translate("chat.imageTool.generationFailedSubtitle");
  if (imageCount > 0) return translate("chat.imageTool.generationResults", { count: imageCount });
  return translate("chat.imageTool.noPreview");
}

function emptyText(item?: ChatImageToolItem) {
  if (item?.status === "failed") return translate("chat.imageTool.noDisplayable");
  if (item?.itemType === "imageView") return translate("chat.imageTool.waitingPath");
  return translate("chat.imageTool.notArrived");
}

function revisedPromptBody(item?: ChatImageToolItem) {
  const prompt = String(item?.revisedPrompt ?? "").trim();
  if (!prompt) return "";
  return prompt
    .replace(new RegExp(`^${translate("chat.imageTool.revisedPromptPrefix")}\\s*`, "iu"), "")
    .replace(/^Revised prompt:\s*/iu, "")
    .trim();
}

function skeletonCount(item?: ChatImageToolItem) {
  if (item?.itemType === "imageView") return 1;
  const count = Math.round(Number(item?.pendingImageCount ?? 1));
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(4, count));
}

export default function ChatImageToolCard({
  item,
  visibleImages,
  workspaceRoot = "",
  showTimestamps = false,
  formattedTime = "",
  onLoadError,
  onPreview,
  className,
  ...props
}: ChatImageToolCardProps) {
  const images = visibleImages ?? item?.images ?? [];
  const titleText = item?.itemType === "imageView" ? translate("chat.imageTool.view") : translate("chat.imageTool.generate");
  const promptBody = revisedPromptBody(item);
  const hasDetails = Boolean(promptBody || item?.detailText);
  const detailsHint = [promptBody ? "prompt" : "", item?.detailText ? "source" : ""].filter(Boolean).join(" / ");
  const Icon = item?.itemType === "imageView" ? Eye : item?.status === "running" ? Loader2 : item?.status === "failed" ? AlertTriangle : item?.status === "completed" ? CheckCircle2 : ImageIcon;
  const showRunningSkeleton = item?.status === "running" && images.length === 0;

  return (
    <div {...props} className={["chat-tool-wrap w-full max-w-full min-w-0", className].filter(Boolean).join(" ")}>
      <section
        className={[
          "official-image-card",
          item?.status === "running" ? "is-running" : "",
          item?.status === "completed" ? "is-completed" : "",
          item?.status === "failed" ? "is-failed" : "",
          item?.itemType === "imageView" ? "is-view" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={translate("chat.imageTool.aria")}
      >
        <header className="official-image-card__header">
          <div className="official-image-card__mark" aria-hidden="true">
            <Icon className="official-image-card__icon" />
          </div>
          <div className="official-image-card__heading">
            <div className="official-image-card__title-row">
              <span className="official-image-card__title">{titleText || item?.title}</span>
              <span className="official-image-card__badge">{statusText(item)}</span>
            </div>
            <div className="official-image-card__meta">
              <span>{subtitleText(item, images.length)}</span>
              {showTimestamps && formattedTime ? <span className="official-image-card__time mono">{formattedTime}</span> : null}
            </div>
          </div>
        </header>

        {showRunningSkeleton ? (
          <div className="official-image-card__skeleton-grid" aria-hidden="true">
            {Array.from({ length: skeletonCount(item) }).map((_, index) => (
              <div key={index} className="official-image-card__skeleton">
                <div className="official-image-card__skeleton-glow" />
              </div>
            ))}
          </div>
        ) : images.length > 0 ? (
          <div
            className={[
              "official-image-card__grid",
              images.length === 1 ? "official-image-card__grid--single" : "",
              images.length > 1 ? "official-image-card__grid--many" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {images.map((image) => (
              <LazyImageThumb
                key={image.id}
                className="official-image-card__thumb"
                imageId={image.id}
                source={image.source}
                sourceKind={image.sourceKind}
                previewTitle={image.title}
                workspaceRoot={workspaceRoot}
                rootMarginPx={360}
                onLoadError={onLoadError}
                onPreview={onPreview}
              />
            ))}
          </div>
        ) : (
          <div className="official-image-card__empty">
            <AlertTriangle className="official-image-card__empty-icon" aria-hidden="true" />
            <span>{emptyText(item)}</span>
          </div>
        )}

        {item?.errorText ? <div className="official-image-card__error mono">{item.errorText}</div> : null}

        {hasDetails ? (
          <details className="official-image-card__details">
            <summary>
              <span>{translate("chat.imageTool.details")}</span>
              <span className="official-image-card__details-hint">{detailsHint}</span>
            </summary>
            {promptBody ? (
              <div className="official-image-card__prompt">
                <div className="official-image-card__detail-label">{translate("chat.imageTool.revisedPrompt")}</div>
                <p>{promptBody}</p>
              </div>
            ) : null}
            {item?.detailText ? <pre className="official-image-card__source mono">{item.detailText}</pre> : null}
          </details>
        ) : null}
      </section>
    </div>
  );
}
