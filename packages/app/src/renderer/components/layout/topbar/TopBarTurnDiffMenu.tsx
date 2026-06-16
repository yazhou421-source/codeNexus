import { GitCompare } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRuntimeStore } from "../../../stores/runtime.store";
import { useThreadStore } from "../../../stores/thread.store";
import TurnDiffSummaryCard from "../../timeline/cards/TurnDiffSummaryCard";

type TopBarTurnDiffMenuProps = {
  className?: string;
  open?: boolean;
  onToggle?: () => void;
};

export default function TopBarTurnDiffMenu({ className, open = false, onToggle }: TopBarTurnDiffMenuProps) {
  const { t } = useTranslation();
  const runtimeStore = useRuntimeStore();
  const threadStore = useThreadStore();

  const currentTurnDiffText = useMemo(() => {
    const threadId = String(threadStore.currentThreadId || runtimeStore.timelineKey || "").trim();
    if (!threadId) return "";

    const diffMap = threadStore.turnDiffByThread.get(threadId) ?? null;
    if (!diffMap || diffMap.size === 0) return "";

    const planTurnId = String(threadStore.currentTurnPlan?.turnId ?? "").trim();
    const activeTurnId = String(threadStore.activeTurnIdByThread.get(threadId) ?? "").trim();

    const pickForTurn = (turnId: string) => {
      if (!turnId) return "";
      const diffText = String(diffMap.get(turnId) ?? "");
      return diffText.trim() ? diffText : "";
    };

    const direct = pickForTurn(planTurnId) || pickForTurn(activeTurnId);
    if (direct) return direct;

    const completed = threadStore.completedTurnsByThread.get(threadId) ?? [];
    for (let index = completed.length - 1; index >= 0; index -= 1) {
      const diffText = String(completed[index]?.diffText ?? "");
      if (diffText.trim()) return diffText;
    }

    let lastDiffText = "";
    for (const diffText of diffMap.values()) {
      const text = String(diffText ?? "");
      if (text.trim()) lastDiffText = text;
    }
    return lastDiffText;
  }, [
    runtimeStore.timelineKey,
    threadStore.activeTurnIdByThread,
    threadStore.completedTurnsByThread,
    threadStore.currentThreadId,
    threadStore.currentTurnPlan?.turnId,
    threadStore.turnDiffByThread,
  ]);

  return (
    <div className={className}>
      <div className={`topbar-single-switch${open ? " is-open" : ""}`}>
        <span className="topbar-single-switch-thumb" aria-hidden="true" />
        <button
          id="btn-topbar-turn-diff"
          className="topbar-single-switch-option"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("topbarExtra.turnDiff")}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
        >
          <GitCompare aria-hidden="true" />
          <span className="topbar-right-switch-label">{t("topbarExtra.diff")}</span>
        </button>
      </div>

      {open ? (
        <div className="topbar-menu-shell topbar-menu-shell--turn-diff" onClick={(event) => event.stopPropagation()}>
          <div className="topbar-dropdown topbar-menu app-scrollbar" role="menu" aria-label={t("topbarExtra.turnDiff")}>
            <div className="topbar-menu-section">
              <div className="topbar-menu-heading">{t("topbarExtra.turnDiff")}</div>
              {!currentTurnDiffText ? <div className="topbar-menu-note">{t("topbarExtra.noDiff")}</div> : <TurnDiffSummaryCard diffText={currentTurnDiffText} />}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
