import type { HTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Eye, Image as ImageIcon, Loader2 } from "lucide-react";
import type { ChatImageEntry, ChatImageToolItem, ImagePreviewPayload, ThumbLoadErrorPayload } from "../layout/types/chat.types";
import LazyImageThumb from "../ui/LazyImageThumb";

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
    return item.itemType === "imageView" ? "读取中" : "生成中";
  }
  if (item?.status === "completed") {
    return item.itemType === "imageView" ? "已读取" : "已生成";
  }
  if (item?.status === "failed") {
    return item.itemType === "imageView" ? "读取失败" : "生成失败";
  }
  return "状态未知";
}

function subtitleText(item: ChatImageToolItem | undefined, imageCount: number) {
  if (item?.itemType === "imageView") {
    return imageCount > 0 ? "Codex view_image 结果" : "Codex view_image 请求";
  }
  if (item?.status === "running") return "等待图片生成结果";
  if (item?.status === "failed") return "图片生成返回失败";
  if (imageCount > 0) return `图片生成 · ${imageCount} 张结果`;
  return "图片生成未返回可预览图片";
}

function emptyText(item?: ChatImageToolItem) {
  if (item?.status === "failed") return "没有可显示的图片结果。";
  if (item?.itemType === "imageView") return "等待图片路径解析。";
  return "图片结果尚未到达。";
}

function revisedPromptBody(item?: ChatImageToolItem) {
  const prompt = String(item?.revisedPrompt ?? "").trim();
  if (!prompt) return "";
  return prompt
    .replace(/^修订提示词：\s*/iu, "")
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
  const titleText = item?.itemType === "imageView" ? "查看图片" : "生成图片";
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
        aria-label="Codex 图片生成结果"
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
              <span>生成细节</span>
              <span className="official-image-card__details-hint">{detailsHint}</span>
            </summary>
            {promptBody ? (
              <div className="official-image-card__prompt">
                <div className="official-image-card__detail-label">修订提示词</div>
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
