import { CheckCircle2, ChevronDown, Pencil, RefreshCw, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { useAppShellStore } from "../../../stores/appShell.store";
import { useThreadStore } from "../../../stores/thread.store";

type TopBarGoalSummaryProps = {
  className?: string;
};

const numberFormat = new Intl.NumberFormat();

const GOAL_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  budgetLimited: "预算受限",
  complete: "已完成",
};

export default function TopBarGoalSummary({ className }: TopBarGoalSummaryProps) {
  const appShellStore = useAppShellStore();
  const threadStore = useThreadStore();
  const runtime = getRuntimeOrchestrator();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const goal = threadStore.currentGoal;
  const visible = appShellStore.mainView === "chat" && !appShellStore.settingsOpen && Boolean(goal);
  const status = goal?.status ?? "active";
  const statusLabel = GOAL_STATUS_LABELS[status] ?? status;
  const tokensText = useMemo(() => {
    const current = Math.max(0, Math.round(Number(goal?.tokensUsed ?? 0)));
    const budget = goal?.tokenBudget;
    if (budget == null || budget <= 0) return numberFormat.format(current);
    return `${numberFormat.format(current)}/${numberFormat.format(Math.round(budget))}`;
  }, [goal?.tokenBudget, goal?.tokensUsed]);
  const progressText = goal?.tokenBudget ? tokensText : statusLabel;
  const elapsedText = useMemo(() => {
    const seconds = Math.max(0, Math.round(Number(goal?.timeUsedSeconds ?? 0)));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.round(minutes / 60);
    return `${hours} 小时`;
  }, [goal?.timeUsedSeconds]);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  useEffect(() => {
    setOpen(false);
  }, [goal?.threadId]);

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

  if (!visible || !goal) return null;

  const closeOpen = () => setOpen(false);

  async function onEditGoal() {
    closeOpen();
    await runtime.promptAndSetCurrentThreadGoal();
  }

  async function onCompleteGoal() {
    closeOpen();
    await runtime.completeCurrentThreadGoal();
  }

  async function onClearGoal() {
    closeOpen();
    await runtime.clearCurrentThreadGoal();
  }

  async function onRefreshGoal() {
    await runtime.refreshThreadGoal();
  }

  return (
    <div ref={rootRef} className={["topbar-goal-summary", open ? "is-open" : "", className].filter(Boolean).join(" ")}>
      <button
        id="btn-topbar-goal-summary"
        className="topbar-goal-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="topbar-goal-menu"
        onClick={() => setOpen((next) => !next)}
      >
        <Target className="topbar-goal-icon" aria-hidden="true" />
        <span className="topbar-goal-label">目标</span>
        <span className="topbar-goal-progress mono">{progressText}</span>
        <span className="topbar-goal-current">
          <span className="topbar-goal-current-text">{goal.objective}</span>
        </span>
        <ChevronDown className={`topbar-goal-caret${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>

      {open ? (
        <div id="topbar-goal-menu" className="topbar-menu-shell topbar-menu-shell--goal" onClick={(event) => event.stopPropagation()}>
          <div className="topbar-dropdown topbar-menu topbar-goal-menu app-scrollbar" role="dialog" aria-label="当前线程目标">
            <div className="topbar-goal-menu-head">
              <span className="topbar-menu-heading">当前线程目标</span>
              <span className={`topbar-goal-status mono is-${status}`}>{statusLabel}</span>
            </div>

            <div className="topbar-goal-objective">{goal.objective}</div>

            <div className="topbar-goal-metrics">
              <div className="topbar-goal-metric">
                <span className="topbar-goal-metric-label mono">Token</span>
                <span className="topbar-goal-metric-value mono">{tokensText}</span>
              </div>
              <div className="topbar-goal-metric">
                <span className="topbar-goal-metric-label mono">耗时</span>
                <span className="topbar-goal-metric-value mono">{elapsedText}</span>
              </div>
            </div>

            <div className="topbar-menu-section topbar-goal-actions">
              <button className="btn-mini !justify-start" type="button" onClick={() => void onEditGoal()}>
                <Pencil aria-hidden="true" />
                {"设置/更新目标"}
              </button>
              <button className="btn-mini !justify-start" type="button" disabled={goal.status === "complete"} onClick={() => void onCompleteGoal()}>
                <CheckCircle2 aria-hidden="true" />
                标记完成
              </button>
              <button className="btn-mini !justify-start danger" type="button" onClick={() => void onClearGoal()}>
                <Trash2 aria-hidden="true" />
                清除目标
              </button>
              <button className="btn-mini !justify-start" type="button" onClick={() => void onRefreshGoal()}>
                <RefreshCw aria-hidden="true" />
                刷新目标
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
