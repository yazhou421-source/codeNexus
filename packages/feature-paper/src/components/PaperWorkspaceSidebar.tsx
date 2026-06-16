import "./paper-workbench.css";

import { BookOpen } from "lucide-react";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePaperStore, type PaperSectionStatus } from "../store";

type PaperWorkspaceSidebarProps = {
  className?: string;
  children?: ReactNode;
};

export default function PaperWorkspaceSidebar({ className, children }: PaperWorkspaceSidebarProps) {
  const { t, i18n } = useTranslation();
  const paper = usePaperStore();

  function statusLabel(status: PaperSectionStatus): string {
    return t(`paperWorkspace.status.${status}`);
  }

  return (
    <aside className={["sidebar sidebar-left paper-workspace-sidebar", className].filter(Boolean).join(" ")} aria-label={t("paperWorkspace.aria")}>
      <div className="paper-side-shell">
        <header className="paper-side-head">
          <div className="paper-side-title-block">
            <span className="paper-side-icon" aria-hidden="true">
              <BookOpen />
            </span>
            <div className="paper-side-title-copy">
              <h2>{t("paperWorkspace.title")}</h2>
              <span className="mono">{t("paperWorkspace.progress", { progress: paper.progressPercent })}</span>
            </div>
          </div>
        </header>

        <div className="paper-side-scroll app-scrollbar">
          <section className="paper-project-panel">
            <div className="paper-project-title">{paper.title}</div>
            <div className="paper-project-meta">
              <span>{paper.field}</span>
              <span className="mono">{paper.targetWords.toLocaleString(i18n.language)} words</span>
            </div>
            <div className="paper-progress-track" aria-hidden="true">
              <div className="paper-progress-bar" style={{ width: `${paper.progressPercent}%` }} />
            </div>
          </section>

          <section className="paper-side-section">
            <div className="paper-section-head">
              <span>{t("paperWorkspace.sections")}</span>
              <span className="mono">
                {paper.completedSectionCount}/{paper.sections.length}
              </span>
            </div>
            <div className="paper-section-list">
              {paper.sections.map((section) => (
                <button
                  key={section.id}
                  className={[
                    "paper-section-item",
                    `is-${section.status}`,
                    section.id === paper.selectedSectionId ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  onClick={() => paper.selectSection(section.id)}
                >
                  <span className="paper-section-status" aria-hidden="true" />
                  <span className="paper-section-copy">
                    <span className="paper-section-title">{t(`paperWorkspace.sectionNames.${section.titleKey}`)}</span>
                    <span className="paper-section-note">{t(`paperWorkspace.sectionNotes.${section.noteKey}`)}</span>
                  </span>
                  <span className="paper-section-words mono">{section.wordTarget}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="paper-side-section">
            <div className="paper-section-head">
              <span>{t("paperWorkspace.queue")}</span>
              <span className="mono">{paper.activeSectionCount}</span>
            </div>
            <div className="paper-task-list">
              {paper.tasks.map((task) => (
                <article key={task.id} className={`paper-task-item is-${task.status}`}>
                  <div className="paper-task-topline">
                    <span>{t(`paperWorkspace.tasks.${task.titleKey}`)}</span>
                    <span>{statusLabel(task.status)}</span>
                  </div>
                  <p>{t(`paperWorkspace.tasks.${task.descriptionKey}`)}</p>
                </article>
              ))}
            </div>
          </section>
          {children}
        </div>
      </div>
    </aside>
  );
}
