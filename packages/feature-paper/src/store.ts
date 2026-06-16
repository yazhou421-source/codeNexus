import { defineStore } from "./zustandCompat";

export type PaperSectionStatus = "todo" | "drafting" | "review" | "done";
export type PaperGenerationMode = "outline" | "draft" | "revise" | "citations";

export type PaperSection = {
  id: string;
  titleKey: string;
  wordTarget: number;
  status: PaperSectionStatus;
  noteKey: string;
};

export type PaperTask = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  status: PaperSectionStatus;
};

export type PaperReference = {
  id: string;
  title: string;
  meta: string;
  statusKey: string;
};

const DEFAULT_SECTIONS: PaperSection[] = [
  { id: "abstract", titleKey: "abstract", wordTarget: 320, status: "review", noteKey: "abstractNote" },
  { id: "introduction", titleKey: "introduction", wordTarget: 1200, status: "drafting", noteKey: "introductionNote" },
  { id: "related", titleKey: "related", wordTarget: 1800, status: "todo", noteKey: "relatedNote" },
  { id: "method", titleKey: "method", wordTarget: 2200, status: "todo", noteKey: "methodNote" },
  { id: "experiment", titleKey: "experiment", wordTarget: 1800, status: "todo", noteKey: "experimentNote" },
  { id: "conclusion", titleKey: "conclusion", wordTarget: 650, status: "done", noteKey: "conclusionNote" },
];

const DEFAULT_TASKS: PaperTask[] = [
  { id: "scope", titleKey: "scopeTask", descriptionKey: "scopeTaskDesc", status: "done" },
  { id: "outline", titleKey: "outlineTask", descriptionKey: "outlineTaskDesc", status: "review" },
  { id: "draft", titleKey: "draftTask", descriptionKey: "draftTaskDesc", status: "drafting" },
  { id: "citation", titleKey: "citationTask", descriptionKey: "citationTaskDesc", status: "todo" },
];

const DEFAULT_REFERENCES: PaperReference[] = [
  { id: "r1", title: "Transformer-based Academic Writing Assistance", meta: "ACL Anthology / 2024", statusKey: "toVerify" },
  { id: "r2", title: "Human-in-the-loop Draft Revision for Long-form Writing", meta: "CHI / 2023", statusKey: "matched" },
  { id: "r3", title: "Citation Grounding in LLM Generated Documents", meta: "arXiv / 2025", statusKey: "needsSource" },
];

export const usePaperStore = defineStore("paper", {
  state: () => ({
    title: "面向本地 Agent 工作台的论文自动写作系统设计",
    field: "Human-AI Collaboration",
    targetWords: 8000,
    selectedSectionId: "introduction",
    mode: "draft" as PaperGenerationMode,
    researchQuestion:
      "如何将 Codex app-server 的任务执行能力组织成可审计、可回滚、可逐章确认的论文写作流程？",
    constraints:
      "保留用户确认步骤；不得编造引用；所有章节写入前必须输出依据、待核查项和建议修改点。",
    sections: DEFAULT_SECTIONS.map((section) => ({ ...section })) as PaperSection[],
    tasks: DEFAULT_TASKS.map((task) => ({ ...task })) as PaperTask[],
    references: DEFAULT_REFERENCES.map((reference) => ({ ...reference })) as PaperReference[],
  }),
  getters: {
    selectedSection(state): PaperSection {
      return state.sections.find((section) => section.id === state.selectedSectionId) ?? state.sections[0]!;
    },
    completedSectionCount(state): number {
      return state.sections.filter((section) => section.status === "done").length;
    },
    activeSectionCount(state): number {
      return state.sections.filter((section) => section.status === "drafting" || section.status === "review").length;
    },
    totalWordTarget(state): number {
      return state.sections.reduce((sum, section) => sum + section.wordTarget, 0);
    },
    progressPercent(state): number {
      if (state.sections.length === 0) return 0;
      const weighted = state.sections.reduce((sum, section) => {
        if (section.status === "done") return sum + 1;
        if (section.status === "review") return sum + 0.72;
        if (section.status === "drafting") return sum + 0.38;
        return sum;
      }, 0);
      return Math.round((weighted / state.sections.length) * 100);
    },
    promptPreview(state): string {
      const section = state.sections.find((item) => item.id === state.selectedSectionId) ?? state.sections[0];
      const modeLabel: Record<PaperGenerationMode, string> = {
        outline: "生成论文结构和章节提纲",
        draft: "生成选中章节初稿",
        revise: "修订和压缩选中章节",
        citations: "检查引用和证据缺口",
      };
      return [
        `任务：${modeLabel[state.mode]}`,
        `题目：${state.title}`,
        `领域：${state.field}`,
        `选中章节：${section?.titleKey ?? "unknown"} / 目标字数 ${section?.wordTarget ?? 0}`,
        `研究问题：${state.researchQuestion}`,
        `约束：${state.constraints}`,
      ].join("\n");
    },
  },
  actions: {
    selectSection(id: string) {
      if (!this.sections.some((section) => section.id === id)) return;
      this.selectedSectionId = id;
    },
    setMode(mode: PaperGenerationMode) {
      this.mode = mode;
    },
    updateResearchQuestion(value: string) {
      this.researchQuestion = String(value ?? "");
    },
    updateConstraints(value: string) {
      this.constraints = String(value ?? "");
    },
  },
});
