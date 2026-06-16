import { History, MessageSquareText, Wand2 } from "lucide-react";
import { getRuntimeOrchestrator } from "../../domain/runtimeOrchestrator";
import type { ThreadHistoryItem } from "../../domain/types";
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
          <span className="text-sm">正在读取时空记忆...</span>
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
              baseText="正在创建线程"
              intervalMs={360}
              maxDots={3}
              as="div"
              ariaLabel="正在创建线程"
            />
            <div className="center-thread-create-state__meta">初始化工作区和模型上下文</div>
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
              <History aria-hidden="true" /> 历史回溯
            </h2>
            <span className="center-empty-history__count">{`最近 ${items.length} 条`}</span>
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
                  <MessageSquareText aria-hidden="true" /> 对话线程
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
        <h2>{title ?? "选择一个工作区开始"}</h2>
        <p className="dim">{description ?? "Codex 会话需要绑定本地工作区。"}</p>
        <button className="btn-primary" type="button" onClick={() => void runtime.selectWorkspace()}>
          选择工作区
        </button>
      </div>
    </div>
  );
}
