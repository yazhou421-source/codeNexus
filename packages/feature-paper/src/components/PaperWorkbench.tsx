import "./paper-workbench.css";

import { CheckCircle2, CircleAlert, FileText, Quote, Target, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { PAPER_MODE_LABELS, PAPER_SECTION_STATUS_LABELS, usePaperStore } from "../store";

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
  const paper = usePaperStore();
  const selectedSection = paper.selectedSection;

  const outlineItems = useMemo(
    () => [
      { key: "field", label: "领域", value: paper.field },
      { key: "target", label: "章节目标", value: `${selectedSection.wordTarget} words` },
      { key: "mode", label: "生成模式", value: PAPER_MODE_LABELS[paper.mode] },
    ],
    [paper.field, paper.mode, selectedSection.wordTarget],
  );

  const reviewChecks = useMemo<ReviewCheck[]>(
    () => [
      {
        key: "scope",
        kind: "is-ok",
        icon: Target,
        title: "范围一致",
        desc: "章节目标与研究问题保持一致。",
      },
      {
        key: "citation",
        kind: "is-warn",
        icon: Quote,
        title: "引用缺口",
        desc: "存在待核查文献，写入前需要确认来源。",
      },
      {
        key: "integrity",
        kind: "is-ok",
        icon: CheckCircle2,
        title: "人工确认",
        desc: "当前流程保留了逐步审阅点。",
      },
      {
        key: "gap",
        kind: "is-attention",
        icon: CircleAlert,
        title: "待补数据",
        desc: "实验与评价指标仍需从真实材料补齐。",
      },
    ],
    [],
  );

  return (
    <section className={["paper-workbench", className].filter(Boolean).join(" ")} aria-label="论文写作工作台">
      <header className="paper-workbench-toolbar">
        <div className="paper-workbench-title">
          <span className="paper-workbench-title__icon" aria-hidden="true">
            <FileText />
          </span>
          <div>
            <div className="paper-workbench-kicker">论文自动化</div>
            <h1>{paper.title}</h1>
          </div>
        </div>
        <div className="paper-workbench-metrics">
          <div>
            <span>完成度</span>
            <strong>{paper.progressPercent}%</strong>
          </div>
          <div>
            <span>章节</span>
            <strong>
              {paper.completedSectionCount}/{paper.sections.length}
            </strong>
          </div>
          <div>
            <span>目标字数</span>
            <strong>{paper.totalWordTarget.toLocaleString("zh-CN")}</strong>
          </div>
        </div>
      </header>

      <div className="paper-workbench-body">
        <section className="paper-editor-surface">
          <div className="paper-editor-head">
            <div>
              <div className="paper-workbench-kicker">当前章节</div>
              <h2>{selectedSection.title}</h2>
            </div>
            <span className={`paper-section-state is-${selectedSection.status}`}>
              {PAPER_SECTION_STATUS_LABELS[selectedSection.status]}
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
            <p>当前章节会围绕研究问题展开，先明确论文要解决的实际痛点，再把系统能力拆解为可验证的设计目标。生成内容应保留依据、边界和待确认项，避免直接把模型输出当成最终稿。</p>
            <p>论文工作台的核心不是一次性代写，而是把选题、提纲、初稿、修订和引用核查组织成连续流程。每一步都对应可审阅的中间产物，并能在写入正文前让用户确认。</p>
            <p>后续实现可以把这里的章节草稿保存到当前工作区，同时把引用库、生成任务和审阅意见保存在结构化项目文件中，便于版本管理和复现。</p>
          </div>
        </section>

        <section className="paper-review-rail">
          <div className="paper-review-head">
            <span>审阅线索</span>
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
