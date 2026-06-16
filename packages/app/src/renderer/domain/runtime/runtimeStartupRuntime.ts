import type { useThreadStore } from "../../stores/thread.store";
import { installEventPipeline } from "../../processes/protocol-event-pipeline/installEventPipeline";
import { installRequestResponder } from "../../processes/protocol-request-responder/installRequestResponder";
import { createHistoryTitleOverridesRuntime } from "./historyTitleOverridesRuntime";

type ThreadStore = ReturnType<typeof useThreadStore>;

export type RuntimeStartupRuntimeDeps = {
  storeScope: unknown;
  threadStore: ThreadStore;
  subscribeHistoryUpdates: () => () => void;
  subscribeCodexServerEvents: () => () => void;
  refreshHistory: (force?: boolean) => Promise<void>;
  resetSidePanelStores: (statusText?: string) => void;
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
    deps.resetSidePanelStores("未连接服务");

    return disposers;
  };

  return { startRuntime };
}
