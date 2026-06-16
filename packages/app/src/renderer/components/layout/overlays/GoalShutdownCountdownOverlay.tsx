import { useTranslation } from "react-i18next";
import { useGoalShutdownStore } from "../../../stores/goalShutdown.store";

type GoalShutdownCountdownOverlayProps = {
  className?: string;
};

export default function GoalShutdownCountdownOverlay({ className }: GoalShutdownCountdownOverlayProps) {
  const { t } = useTranslation();
  const store = useGoalShutdownStore();
  const countdown = store.countdown;
  if (!countdown) return null;

  return (
    <section className={["goal-shutdown-overlay", className].filter(Boolean).join(" ")} aria-label={t("goalShutdown.aria")}>
      <div className="goal-shutdown-backdrop" />
      <div className="goal-shutdown-panel" role="dialog" aria-modal="true" aria-label={t("goalShutdown.title")}>
        <div className="goal-shutdown-kicker mono">{t("goalShutdown.kicker")}</div>
        <h2 className="goal-shutdown-title">{t("goalShutdown.title")}</h2>
        <p className="goal-shutdown-message">{t("goalShutdown.message")}</p>
        <div className="goal-shutdown-goal">{countdown.objective}</div>
        <div className="goal-shutdown-count mono">{t("goalShutdown.remainingSeconds", { count: countdown.remainingSeconds })}</div>
        {store.lastErrorText ? <div className="global-field-error">{store.lastErrorText}</div> : null}
        <button className="btn-mini danger goal-shutdown-cancel" type="button" disabled={store.shuttingDown} onClick={() => store.cancelCountdown()}>
          {t("goalShutdown.cancel")}
        </button>
      </div>
    </section>
  );
}
