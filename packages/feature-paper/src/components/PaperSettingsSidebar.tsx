import "./paper-workbench.css";

import { ClipboardCopy, FilePenLine, ListTree, Quote, ScanSearch, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { showPaperToast } from "../runtimeBridge";
import { PAPER_MODE_LABELS, usePaperStore, type PaperGenerationMode } from "../store";

type PaperSettingsSidebarProps = {
  className?: string;
  children?: ReactNode;
};

const modes: Array<{ value: PaperGenerationMode; label: string; icon: LucideIcon }> = [
  { value: "outline", label: PAPER_MODE_LABELS.outline, icon: ListTree },
  { value: "draft", label: PAPER_MODE_LABELS.draft, icon: FilePenLine },
  { value: "revise", label: PAPER_MODE_LABELS.revise, icon: ScanSearch },
  { value: "citations", label: PAPER_MODE_LABELS.citations, icon: Quote },
];

export default function PaperSettingsSidebar({ className, children }: PaperSettingsSidebarProps) {
  const paper = usePaperStore();
  const selectedSectionWords = `${paper.selectedSection.wordTarget}w`;
  const localizedPrompt = useMemo(
    () =>
      [
        `任务: ${PAPER_MODE_LABELS[paper.mode]}`,
        `题目: ${paper.title}`,
        `领域: ${paper.field}`,
        `章节: ${paper.selectedSection.title}`,
        `研究问题: ${paper.researchQuestion}`,
        `约束: ${paper.constraints}`,
      ].join("\n"),
    [paper.constraints, paper.field, paper.mode, paper.researchQuestion, paper.selectedSection.title, paper.title],
  );

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(localizedPrompt);
      showPaperToast({ kind: "success", message: "论文生成提示词已复制。" });
    } catch (error) {
      showPaperToast({ kind: "error", message: String((error as Error)?.message ?? error) });
    }
  }

  return (
    <aside className={["sidebar sidebar-right paper-settings-sidebar", className].filter(Boolean).join(" ")} aria-label="论文生成控制">
      <header className="paper-settings-head">
        <div>
          <div className="paper-settings-eyebrow">Paper</div>
          <h2>生成控制</h2>
        </div>
        <span className="paper-settings-badge mono">{selectedSectionWords}</span>
      </header>

      <div className="paper-settings-scroll app-scrollbar">
        <section className="paper-settings-section">
          <div className="paper-control-label">生成模式</div>
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
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="paper-settings-section">
          <label className="paper-field">
            <span>研究问题</span>
            <textarea
              className="paper-textarea"
              rows={5}
              value={paper.researchQuestion}
              onChange={(event) => paper.updateResearchQuestion(event.currentTarget.value)}
            />
          </label>

          <label className="paper-field">
            <span>写作约束</span>
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
            <span>资料与引用</span>
            <span className="mono">{paper.references.length}</span>
          </div>
          <div className="paper-reference-list">
            {paper.references.map((reference) => (
              <article key={reference.id} className="paper-reference-item">
                <div className="paper-reference-title">{reference.title}</div>
                <div className="paper-reference-meta">
                  <span>{reference.meta}</span>
                  <span>{reference.status}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="paper-settings-section">
          <div className="paper-section-head">
            <span>任务提示词</span>
          </div>
          <pre className="paper-prompt-preview app-scrollbar">{localizedPrompt}</pre>
          <button className="paper-primary-action" type="button" onClick={() => void copyPrompt()}>
            <ClipboardCopy aria-hidden="true" />
            <span>复制提示词</span>
          </button>
        </section>
        {children}
      </div>
    </aside>
  );
}
