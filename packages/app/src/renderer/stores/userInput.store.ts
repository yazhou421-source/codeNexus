// 用户问答 Store：接收 requestUserInput 事件、维护题目队列，并回包用户答案。
import { defineStore } from "./zustandCompat";
import type { UserInputPrompt, UserInputQuestion } from "../domain/types";

type StoredUserInputPrompt = {
  kind: "questions" | "elicitationForm" | "elicitationUrl";
  serverId: string;
  requestId: number | string;
  method: "item/tool/requestUserInput" | "mcpServer/elicitation/request";
  threadId?: string;
  turnId?: string;
  itemId?: string;
  questions: UserInputQuestion[];
  serverName?: string;
  message?: string;
  requestedSchema?: unknown;
  url?: string;
  elicitationId?: string;
};

type ThreadUserInputState = {
  activePrompt: StoredUserInputPrompt | null;
  activeStep: number;
  pendingQueue: StoredUserInputPrompt[];
  draftByQuestion: Map<string, string[]>;
};

type EnsureThreadResult = {
  threadId: string;
  state: ThreadUserInputState;
};

function clearPromptDrafts(state: ThreadUserInputState, prompt: StoredUserInputPrompt) {
  for (const question of prompt.questions) {
    state.draftByQuestion.delete(makeDraftKey(prompt.requestId, question.id));
  }
}

function normalizeThreadId(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeRequestId(value: number | string): string {
  return String(value ?? "").trim();
}

// 草稿缓存键：同一 request 下按 question 维度区分。
function makeDraftKey(requestId: number | string, questionId: string): string {
  return `${String(requestId)}:${String(questionId)}`;
}

export const useUserInputStore = defineStore("userInput", {
  state: () => ({
    byThreadId: new Map<string, ThreadUserInputState>(),
  }),
  getters: {
    queueSizeForThread(state) {
      return (threadIdValue: string): number => {
        const threadId = normalizeThreadId(threadIdValue);
        if (!threadId) return 0;
        const thread = state.byThreadId.get(threadId);
        if (!thread) return 0;
        return thread.pendingQueue.length + (thread.activePrompt ? 1 : 0);
      };
    },
    activePromptForThread(state) {
      return (threadIdValue: string): UserInputPrompt | null => {
        const threadId = normalizeThreadId(threadIdValue);
        if (!threadId) return null;
        const activePrompt = state.byThreadId.get(threadId)?.activePrompt ?? null;
        return activePrompt as UserInputPrompt | null;
      };
    },
    activeStepForThread(state) {
      return (threadIdValue: string): number => {
        const threadId = normalizeThreadId(threadIdValue);
        if (!threadId) return 0;
        return state.byThreadId.get(threadId)?.activeStep ?? 0;
      };
    },
    totalQueueSize(state): number {
      let total = 0;
      for (const thread of state.byThreadId.values()) {
        total += thread.pendingQueue.length + (thread.activePrompt ? 1 : 0);
      }
      return total;
    },
  },
  actions: {
    ensureThread(threadIdValue: unknown): EnsureThreadResult | null {
      const threadId = normalizeThreadId(threadIdValue);
      if (!threadId) return null;
      let state = this.byThreadId.get(threadId) ?? null;
      if (!state) {
        state = {
          activePrompt: null,
          activeStep: 0,
          pendingQueue: [],
          draftByQuestion: new Map<string, string[]>(),
        };
        this.byThreadId.set(threadId, state);
      }
      return { threadId, state } as EnsureThreadResult;
    },
    // 读取某题草稿答案。
    getDraft(threadIdValue: string, requestId: number | string, questionId: string): string[] {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return [];
      return thread.state.draftByQuestion.get(makeDraftKey(requestId, questionId)) ?? [];
    },
    // 写入某题草稿；空数组视为删除草稿。
    setDraft(threadIdValue: string, requestId: number | string, questionId: string, answers: string[]) {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return;
      const key = makeDraftKey(requestId, questionId);
      const normalized = answers.map((answer) => String(answer ?? "").trim()).filter(Boolean);
      if (normalized.length === 0) {
        thread.state.draftByQuestion.delete(key);
        return;
      }
      thread.state.draftByQuestion.set(key, normalized);
    },
    // prompt 完成后删除关联草稿，避免跨题单污染。
    clearDraftForPrompt(threadIdValue: string, prompt: UserInputPrompt) {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return;
      clearPromptDrafts(thread.state, prompt as StoredUserInputPrompt);
    },
    // 判断当前激活题单中某题是否已作答。
    isQuestionAnswered(threadIdValue: string, questionId: string): boolean {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return false;
      const prompt = thread.state.activePrompt;
      if (!prompt) return false;
      const question = prompt.questions.find((item) => item.id === questionId);
      if (!question) return false;
      const answers = this.getDraft(thread.threadId, prompt.requestId, questionId);
      if (answers.length > 0) return true;
      if (question.options.length === 0) return false;
      return false;
    },
    // 切换到指定题目索引（自动做边界收敛）。
    setStep(threadIdValue: string, next: number) {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return;
      const prompt = thread.state.activePrompt;
      if (!prompt) {
        thread.state.activeStep = 0;
        return;
      }
      const max = Math.max(0, prompt.questions.length - 1);
      const safe = Math.max(0, Math.min(Number.isFinite(next) ? Math.trunc(next) : 0, max));
      thread.state.activeStep = safe;
    },
    nextStep(threadIdValue: string) {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return;
      this.setStep(thread.threadId, thread.state.activeStep + 1);
    },
    prevStep(threadIdValue: string) {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return;
      this.setStep(thread.threadId, thread.state.activeStep - 1);
    },
    // 新题单入队；若当前空闲则立即激活。
    enqueuePrompt(prompt: UserInputPrompt, opts?: { threadIdFallback?: string }) {
      const resolvedThreadId = normalizeThreadId(prompt.threadId) || normalizeThreadId(opts?.threadIdFallback);
      const thread = this.ensureThread(resolvedThreadId);
      if (!thread) return;
      const normalizedPrompt = (
        resolvedThreadId === normalizeThreadId(prompt.threadId) ? prompt : { ...prompt, threadId: resolvedThreadId }
      ) as StoredUserInputPrompt;
      thread.state.pendingQueue.push(normalizedPrompt);
      if (!thread.state.activePrompt) {
        thread.state.activePrompt = thread.state.pendingQueue.shift() ?? null;
        thread.state.activeStep = 0;
      }
    },
    // 完成当前题单并切换到下一条待处理题单。
    completeActivePrompt(threadIdValue: string) {
      const thread = this.ensureThread(threadIdValue);
      if (!thread) return;
      const finished = thread.state.activePrompt;
      if (finished) clearPromptDrafts(thread.state, finished);
      thread.state.activePrompt = thread.state.pendingQueue.shift() ?? null;
      thread.state.activeStep = 0;
    },
    removePrompt(threadIdValue: string, requestId: number | string) {
      const threadId = normalizeThreadId(threadIdValue);
      if (!threadId) return;
      const state = this.byThreadId.get(threadId);
      if (!state) return;
      const requestKey = normalizeRequestId(requestId);
      const activePrompt = state.activePrompt;
      if (activePrompt && normalizeRequestId(activePrompt.requestId) === requestKey) {
        this.completeActivePrompt(threadId);
        return;
      }

      const pendingQueue = state.pendingQueue;
      const idx = pendingQueue.findIndex((item) => normalizeRequestId(item.requestId) === requestKey);
      if (idx < 0) return;
      const removed = pendingQueue[idx] ?? null;
      const draftKeys = removed
        ? removed.questions.map((question) => makeDraftKey(removed.requestId, question.id))
        : [];
      pendingQueue.splice(idx, 1);
      for (const key of draftKeys) state.draftByQuestion.delete(key);
    },
    // 全量重置问答状态（断连、切会话或用户手动取消时使用）。
    resetThread(threadIdValue: string) {
      const threadId = normalizeThreadId(threadIdValue);
      if (!threadId) return;
      this.byThreadId.delete(threadId);
    },
    resetAll() {
      this.byThreadId.clear();
    },
  },
});
