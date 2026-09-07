import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useTimelineStore } from "./timeline.store";

describe("renderer agent message streaming", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("makes incremental deltas visible before the final item", () => {
    const store = useTimelineStore();
    const event = {
      threadId: "thread-stream",
      id: "notif:item/agentMessage/delta:thread-stream:turn-stream:item-stream",
      method: "item/agentMessage/delta",
      turnId: "turn-stream",
    };

    store.appendToEvent({ ...event, chunk: "Hel" });
    store.flushPendingAppends();
    expect(store.eventsForThread("thread-stream")[0]?.paramsText).toBe("Hel");
    store.appendToEvent({ ...event, chunk: "lo" });
    store.flushPendingAppends();
    expect(store.eventsForThread("thread-stream")[0]?.paramsText).toBe("Hello");
  });

  it("replaces accumulated deltas with authoritative final text without duplication", () => {
    const store = useTimelineStore();
    const event = {
      threadId: "thread-stream",
      id: "notif:item/agentMessage/delta:thread-stream:turn-stream:item-stream",
      method: "item/agentMessage/delta",
      turnId: "turn-stream",
    };
    store.appendToEvent({ ...event, chunk: "Hello" });
    store.flushPendingAppends();

    store.upsertEvent({ ...event, paramsText: "Hello world" });

    expect(store.eventsForThread("thread-stream")).toHaveLength(1);
    expect(store.eventsForThread("thread-stream")[0]?.paramsText).toBe("Hello world");
  });
});
