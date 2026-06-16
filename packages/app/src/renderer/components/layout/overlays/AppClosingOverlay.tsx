import { CheckCircle2, Loader2 } from "lucide-react";
import type { AppClosingStep } from "@codenexus/shared/ipc";
import type { PlanStepState, TimelineEventItem, TurnPlanState } from "../../../domain/types";
import { isLocalThinkingEvent } from "../../../features/timeline/eventKinds";
import { useAppClosingStore } from "../../../stores/appClosing.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import { useTimelineStore } from "../../../stores/timeline.store";

type AppClosingOverlayProps = {
  className?: string;
};

const THINKING_PHASE_LABELS: Record<NonNullable<TimelineEventItem["thinkingPhase"]>, string> = {
  queued: "已排队",
  preparing: "准备中",
  reasoning: "思考中",
  streaming: "生成中",
  waiting_more: "等待继续",
  completed: "已完成",
  failed: "已失败",
};

function compactText(value: unknown, maxLength = 140) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function localizedClosingStepLabel(step: AppClosingStep) {
  if (step.id === "prepareUi") return "准备关闭界面";
  if (step.id === "stopTasks") return "停止后台任务";
  if (step.id === "exitApp") return "退出应用";
  return step.label;
}

function buildStepAriaLabel(label: string, status: AppClosingStep["status"] | PlanStepState["status"]) {
  return `${label}，${status === "completed" ? "已完成" : "正在处理中"}`;
}

export default function AppClosingOverlay({ className }: AppClosingOverlayProps) {
  const store = useAppClosingStore();
  const runtimeStore = useRuntimeStore();
  const threadStore = useThreadStore();
  const timelineStore = useTimelineStore();
  if (!store.visible) return null;

  const activeThreadId = String(runtimeStore.currentThreadId || threadStore.currentThreadId || "").trim();
  const activePlan: TurnPlanState | null = (() => {
    if (!activeThreadId) return null;
    const currentPlan = threadStore.currentTurnPlan;
    if (currentPlan && currentPlan.threadId === activeThreadId) return currentPlan;
    return threadStore.latestTurnPlanByThread.get(activeThreadId) ?? null;
  })();
  const activeThinkingEvent: TimelineEventItem | null = (() => {
    if (!activeThreadId) return null;
    const events = timelineStore.eventsForThread(activeThreadId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!isLocalThinkingEvent(event)) continue;
      if (event.thinkingPhase === "completed" || event.thinkingPhase === "failed") continue;
      return event;
    }
    return null;
  })();
  const phaseTitle =
    store.phase === "stopping"
      ? "正在停止后台任务"
      : store.phase === "finalizing"
        ? "正在退出应用"
        : "正在安全关闭应用";
  const phaseSubtitle =
    store.phase === "starting"
      ? "正在切换到关闭过场，避免界面停留在旧状态。"
      : store.phase === "preparing"
        ? "正在整理当前界面状态并保存临时输入。"
        : store.phase === "stopping"
          ? "正在结束后台步骤、连接和运行中的服务。"
          : store.phase === "finalizing"
            ? "所有收尾步骤已完成，应用即将退出。"
            : "正在准备关闭。";
  const taskPlanSteps = activePlan?.plan ?? [];
  const taskTitle = (() => {
    if (activePlan) {
      return (
        activePlan.plan.find((step) => step.status === "inProgress")?.step ||
        compactText(activePlan.explanation) ||
        activePlan.plan[0]?.step ||
        "正在处理当前任务"
      );
    }
    const event = activeThinkingEvent;
    if (!event) return "";
    if (event.thinkingPhase) return THINKING_PHASE_LABELS[event.thinkingPhase] ?? "思考中";
    return "思考中";
  })();
  const taskDescription = (() => {
    if (activePlan) {
      const text = compactText(activePlan.explanation);
      return text && text !== taskTitle ? text : "";
    }
    const event = activeThinkingEvent;
    if (!event) return "";
    const text = compactText(event.paramsText);
    return text && text !== taskTitle ? text : "";
  })();
  const showTaskCard = Boolean(taskTitle || taskDescription || taskPlanSteps.length > 0);

  return (
    <div className={["app-closing-overlay", className].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-label="应用正在关闭">
      <div className="app-closing-overlay-backdrop" />
      <section className="app-closing-panel">
        <div className="app-closing-head">
          <div className="app-closing-orb" aria-hidden="true">
            <Loader2 className="app-closing-spin" />
          </div>
          <div className="app-closing-copy">
            <p className="app-closing-kicker mono">正在关闭应用</p>
            <h2 className="app-closing-title">{phaseTitle}</h2>
            <p className="app-closing-subtitle">{phaseSubtitle}</p>
          </div>
        </div>

        <div className="app-closing-step-list" role="list" aria-label="关闭步骤">
          {store.steps.map((step) => {
            const done = step.status === "completed";
            const label = localizedClosingStepLabel(step);
            return (
              <div
                key={`${step.id}:${step.status}`}
                className={`app-closing-step-item${done ? " is-completed" : ""}`}
                aria-label={buildStepAriaLabel(label, step.status)}
              >
                <span className="app-closing-refresh-badge" aria-hidden="true">
                  {done ? <CheckCircle2 className="app-closing-complete-icon" /> : <Loader2 className="app-closing-spin" />}
                </span>
                <span className="app-closing-step-text">{label}</span>
              </div>
            );
          })}
        </div>

        {showTaskCard ? (
          <section className="app-closing-task-card" aria-label="当前任务摘要">
            <div className="app-closing-task-head">
              <span className="running-indicator is-muted" aria-hidden="true" />
              <div className="min-w-0">
                <p className="app-closing-task-kicker mono">当前任务</p>
                <p className="app-closing-task-title">{taskTitle}</p>
              </div>
            </div>
            {taskDescription ? <p className="app-closing-task-description">{taskDescription}</p> : null}
            {taskPlanSteps.length > 0 ? (
              <div className="app-closing-task-steps" role="list">
                {taskPlanSteps.map((step) => {
                  const done = step.status === "completed";
                  return (
                    <div
                      key={`${step.step}:${step.status}`}
                      className={`app-closing-task-step${done ? " is-completed" : ""}`}
                      aria-label={buildStepAriaLabel(step.step, step.status)}
                    >
                      <span className="app-closing-refresh-badge" aria-hidden="true">
                        {done ? <CheckCircle2 className="app-closing-complete-icon" /> : <Loader2 className="app-closing-spin" />}
                      </span>
                      <span className="app-closing-task-step-text">{step.step}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}
      </section>
    </div>
  );
}
