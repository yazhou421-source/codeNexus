import "./paper-workbench.css";

import { CheckCircle2, CircleAlert, FileText, Quote, Target, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePaperStore } from "../store";

type PaperWorkbenchProps = {
  className?: string;
  children?: ReactNode;
};

type ReviewCheck = {
  key: string;
  kind: "is-ok" | "is-warn" | "is-attention";
  icon: LucideIcon;
  title: string;
  desc: string;
};

export default function PaperWorkbench({ className, children }: PaperWorkbenchProps) {
  const { t, i18n } = useTranslation();
  const paper = usePaperStore();
  const selectedSection = paper.selectedSection;

  const outlineItems = useMemo(
    () => [
      { key: "field", label: t("paperWorkbench.field"), value: paper.field },
      { key: "target", label: t("paperWorkbench.sectionTarget"), value: `${selectedSection.wordTarget} words` },
      { key: "mode", label: t("paperWorkbench.generationMode"), value: t(`paperSidebar.modes.${paper.mode}`) },
    ],
    [paper.field, paper.mode, selectedSection.wordTarget, t],
  );

  const reviewChecks = useMemo<ReviewCheck[]>(
    () => [
      {
        key: "scope",
        kind: "is-ok",
        icon: Target,
        title: t("paperWorkbench.checks.scopeTitle"),
        desc: t("paperWorkbench.checks.scopeDesc"),
      },
      {
        key: "citation",
        kind: "is-warn",
        icon: Quote,
        title: t("paperWorkbench.checks.citationTitle"),
        desc: t("paperWorkbench.checks.citationDesc"),
      },
      {
        key: "integrity",
        kind: "is-ok",
        icon: CheckCircle2,
        title: t("paperWorkbench.checks.integrityTitle"),
        desc: t("paperWorkbench.checks.integrityDesc"),
      },
      {
        key: "gap",
        kind: "is-attention",
        icon: CircleAlert,
        title: t("paperWorkbench.checks.gapTitle"),
        desc: t("paperWorkbench.checks.gapDesc"),
      },
    ],
    [t],
  );

  return (
    <section className={["paper-workbench", className].filter(Boolean).join(" ")} aria-label={t("paperWorkbench.aria")}>
      <header className="paper-workbench-toolbar">
        <div className="paper-workbench-title">
          <span className="paper-workbench-title__icon" aria-hidden="true">
            <FileText />
          </span>
          <div>
            <div className="paper-workbench-kicker">{t("paperWorkbench.kicker")}</div>
            <h1>{paper.title}</h1>
          </div>
        </div>
        <div className="paper-workbench-metrics">
          <div>
            <span>{t("paperWorkbench.progress")}</span>
            <strong>{paper.progressPercent}%</strong>
          </div>
          <div>
            <span>{t("paperWorkbench.sections")}</span>
            <strong>
              {paper.completedSectionCount}/{paper.sections.length}
            </strong>
          </div>
          <div>
            <span>{t("paperWorkbench.words")}</span>
            <strong>{paper.totalWordTarget.toLocaleString(i18n.language)}</strong>
          </div>
        </div>
      </header>

      <div className="paper-workbench-body">
        <section className="paper-editor-surface">
          <div className="paper-editor-head">
            <div>
              <div className="paper-workbench-kicker">{t("paperWorkbench.currentSection")}</div>
              <h2>{t(`paperWorkspace.sectionNames.${selectedSection.titleKey}`)}</h2>
            </div>
            <span className={`paper-section-state is-${selectedSection.status}`}>
              {t(`paperWorkspace.status.${selectedSection.status}`)}
            </span>
          </div>

          <div className="paper-outline-grid">
            {outlineItems.map((item) => (
              <article key={item.key} className="paper-outline-item">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>

          <div className="paper-draft-sheet app-scrollbar">
            <p>{t("paperWorkbench.paragraphA")}</p>
            <p>{t("paperWorkbench.paragraphB")}</p>
            <p>{t("paperWorkbench.paragraphC")}</p>
          </div>
        </section>

        <section className="paper-review-rail">
          <div className="paper-review-head">
            <span>{t("paperWorkbench.reviewRail")}</span>
            <span className="mono">{paper.mode}</span>
          </div>
          <div className="paper-review-list app-scrollbar">
            {reviewChecks.map((check) => {
              const Icon = check.icon;
              return (
                <article key={check.key} className={`paper-review-item ${check.kind}`}>
                  <Icon aria-hidden="true" />
                  <div>
                    <strong>{check.title}</strong>
                    <p>{check.desc}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
      {children}
    </section>
  );
}
