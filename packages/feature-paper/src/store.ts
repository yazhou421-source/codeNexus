import { defineStore } from "./zustandCompat";

export type PaperSectionStatus = "todo" | "drafting" | "review" | "done";
export type PaperGenerationMode = "outline" | "draft" | "revise" | "citations";

export type PaperSection = {
  id: string;
  title: string;
  wordTarget: number;
  status: PaperSectionStatus;
  note: string;
};

export type PaperTask = {
  id: string;
  title: string;
  description: string;
  status: PaperSectionStatus;
};

export type PaperReference = {
  id: string;
  title: string;
  meta: string;
  status: string;
};

export const PAPER_SECTION_STATUS_LABELS: Record<PaperSectionStatus, string> = {
  todo: "待处理",
  drafting: "生成中",
  review: "待审阅",
  done: "已完成",
};

export const PAPER_MODE_LABELS: Record<PaperGenerationMode, string> = {
  outline: "提纲",
  draft: "初稿",
  revise: "修订",
  citations: "引用",
};

const DEFAULT_SECTIONS: PaperSection[] = [
  { id: "abstract", title: "摘要", wordTarget: 320, status: "review", note: "问题、方法、贡献压缩表达" },
  { id: "introduction", title: "引言", wordTarget: 1200, status: "drafting", note: "研究背景与问题定义" },
  { id: "related", title: "相关工作", wordTarget: 1800, status: "todo", note: "按主题组织已有研究" },
  { id: "method", title: "方法设计", wordTarget: 2200, status: "todo", note: "系统流程和关键设计" },
  { id: "experiment", title: "实验与分析", wordTarget: 1800, status: "todo", note: "评价指标、数据和结果" },
  { id: "conclusion", title: "结论", wordTarget: 650, status: "done", note: "贡献、限制与未来工作" },
];

const DEFAULT_TASKS: PaperTask[] = [
  { id: "scope", title: "确定范围", description: "题目、研究问题和目标读者已锁定。", status: "done" },
  { id: "outline", title: "生成提纲", description: "章节结构已生成，等待人工确认。", status: "review" },
  { id: "draft", title: "逐章初稿", description: "当前按章节生成正文并保留证据缺口。", status: "drafting" },
  { id: "citation", title: "引用核查", description: "等待补充真实文献和引用位置。", status: "todo" },
];

const DEFAULT_REFERENCES: PaperReference[] = [
  { id: "r1", title: "Transformer-based Academic Writing Assistance", meta: "ACL Anthology / 2024", status: "待核查" },
  { id: "r2", title: "Human-in-the-loop Draft Revision for Long-form Writing", meta: "CHI / 2023", status: "已匹配" },
  { id: "r3", title: "Citation Grounding in LLM Generated Documents", meta: "arXiv / 2025", status: "缺来源" },
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
        `选中章节：${section?.title ?? "unknown"} / 目标字数 ${section?.wordTarget ?? 0}`,
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
