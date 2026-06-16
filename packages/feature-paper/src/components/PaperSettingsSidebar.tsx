import "./paper-workbench.css";

import { ClipboardCopy, FilePenLine, ListTree, Quote, ScanSearch, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { showPaperToast } from "../runtimeBridge";
import { usePaperStore, type PaperGenerationMode } from "../store";

type PaperSettingsSidebarProps = {
  className?: string;
  children?: ReactNode;
};

const modes: Array<{ value: PaperGenerationMode; labelKey: string; icon: LucideIcon }> = [
  { value: "outline", labelKey: "paperSidebar.modes.outline", icon: ListTree },
  { value: "draft", labelKey: "paperSidebar.modes.draft", icon: FilePenLine },
  { value: "revise", labelKey: "paperSidebar.modes.revise", icon: ScanSearch },
  { value: "citations", labelKey: "paperSidebar.modes.citations", icon: Quote },
];

export default function PaperSettingsSidebar({ className, children }: PaperSettingsSidebarProps) {
  const { t } = useTranslation();
  const paper = usePaperStore();
  const selectedSectionWords = `${paper.selectedSection.wordTarget}w`;
  const localizedPrompt = useMemo(
    () =>
      [
        `${t("paperSidebar.promptTask")}: ${t(`paperSidebar.modes.${paper.mode}`)}`,
        `${t("paperSidebar.promptTitle")}: ${paper.title}`,
        `${t("paperSidebar.promptField")}: ${paper.field}`,
        `${t("paperSidebar.promptSection")}: ${t(`paperWorkspace.sectionNames.${paper.selectedSection.titleKey}`)}`,
        `${t("paperSidebar.promptQuestion")}: ${paper.researchQuestion}`,
        `${t("paperSidebar.promptConstraints")}: ${paper.constraints}`,
      ].join("\n"),
    [paper.constraints, paper.field, paper.mode, paper.researchQuestion, paper.selectedSection.titleKey, paper.title, t],
  );

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(localizedPrompt);
      showPaperToast({ kind: "success", message: t("paperSidebar.promptCopied") });
    } catch (error) {
      showPaperToast({ kind: "error", message: String((error as Error)?.message ?? error) });
    }
  }

  return (
    <aside className={["sidebar sidebar-right paper-settings-sidebar", className].filter(Boolean).join(" ")} aria-label={t("paperSidebar.aria")}>
      <header className="paper-settings-head">
        <div>
          <div className="paper-settings-eyebrow">Paper</div>
          <h2>{t("paperSidebar.title")}</h2>
        </div>
        <span className="paper-settings-badge mono">{selectedSectionWords}</span>
      </header>

      <div className="paper-settings-scroll app-scrollbar">
        <section className="paper-settings-section">
          <div className="paper-control-label">{t("paperSidebar.mode")}</div>
          <div className="paper-mode-grid">
            {modes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  key={mode.value}
                  className={`paper-mode-button${paper.mode === mode.value ? " is-active" : ""}`}
                  type="button"
                  onClick={() => paper.setMode(mode.value)}
                >
                  <Icon aria-hidden="true" />
                  <span>{t(mode.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="paper-settings-section">
          <label className="paper-field">
            <span>{t("paperSidebar.researchQuestion")}</span>
            <textarea
              className="paper-textarea"
              rows={5}
              value={paper.researchQuestion}
              onChange={(event) => paper.updateResearchQuestion(event.currentTarget.value)}
            />
          </label>

          <label className="paper-field">
            <span>{t("paperSidebar.constraints")}</span>
            <textarea
              className="paper-textarea"
              rows={5}
              value={paper.constraints}
              onChange={(event) => paper.updateConstraints(event.currentTarget.value)}
            />
          </label>
        </section>

        <section className="paper-settings-section">
          <div className="paper-section-head">
            <span>{t("paperSidebar.references")}</span>
            <span className="mono">{paper.references.length}</span>
          </div>
          <div className="paper-reference-list">
            {paper.references.map((reference) => (
              <article key={reference.id} className="paper-reference-item">
                <div className="paper-reference-title">{reference.title}</div>
                <div className="paper-reference-meta">
                  <span>{reference.meta}</span>
                  <span>{t(`paperSidebar.referenceStatus.${reference.statusKey}`)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="paper-settings-section">
          <div className="paper-section-head">
            <span>{t("paperSidebar.promptPreview")}</span>
          </div>
          <pre className="paper-prompt-preview app-scrollbar">{localizedPrompt}</pre>
          <button className="paper-primary-action" type="button" onClick={() => void copyPrompt()}>
            <ClipboardCopy aria-hidden="true" />
            <span>{t("paperSidebar.copyPrompt")}</span>
          </button>
        </section>
        {children}
      </div>
    </aside>
  );
}
