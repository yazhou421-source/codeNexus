import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getRuntimeOrchestrator } from "../../../domain/runtimeOrchestrator";
import { showToast } from "../../../ui/toast";

type TopBarToolsMenuProps = {
  className?: string;
  open?: boolean;
  onToggle?: () => void;
};

export default function TopBarToolsMenu({ className, open = false, onToggle }: TopBarToolsMenuProps) {
  const { t } = useTranslation();
  const runtime = getRuntimeOrchestrator();

  const onContextActionComingSoon = () => {
    showToast({
      kind: "info",
      title: t("topbarExtra.rollbackRecent"),
      message: t("topbarExtra.rollbackUnavailableToast"),
      timeoutMs: 4500,
    });
  };

  return (
    <div className={className}>
      <div className={`topbar-single-switch${open ? " is-open" : ""}`}>
        <span className="topbar-single-switch-thumb" aria-hidden="true" />
        <button
          id="btn-topbar-tools"
          className="topbar-single-switch-option"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("topbarExtra.tools")}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.();
          }}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span className="topbar-right-switch-label">{t("topbarExtra.tools")}</span>
        </button>
      </div>

      {open ? (
        <div className="topbar-menu-shell topbar-menu-shell--tools" onClick={(event) => event.stopPropagation()}>
          <div className="topbar-dropdown topbar-menu app-scrollbar" role="menu" aria-label={t("topbarExtra.toolsMenu")}>
            <div className="topbar-menu-section">
              <div className="topbar-menu-heading">{t("topbarExtra.contextActions")}</div>
              <button id="btn-topbar-rollback" className="btn-mini !justify-start" type="button" onClick={onContextActionComingSoon}>
                {t("topbarExtra.rollbackRecent")}
              </button>
              <div className="topbar-menu-note">{t("topbarExtra.rollbackUnavailable")}</div>
              <button className="btn-mini !justify-start" id="btn-topbar-memory-enable" type="button" onClick={() => void runtime.setCurrentThreadMemoryMode("enabled")}>
                {t("topbarExtra.enableThreadMemory")}
              </button>
              <button className="btn-mini !justify-start" id="btn-topbar-memory-disable" type="button" onClick={() => void runtime.setCurrentThreadMemoryMode("disabled")}>
                {t("topbarExtra.disableThreadMemory")}
              </button>
              <button className="btn-mini !justify-start danger" id="btn-topbar-memory-reset" type="button" onClick={() => void runtime.resetCodexMemory()}>
                {t("topbarExtra.resetCodexMemory")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
