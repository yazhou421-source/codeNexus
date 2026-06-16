import { defineStore } from "./zustandCompat";
import type { TimelineEventItem, TimelineEventLevel } from "../domain/types";

const MAX_ITEMS_PER_THREAD = 2000;
const MAX_PARAMS_CHARS = 12_000;

type DebugThreadState = {
  loaded: boolean;
  items: TimelineEventItem[];
};

function ensureThreadId(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || "__app__";
}

function trimText(value: string, maxChars: number): string {
  const text = String(value ?? "");
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}

function toDebugEventId(threadId: string, method: string, createdAt: number) {
  const rand = Math.random().toString(16).slice(2);
  return `dbg:${method}:${threadId}:${createdAt}:${rand}`;
}

export const useDebugTimelineStore = defineStore("debugTimeline", {
  state: () => ({
    threads: new Map<string, DebugThreadState>(),
  }),
  getters: {
    eventsForThread(state): (threadId: string) => TimelineEventItem[] {
      return (threadIdValue: string) => {
        const threadId = ensureThreadId(threadIdValue);
        const threadState = state.threads.get(threadId);
        return threadState?.items ?? [];
      };
    },
  },
  actions: {
    ensureThread(threadIdValue: string): DebugThreadState {
      const threadId = ensureThreadId(threadIdValue);
      const existing = this.threads.get(threadId);
      if (existing) return existing;
      const created: DebugThreadState = { loaded: false, items: [] };
      this.threads.set(threadId, created);
      return created;
    },
    loadThread(threadIdValue: string) {
      const threadId = ensureThreadId(threadIdValue);
      const state = this.ensureThread(threadId);
      if (state.loaded) return;
      state.loaded = true;
    },
    clearThread(threadIdValue: string) {
      const threadId = ensureThreadId(threadIdValue);
      this.threads.delete(threadId);
    },
    appendEvent(params: {
      threadId: string;
      method: string;
      paramsText: string;
      params?: unknown;
      turnId?: string;
      level?: TimelineEventLevel;
      id?: string;
      hidden?: boolean;
      createdAt?: number;
    }) {
      const threadId = ensureThreadId(params.threadId);
      const state = this.ensureThread(threadId);
      if (!state.loaded) this.loadThread(threadId);

      const createdAt = Number.isFinite(params.createdAt) ? Number(params.createdAt) : Date.now();
      const method = String(params.method ?? "").trim();
      const id = String(params.id ?? "").trim() || toDebugEventId(threadId, method || "event", createdAt);

      const paramsText = trimText(String(params.paramsText ?? ""), MAX_PARAMS_CHARS);
      const event: TimelineEventItem = {
        id,
        method,
        paramsText,
        params: params.params,
        createdAt,
        threadId,
        turnId: params.turnId,
        level: params.level ?? "info",
        hidden: params.hidden ?? true,
      };

      state.items.push(event);
      if (state.items.length > MAX_ITEMS_PER_THREAD) {
        state.items.splice(0, state.items.length - MAX_ITEMS_PER_THREAD);
      }
    },
  },
});
