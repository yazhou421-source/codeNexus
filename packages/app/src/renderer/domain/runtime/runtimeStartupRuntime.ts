import type { useThreadStore } from "../../stores/thread.store";
import { installEventPipeline } from "../../processes/protocol-event-pipeline/installEventPipeline";
import { installRequestResponder } from "../../processes/protocol-request-responder/installRequestResponder";
import { createHistoryTitleOverridesRuntime } from "./historyTitleOverridesRuntime";

type ThreadStore = ReturnType<typeof useThreadStore>;
type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export type RuntimeStartupRuntimeDeps = {
  storeScope: unknown;
  threadStore: ThreadStore;
  subscribeHistoryUpdates: () => () => void;
  subscribeCodexServerEvents: () => () => void;
  refreshHistory: (force?: boolean) => Promise<void>;
  resetSidePanelStores: (statusText?: string) => void;
  translate: TranslateFn;
};

export type RuntimeStartupRuntime = {
  startRuntime: () => Array<() => void>;
};

export function createRuntimeStartupRuntime(deps: RuntimeStartupRuntimeDeps): RuntimeStartupRuntime {
  const startRuntime = () => {
    const disposers: Array<() => void> = [];
    disposers.push(deps.subscribeHistoryUpdates());
    disposers.push(deps.subscribeCodexServerEvents());
    disposers.push(installEventPipeline(deps.storeScope));
    disposers.push(installRequestResponder(deps.storeScope));

    const historyTitleOverridesRuntime = createHistoryTitleOverridesRuntime({ threadStore: deps.threadStore });
    void historyTitleOverridesRuntime.refreshThreadTitleOverrides();
    void deps.refreshHistory(false);
    deps.resetSidePanelStores(deps.translate("runtime.noService"));

    return disposers;
  };

  return { startRuntime };
}
