import "./paper-workbench.css";

import { BookOpen } from "lucide-react";
import { type ReactNode } from "react";
import { PAPER_SECTION_STATUS_LABELS, usePaperStore, type PaperSectionStatus } from "../store";

type PaperWorkspaceSidebarProps = {
  className?: string;
  children?: ReactNode;
};

export default function PaperWorkspaceSidebar({ className, children }: PaperWorkspaceSidebarProps) {
  const paper = usePaperStore();

  function statusLabel(status: PaperSectionStatus): string {
    return PAPER_SECTION_STATUS_LABELS[status];
  }

  return (
    <aside className={["sidebar sidebar-left paper-workspace-sidebar", className].filter(Boolean).join(" ")} aria-label="论文工作区">
      <div className="paper-side-shell">
        <header className="paper-side-head">
          <div className="paper-side-title-block">
            <span className="paper-side-icon" aria-hidden="true">
              <BookOpen />
            </span>
            <div className="paper-side-title-copy">
              <h2>论文工作区</h2>
              <span className="mono">{`完成度 ${paper.progressPercent}%`}</span>
            </div>
          </div>
        </header>

        <div className="paper-side-scroll app-scrollbar">
          <section className="paper-project-panel">
            <div className="paper-project-title">{paper.title}</div>
            <div className="paper-project-meta">
              <span>{paper.field}</span>
              <span className="mono">{paper.targetWords.toLocaleString("zh-CN")} words</span>
            </div>
            <div className="paper-progress-track" aria-hidden="true">
              <div className="paper-progress-bar" style={{ width: `${paper.progressPercent}%` }} />
            </div>
          </section>

          <section className="paper-side-section">
            <div className="paper-section-head">
              <span>章节结构</span>
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
                    <span className="paper-section-title">{section.title}</span>
                    <span className="paper-section-note">{section.note}</span>
                  </span>
                  <span className="paper-section-words mono">{section.wordTarget}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="paper-side-section">
            <div className="paper-section-head">
              <span>生成队列</span>
              <span className="mono">{paper.activeSectionCount}</span>
            </div>
            <div className="paper-task-list">
              {paper.tasks.map((task) => (
                <article key={task.id} className={`paper-task-item is-${task.status}`}>
                  <div className="paper-task-topline">
                    <span>{task.title}</span>
                    <span>{statusLabel(task.status)}</span>
                  </div>
                  <p>{task.description}</p>
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
