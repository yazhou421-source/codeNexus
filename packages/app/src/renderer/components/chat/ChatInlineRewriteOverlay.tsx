import { useEffect, useRef } from "react";
import type { SandboxMode } from "../../stores/runtime.store";
import type { ChatInlineRewriteDraft } from "../layout/types/chat.types";
import ComposerPanel from "../layout/composer/ComposerPanel";

type Option = string | { value: string; label: string; disabled?: boolean };

type ChatInlineRewriteOverlayProps = {
  draft: ChatInlineRewriteDraft;
  modelOptions?: readonly Option[];
  reasoningEffortOptions?: readonly Option[];
  sandboxModeOptions?: readonly Option[];
  sendDisabled?: boolean;
  onUpdate?: (patch: Partial<ChatInlineRewriteDraft>) => void;
  onCancel?: () => void;
  onSend?: () => void;
  className?: string;
};

export default function ChatInlineRewriteOverlay({
  draft,
  modelOptions = [],
  reasoningEffortOptions = [],
  sandboxModeOptions = [],
  sendDisabled = false,
  onUpdate,
  onCancel,
  onSend,
  className,
}: ChatInlineRewriteOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);
  const INLINE_REWRITE_OWNER_ID = "inline-history-rewrite";

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [draft.anchorEventId]);

  useEffect(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (overlayRef.current?.contains(target)) return;
      if (target.closest(`[data-composer-owner="${INLINE_REWRITE_OWNER_ID}"]`)) return;
      onCancel?.();
    };
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  }, [onCancel]);

  return (
    <div
      ref={overlayRef}
      className={["chat-inline-rewrite-overlay", className].filter(Boolean).join(" ")}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ComposerPanel
        composerPanelRef={panelRef}
        composerInputRef={inputRef}
        composeInput={draft.composeInput}
        composeAttachments={draft.composeAttachments}
        composeFileMentions={draft.composeFileMentions}
        historyRewriteActive
        historyRewriteSource="history"
        composeMode={draft.composeMode}
        model={draft.model}
        reasoningEffort={draft.reasoningEffort}
        sandboxMode={draft.sandboxMode}
        modelOptions={modelOptions}
        reasoningEffortOptions={reasoningEffortOptions}
        sandboxModeOptions={sandboxModeOptions}
        sandboxRiskText=""
        contextUsageTooltip=""
        contextUsagePercent={0}
        contextUsageLevel="normal"
        contextUsageTokensText=""
        isTurnRunning={draft.sending}
        sendDisabled={sendDisabled || draft.sending}
        sendTitle={draft.sending ? "发送中" : "发送编辑内容"}
        interruptDisabled
        interruptTitle="正在发送编辑内容"
        inputId="inline-history-rewrite-input"
        inputPlaceholder="修改这条消息..."
        variant="inline"
        interactionOwnerId={INLINE_REWRITE_OWNER_ID}
        onUpdateComposeInput={(value) => onUpdate?.({ composeInput: value })}
        onUpdateComposeFileMentions={(value) => onUpdate?.({ composeFileMentions: value })}
        onUpdateModel={(value) => onUpdate?.({ model: value })}
        onUpdateReasoningEffort={(value) => onUpdate?.({ reasoningEffort: value })}
        onUpdateSandboxMode={(value: SandboxMode) => onUpdate?.({ sandboxMode: value })}
        onSetComposeMode={(value) => onUpdate?.({ composeMode: value })}
        onCancelRewrite={onCancel}
        onSend={onSend}
        onComposerKeydown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel?.();
            return;
          }
          if (event.key === "Tab" && event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            onUpdate?.({ composeMode: draft.composeMode === "plan" ? "default" : "plan" });
            requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
            return;
          }
          if (event.key !== "Enter") return;
          if (event.nativeEvent.isComposing) return;
          if (event.shiftKey) return;
          event.preventDefault();
          event.stopPropagation();
          if (sendDisabled || draft.sending) return;
          onSend?.();
        }}
        onRemoveAttachment={(attachmentId) => {
          const id = String(attachmentId ?? "").trim();
          if (!id) return;
          onUpdate?.({ composeAttachments: draft.composeAttachments.filter((attachment) => attachment.id !== id) });
        }}
      />
    </div>
  );
}
