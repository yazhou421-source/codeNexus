import type { useRuntimeStore } from "../../stores/runtime.store";
import type { ComposeImageAttachment, ComposeWorkspaceFileMention } from "../types";

type RuntimeStore = ReturnType<typeof useRuntimeStore>;
type ComposeMode = "default" | "plan";

export type TurnSendDraft = {
  anchorTurnId?: string;
  composeInput: string;
  composeAttachments: ComposeImageAttachment[];
  composeFileMentions: ComposeWorkspaceFileMention[];
  model?: string;
  reasoningEffort?: string;
  sandboxMode?: string;
  composeMode?: ComposeMode;
};

export type TurnSendDraftRuntimeDeps = {
  runtimeStore: RuntimeStore;
};

export type TurnSendDraftRuntime = {
  cloneComposeAttachmentsForSend: (items: ComposeImageAttachment[]) => ComposeImageAttachment[];
  cloneComposeMentionsForSend: (items: ComposeWorkspaceFileMention[]) => ComposeWorkspaceFileMention[];
  runtimeStoreSendDraft: () => TurnSendDraft;
  clearRuntimeStoreDraftAfterSend: () => Promise<void>;
};

export function createTurnSendDraftRuntime(deps: TurnSendDraftRuntimeDeps): TurnSendDraftRuntime {
  const cloneComposeAttachmentsForSend = (items: ComposeImageAttachment[]): ComposeImageAttachment[] => {
    return items.map((item) => ({
      ...item,
      input: { ...item.input },
    }));
  };

  const cloneComposeMentionsForSend = (items: ComposeWorkspaceFileMention[]): ComposeWorkspaceFileMention[] => {
    return items.map((item) => ({ ...item }));
  };

  const runtimeStoreSendDraft = (): TurnSendDraft => {
    const { runtimeStore } = deps;
    return {
      composeInput: String(runtimeStore.composeInput ?? ""),
      composeAttachments: runtimeStore.composeAttachments,
      composeFileMentions: runtimeStore.composeFileMentions,
      model: runtimeStore.model,
      reasoningEffort: runtimeStore.reasoningEffort,
      sandboxMode: runtimeStore.sandboxMode,
      composeMode: runtimeStore.composeMode,
    };
  };

  const clearRuntimeStoreDraftAfterSend = async () => {
    const { runtimeStore } = deps;
    runtimeStore.composeInput = "";
    runtimeStore.clearComposeAttachments();
    runtimeStore.clearComposeFileMentions();
    runtimeStore.endHistoryRewrite();
    await runtimeStore.saveThreadComposeStateNow();
  };

  return {
    cloneComposeAttachmentsForSend,
    cloneComposeMentionsForSend,
    runtimeStoreSendDraft,
    clearRuntimeStoreDraftAfterSend,
  };
}
