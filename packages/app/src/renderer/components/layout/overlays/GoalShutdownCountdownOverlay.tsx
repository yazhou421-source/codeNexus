import { useGoalShutdownStore } from "../../../stores/goalShutdown.store";

type GoalShutdownCountdownOverlayProps = {
  className?: string;
};

export default function GoalShutdownCountdownOverlay({ className }: GoalShutdownCountdownOverlayProps) {
  const store = useGoalShutdownStore();
  const countdown = store.countdown;
  if (!countdown) return null;

  return (
    <section className={["goal-shutdown-overlay", className].filter(Boolean).join(" ")} aria-label="目标完成自动关机倒计时">
      <div className="goal-shutdown-backdrop" />
      <div className="goal-shutdown-panel" role="dialog" aria-modal="true" aria-label="目标已完成，即将关机">
        <div className="goal-shutdown-kicker mono">自动关机</div>
        <h2 className="goal-shutdown-title">目标已完成，即将关机</h2>
        <p className="goal-shutdown-message">自动关机已按当前目标设置触发。倒计时结束前可以取消。</p>
        <div className="goal-shutdown-goal">{countdown.objective}</div>
        <div className="goal-shutdown-count mono">{`${countdown.remainingSeconds} 秒`}</div>
        {store.lastErrorText ? <div className="global-field-error">{store.lastErrorText}</div> : null}
        <button className="btn-mini danger goal-shutdown-cancel" type="button" disabled={store.shuttingDown} onClick={() => store.cancelCountdown()}>
          取消关机
        </button>
      </div>
    </section>
  );
}
