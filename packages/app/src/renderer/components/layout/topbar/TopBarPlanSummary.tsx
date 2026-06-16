import { CheckCircle2, ChevronDown, CircleDashed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PlanStepState } from "../../../domain/types";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useThreadStore } from "../../../stores/thread.store";

type TopBarPlanSummaryProps = {
  className?: string;
};

export default function TopBarPlanSummary({ className }: TopBarPlanSummaryProps) {
  const { t } = useTranslation();
  const appShellStore = useAppShellStore();
  const threadStore = useThreadStore();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const plan = threadStore.currentTurnPlan;
  const steps = useMemo<PlanStepState[]>(() => plan?.plan ?? [], [plan?.plan]);
  const explanationText = String(plan?.explanation ?? "").trim();
  const hasPlan = Boolean(explanationText) || steps.length > 0;
  const visible = appShellStore.mainView === "chat" && !appShellStore.settingsOpen && hasPlan;
  const completedCount = steps.filter((step) => step.status === "completed").length;
  const currentRunningStep = steps.find((step) => step.status === "inProgress") ?? null;
  const progressText = steps.length > 0 ? `${completedCount}/${steps.length}` : "0/0";
  const currentStepText = currentRunningStep ? currentRunningStep.step : steps.length > 0 ? t("topbarPlan.completed") : t("topbarPlan.noSteps");
  const currentStepKey = currentRunningStep ? `running:${currentRunningStep.step}` : `progress:${completedCount}:${steps.length}`;

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    setOpen(false);
  }, [plan?.turnId]);

  useEffect(() => {
    function onWindowPointerDown(event: PointerEvent) {
      if (!open) return;
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      setOpen(false);
    }
    function onWindowKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    window.addEventListener("keydown", onWindowKeydown);
    return () => {
      window.removeEventListener("pointerdown", onWindowPointerDown, true);
      window.removeEventListener("keydown", onWindowKeydown);
    };
  }, [open]);

  function planStepLabelText(status: PlanStepState["status"]) {
    if (status === "completed") return t("topbarPlan.stepCompleted");
    if (status === "inProgress") return t("topbarPlan.inProgress");
    return t("topbarPlan.pending");
  }

  function planStepStatusTextClass(status: PlanStepState["status"]) {
    if (status === "completed") return "is-completed";
    if (status === "inProgress") return "is-in-progress";
    return "is-pending";
  }

  if (!visible) return null;

  return (
    <div ref={rootRef} className={["topbar-plan-summary", open ? "is-open" : "", className].filter(Boolean).join(" ")}>
      <button
        id="btn-topbar-plan-summary"
        className="topbar-plan-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="topbar-plan-menu"
        onClick={() => setOpen((next) => !next)}
      >
        <span className="topbar-plan-label">{t("topbarPlan.plan")}</span>
        <span className="topbar-plan-progress mono">{progressText}</span>
        <span className="topbar-plan-current">
          {currentRunningStep ? <span className="running-indicator is-accent topbar-plan-spinner" aria-hidden="true" /> : null}
          <span key={currentStepKey} className="topbar-plan-current-text">
            {currentStepText}
          </span>
        </span>
        <ChevronDown className={`topbar-plan-caret${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>

      {open ? (
        <div id="topbar-plan-menu" className="topbar-menu-shell topbar-menu-shell--plan" onClick={(event) => event.stopPropagation()}>
          <div className="topbar-dropdown topbar-menu topbar-plan-menu app-scrollbar" role="dialog" aria-label={t("topbarPlan.currentPlan")}>
            <div className="topbar-plan-menu-head">
              <span className="topbar-menu-heading">{t("topbarPlan.currentPlan")}</span>
              <span className="topbar-plan-menu-progress mono">
                {t("topbarPlan.completedProgress", { completed: completedCount, total: steps.length })}
              </span>
            </div>
            {explanationText ? <div className="topbar-plan-explanation">{explanationText}</div> : null}
            <ol className="topbar-plan-list">
              {steps.map((step) => (
                <li key={`${step.status}:${step.step}`} className={`topbar-plan-step is-${step.status}`}>
                  <span className={`topbar-plan-step-status ${planStepStatusTextClass(step.status)}`}>
                    {step.status === "pending" ? (
                      <CircleDashed className="topbar-plan-step-icon" aria-hidden="true" />
                    ) : step.status === "inProgress" ? (
                      <span className="running-indicator is-accent topbar-plan-step-spinner" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="topbar-plan-step-icon" aria-hidden="true" />
                    )}
                    <span className="mono">{planStepLabelText(step.status)}</span>
                  </span>
                  <span className="topbar-plan-step-text">{step.step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
    </div>
  );
}
