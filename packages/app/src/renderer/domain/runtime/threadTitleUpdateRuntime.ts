import type { useThreadStore } from "../../stores/thread.store";
import {
  fallbackThreadTitle,
  isBootstrapThreadTitleSource,
  titleFromFirstUserMessage,
} from "../../features/history/threadTitle";
import type { LocalThreadItem, ThreadHistoryItem } from "../types";

type ThreadStore = ReturnType<typeof useThreadStore>;

export type ThreadTitleUpdateRuntimeDeps = {
  threadStore: ThreadStore;
  findThreadListItem: (threadId: string) => ThreadHistoryItem | LocalThreadItem | undefined;
};

export type ThreadTitleUpdateRuntime = {
  seedThreadTitleFromDraft: (args: {
    threadId: string;
    threadWorkspace: string;
    visibleText: string;
    composeFileMentionCount: number;
    composeAttachmentCount: number;
  }) => void;
};

export function createThreadTitleUpdateRuntime(deps: ThreadTitleUpdateRuntimeDeps): ThreadTitleUpdateRuntime {
  const seedThreadTitleFromDraft: ThreadTitleUpdateRuntime["seedThreadTitleFromDraft"] = (args) => {
    const existing = deps.findThreadListItem(args.threadId);
    const currentTitle = String(existing?.title ?? "").trim();
    const placeholder = fallbackThreadTitle(args.threadId);
    const titleSeedText =
      args.visibleText ||
      (args.composeFileMentionCount > 0
        ? `文件 ${args.composeFileMentionCount} 个`
        : `图片 ${args.composeAttachmentCount} 张`);

    if (currentTitle && currentTitle !== placeholder) return;
    if (isBootstrapThreadTitleSource(titleSeedText)) return;

    const nextTitle = titleFromFirstUserMessage(titleSeedText) || placeholder;
    const titlePatch = {
      id: args.threadId,
      title: nextTitle,
      meta: String(existing?.meta ?? args.threadWorkspace ?? "").trim() || "无工作区",
      cwd: String(existing?.cwd ?? args.threadWorkspace ?? "").trim() || undefined,
      modelProvider: String(existing?.modelProvider ?? "").trim() || undefined,
      updatedAt: Date.now(),
      running: deps.threadStore.runningThreadIds.has(args.threadId),
    };

    if (deps.threadStore.hasLocalThread(args.threadId)) {
      deps.threadStore.patchLocalThread(args.threadId, titlePatch);
    } else {
      deps.threadStore.upsertThreadHistory(titlePatch);
    }
  };

  return { seedThreadTitleFromDraft };
}
