import { History, MessageSquareText, Wand2 } from "lucide-react";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import type { ThreadHistoryItem } from "../../domain/types";
import { translate } from "../../i18n/translate";
import LoadingDots from "../ui/LoadingDots";

type CenterPaneEmptyStateProps = {
  loading?: boolean;
  historyItems?: ThreadHistoryItem[];
  mode?: "default" | "pendingThread";
  title?: string;
  description?: string;
  className?: string;
  onSwitchThread?: (threadId: string) => void;
};

export default function CenterPaneEmptyState({
  loading = false,
  historyItems = [],
  mode = "default",
  title,
  description,
  className,
  onSwitchThread,
}: CenterPaneEmptyStateProps) {
  const runtime = getRuntimeOrchestrator();
  const items = Array.isArray(historyItems) ? historyItems : [];

  if (loading) {
    return (
      <div className={["center-empty-state", className].filter(Boolean).join(" ")}>
        <div className="mono dim flex w-full items-center justify-center gap-3 my-12">
          <span className="running-indicator is-muted" aria-hidden="true" />
          <span className="text-sm">{translate("centerEmpty.loadingMemory")}</span>
        </div>
      </div>
    );
  }

  if (mode === "pendingThread") {
    return (
      <div className={["center-empty-state", className].filter(Boolean).join(" ")}>
        <div className="center-thread-create-state" role="status" aria-live="polite">
          <span className="running-indicator is-accent center-thread-create-state__spinner" aria-hidden="true" />
          <div className="center-thread-create-state__copy">
            <LoadingDots
              className="center-thread-create-state__title"
              baseText={translate("centerEmpty.creatingThread")}
              intervalMs={360}
              maxDots={3}
              as="div"
              ariaLabel={translate("centerEmpty.creatingThread")}
            />
            <div className="center-thread-create-state__meta">{translate("centerEmpty.initializingContext")}</div>
          </div>
        </div>
      </div>
    );
  }

  if (items.length > 0) {
    return (
      <div className={["center-empty-state", className].filter(Boolean).join(" ")}>
        <div className="center-empty-history w-full animate-enter-slide-up">
          <div className="center-empty-history__head">
            <h2 className="center-empty-history__title">
              <History aria-hidden="true" /> {translate("centerEmpty.history")}
            </h2>
            <span className="center-empty-history__count">{translate("centerEmpty.recentCount", { count: items.length })}</span>
          </div>

          <div className="center-empty-history__grid">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                style={{ animationDelay: `${index * 40 + 150}ms` }}
                className="center-empty-history__item group animate-enter-slide-up"
                onClick={() => onSwitchThread?.(item.id)}
              >
                <span className="center-empty-history__item-title title">{item.title}</span>
                <span className="center-empty-history__item-meta mono">
                  <MessageSquareText aria-hidden="true" /> {translate("centerEmpty.chatThread")}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={["timeline-empty-state-shell", className].filter(Boolean).join(" ")}>
      <div className="empty-state">
        <Wand2 aria-hidden="true" />
        <h2>{title ?? translate("centerEmpty.defaultTitle")}</h2>
        <p className="dim">{description ?? translate("centerEmpty.defaultDescription")}</p>
        <button className="btn-primary" type="button" onClick={() => void runtime.selectWorkspace()}>
          {translate("centerEmpty.selectWorkspace")}
        </button>
      </div>
    </div>
  );
}
