import { CheckCircle2, Loader2 } from "lucide-react";
import type { AppClosingStep } from "@codenexus/shared/ipc";
import { useTranslation } from "react-i18next";
import type { PlanStepState, TimelineEventItem, TurnPlanState } from "../../../domain/types";
import { isLocalThinkingEvent } from "../../../features/timeline/eventKinds";
import { useAppClosingStore } from "../../../stores/appClosing.store";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import { useTimelineStore } from "../../../stores/timeline.store";

type AppClosingOverlayProps = {
  className?: string;
};

const THINKING_PHASE_KEYS: Record<NonNullable<TimelineEventItem["thinkingPhase"]>, string> = {
  queued: "appClosing.thinkingQueued",
  preparing: "appClosing.thinkingPreparing",
  reasoning: "appClosing.thinkingReasoning",
  streaming: "appClosing.thinkingStreaming",
  waiting_more: "appClosing.thinkingWaitingMore",
  completed: "appClosing.thinkingCompleted",
  failed: "appClosing.thinkingFailed",
};

function compactText(value: unknown, maxLength = 140) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function localizedClosingStepLabel(step: AppClosingStep, t: (key: string) => string) {
  if (step.id === "prepareUi") return t("appClosing.prepareUi");
  if (step.id === "stopTasks") return t("appClosing.stopTasks");
  if (step.id === "exitApp") return t("appClosing.exitApp");
  return step.label;
}

function buildStepAriaLabel(
  label: string,
  status: AppClosingStep["status"] | PlanStepState["status"],
  t: (key: string, params?: Record<string, unknown>) => string
) {
  return t("appClosing.stepAria", {
    label,
    status: status === "completed" ? t("appClosing.completed") : t("appClosing.processing"),
  });
}

export default function AppClosingOverlay({ className }: AppClosingOverlayProps) {
  const { t } = useTranslation();
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
      ? t("appClosing.phaseStopping")
      : store.phase === "finalizing"
        ? t("appClosing.phaseFinalizing")
        : t("appClosing.phaseSafeClosing");
  const phaseSubtitle =
    store.phase === "starting"
      ? t("appClosing.subtitleStarting")
      : store.phase === "preparing"
        ? t("appClosing.subtitlePreparing")
        : store.phase === "stopping"
          ? t("appClosing.subtitleStopping")
          : store.phase === "finalizing"
            ? t("appClosing.subtitleFinalizing")
            : t("appClosing.subtitleDefault");
  const taskPlanSteps = activePlan?.plan ?? [];
  const taskTitle = (() => {
    if (activePlan) {
      return (
        activePlan.plan.find((step) => step.status === "inProgress")?.step ||
        compactText(activePlan.explanation) ||
        activePlan.plan[0]?.step ||
        t("appClosing.taskFallback")
      );
    }
    const event = activeThinkingEvent;
    if (!event) return "";
    if (event.thinkingPhase) return t(THINKING_PHASE_KEYS[event.thinkingPhase] ?? "appClosing.thinkingReasoning");
    return t("appClosing.thinkingReasoning");
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
    <div className={["app-closing-overlay", className].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-label={t("appClosing.aria")}>
      <div className="app-closing-overlay-backdrop" />
      <section className="app-closing-panel">
        <div className="app-closing-head">
          <div className="app-closing-orb" aria-hidden="true">
            <Loader2 className="app-closing-spin" />
          </div>
          <div className="app-closing-copy">
            <p className="app-closing-kicker mono">{t("appClosing.kicker")}</p>
            <h2 className="app-closing-title">{phaseTitle}</h2>
            <p className="app-closing-subtitle">{phaseSubtitle}</p>
          </div>
        </div>

        <div className="app-closing-step-list" role="list" aria-label={t("appClosing.stepsAria")}>
          {store.steps.map((step) => {
            const done = step.status === "completed";
            const label = localizedClosingStepLabel(step, t);
            return (
              <div
                key={`${step.id}:${step.status}`}
                className={`app-closing-step-item${done ? " is-completed" : ""}`}
                aria-label={buildStepAriaLabel(label, step.status, t)}
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
          <section className="app-closing-task-card" aria-label={t("appClosing.currentTaskAria")}>
            <div className="app-closing-task-head">
              <span className="running-indicator is-muted" aria-hidden="true" />
              <div className="min-w-0">
                <p className="app-closing-task-kicker mono">{t("appClosing.currentTask")}</p>
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
                      aria-label={buildStepAriaLabel(step.step, step.status, t)}
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
