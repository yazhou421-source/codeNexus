import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { effectScope } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../../api/codexDesktopClient", () => ({ codexDesktop: { app: {}, localState: {} } }));
import type { TimelineEventItem } from "../../../domain/types";
import { parseSessionReplayEvents } from "../../../features/history/replayParsers";
import { useTimelineStore } from "../../../stores/timeline.store";
import { InterruptedTurnStore } from "../../../../main/services/InterruptedTurnStore";
import { useChatRenderModel } from "./useChatRenderModel";

const threadId = "thread-answer";
const turnId = "turn-answer";
const scopes: ReturnType<typeof effectScope>[] = [];

function event(
  id: string,
  method: string,
  text: string,
  params: unknown = {}
): TimelineEventItem & { threadId: string } {
  return { id, method, paramsText: text, params, threadId, turnId, createdAt: 1000, level: "info" };
}

function answer(text: string, phase?: string | null) {
  return event("answer", "item/agentMessage/delta", text, {
    item: { id: "answer", type: "agentMessage", ...(phase === undefined ? {} : { phase }) },
  });
}

function reasoning() {
  return event("reasoning", "item/reasoning/textDelta", "thinking only", { itemId: "reasoning" });
}

function render(events: () => TimelineEventItem[]) {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() =>
    useChatRenderModel(
      events,
      () => 0,
      () => "/fictional",
      () => new Map()
    )
  )!;
}

const visibleAnswers = (model: ReturnType<typeof render>) =>
  model.chatRows.value.filter((row) => row.kind === "assistant").map((row) => row.event.paramsText);

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

describe("assistant answer classification in the actual chat render model", () => {
  it.each([
    ["GPT-5.5", "final_answer"],
    ["DeepSeek V4 Flash", null],
    ["DeepSeek V4 Pro", undefined],
    ["DeepSeek R1", null],
    ["Kimi compatible adapter", undefined],
  ] as const)("shows %s final text directly and keeps intermediate content collapsed", (_model, phase) => {
    const commentary = answer("intermediate commentary", "commentary");
    commentary.id = "commentary";
    const tool = event("tool", "command/exec/outputDelta", "", { deltaBase64: "dG9vbCBvbmx5" });
    const model = render(() => [reasoning(), commentary, tool, answer("visible final", phase)]);
    expect(visibleAnswers(model)).toEqual(["visible final"]);
    const groups = model.chatRows.value.filter((row) => row.kind === "auxActivityGroup");
    expect(groups).toHaveLength(1);
    expect(groups[0].defaultCollapsed).toBe(true);
    expect(groups[0].items.map((row) => row.kind)).toEqual(["reasoningBlock", "assistantCommentary", "activity"]);
  });

  it("never promotes reasoning-only or explicit commentary into an answer", () => {
    const model = render(() => [reasoning(), answer("still intermediate", "commentary")]);
    expect(visibleAnswers(model)).toEqual([]);
    expect(model.chatRows.value).toMatchObject([{ kind: "auxActivityGroup", defaultCollapsed: true }]);
  });

  it.each(["final_answer", null, undefined, ""])("shows a final-only reply with phase %s once", (phase) => {
    const model = render(() => [answer("just the answer", phase)]);
    expect(visibleAnswers(model)).toEqual(["just the answer"]);
    expect(model.chatRows.value).toHaveLength(1);
  });

  it("updates streamed text and replaces the completed item without duplicate rows", () => {
    const timeline = useTimelineStore();
    const model = render(() => timeline.eventsForThread(threadId));
    const { paramsText: _text, ...base } = answer("");
    timeline.appendToEvent({ ...base, chunk: "Hello" });
    timeline.flushPendingAppends();
    expect(visibleAnswers(model)).toEqual(["Hello"]);
    timeline.appendToEvent({ ...base, chunk: " world" });
    timeline.flushPendingAppends();
    expect(visibleAnswers(model)).toEqual(["Hello world"]);
    timeline.upsertEvent({ ...base, paramsText: "Hello world" });
    timeline.upsertEvent({ ...base, paramsText: "Hello world" });
    expect(visibleAnswers(model)).toEqual(["Hello world"]);
    expect(model.chatRows.value).toHaveLength(1);
  });

  it.each(["final_answer", undefined])("replays completed session text with phase %s directly", (phase) => {
    const events = parseSessionReplayEvents(
      [
        { type: "turn_context", payload: { turn_id: turnId }, lineNo: 0 },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            phase,
            content: [{ type: "output_text", text: "saved final" }],
          },
          lineNo: 1,
        },
      ],
      threadId
    );
    const model = render(() =>
      events.map((e) => ({ ...e, threadId, createdAt: e.createdAt ?? 1000, level: e.level ?? "info" }))
    );
    expect(visibleAnswers(model)).toEqual(["saved final"]);
  });

  it("restores unphased partial final text from the existing stop journal without resuming or duplication", () => {
    const root = mkdtempSync(join(tmpdir(), "calmnova-answer-"));
    try {
      const journal = new InterruptedTurnStore(root);
      const notify = (method: string, params: object) =>
        journal.observe({ kind: "notification", method, params: { threadId, turnId, ...params } });
      notify("turn/started", {});
      notify("item/started", { item: { type: "agentMessage", id: "answer", text: "", phase: null } });
      notify("item/agentMessage/delta", { itemId: "answer", delta: "partial final" });
      notify("turn/completed", { turn: { id: turnId, status: "interrupted" } });
      expect(notify("item/agentMessage/delta", { itemId: "answer", delta: "late" })).toBe(false);
      const snapshot = new InterruptedTurnStore(root).read(threadId)[0];
      const replay = parseSessionReplayEvents(
        [{ type: "calmnova_interrupted_turn", payload: snapshot, lineNo: 0 }],
        threadId
      );
      const model = render(() =>
        replay.map((e) => ({ ...e, threadId, createdAt: e.createdAt ?? 1000, level: e.level ?? "info" }))
      );
      expect(visibleAnswers(model)).toEqual(["partial final"]);
      expect(snapshot.status).toBe("interrupted");
      expect(model.chatRows.value.filter((row) => row.kind === "system")).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
