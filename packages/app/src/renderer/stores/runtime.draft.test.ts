import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCAL_THREAD_COMPOSE_STATE,
  normalizeLocalDraftState,
  upsertLocalDraftThreadState,
} from "@codenexus/shared/localDraftState";
import { buildNewThreadComposeSeed } from "@codenexus/shared/newThreadComposeSeed";
const persistence = vi.hoisted(() => ({
  saveLocalDraftThreadState: vi.fn(),
  saveLocalDraftThreadStates: vi.fn(),
  clearSavedLocalDraftThreadState: vi.fn(),
}));
vi.mock("../domain/localDraftState", () => persistence);
import { useRuntimeStore } from "./runtime.store";
import { createTurnSendDraftRuntime } from "../domain/runtime/turnSendDraftRuntime";
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
const prefs = {
  ...DEFAULT_LOCAL_THREAD_COMPOSE_STATE,
  model: "gpt-6-astra",
  reasoningEffort: "max",
  sandboxMode: "read-only" as const,
  composeMode: "plan" as const,
};
describe("thread draft boundaries", () => {
  it("A/B restores real drafts but never restores __app__ content", () => {
    const store = useRuntimeStore();
    store.hydrateFromLocalDraftState({
      version: 1,
      updatedAt: 1,
      threads: { __app__: { ...prefs, composeInput: "old QA" }, real: { ...prefs, composeInput: "unfinished" } },
    });
    expect(store.composeInput).toBe("");
    expect(store.model).toBe(prefs.model);
    store.setCurrentThread("real");
    expect(store.composeInput).toBe("unfinished");
    expect(store.reasoningEffort).toBe("max");
  });
  it("C/D/E new thread clears content/rewrite and keeps preferences; old draft survives", () => {
    const store = useRuntimeStore();
    store.setCurrentThread("real");
    Object.assign(store, prefs, { composeInput: "draft" });
    store.startHistoryRewrite({ anchorEventId: "event", anchorTurnId: "turn", prefillText: "rewrite" });
    store.setCurrentThread("");
    expect(store.composeInput).toBe("");
    expect(store.composeAttachments).toEqual([]);
    expect(store.composeFileMentions).toEqual([]);
    expect(store.historyRewriteActive).toBe(false);
    expect(store).toMatchObject({
      model: prefs.model,
      reasoningEffort: "max",
      sandboxMode: "read-only",
      composeMode: "plan",
    });
    store.setCurrentThread("real");
    expect(store.composeInput).toBe("draft");
    expect(
      buildNewThreadComposeSeed({
        previousThreadId: "real",
        runtime: prefs,
        global: DEFAULT_LOCAL_THREAD_COMPOSE_STATE,
      })
    ).toMatchObject(prefsWithoutInput());
  });
  it("F accepted send awaits empty persisted state and a restart stays empty", async () => {
    const store = useRuntimeStore();
    store.setCurrentThread("real");
    store.composeInput = "sent";
    await createTurnSendDraftRuntime({ runtimeStore: store }).clearRuntimeStoreDraftAfterSend();
    expect(persistence.saveLocalDraftThreadState).toHaveBeenCalledWith(
      "real",
      expect.objectContaining({ composeInput: "" })
    );
    const saved = persistence.saveLocalDraftThreadState.mock.calls.at(-1)!;
    store.hydrateFromLocalDraftState(normalizeLocalDraftState({ threads: { [saved[0]]: saved[1] } }));
    expect(store.composeInput).toBe("");
  });
  it("serializes only preferences for the blank homepage", () => {
    expect(
      upsertLocalDraftThreadState({}, "__app__", { ...prefs, composeInput: "never persist" }).threads.__app__
    ).toMatchObject({ ...prefs, composeInput: "" });
  });
});
function prefsWithoutInput() {
  const { composeInput: _, ...rest } = prefs;
  return rest;
}
