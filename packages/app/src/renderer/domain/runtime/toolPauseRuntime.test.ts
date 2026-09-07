import { describe, expect, it, vi } from "vitest";
import { createToolPauseRuntime } from "./toolPauseRuntime";
import { parseToolPause, TOOL_PAUSE_CONTINUE_PROMPT } from "../toolPause";
import type { TimelineEventItem } from "../types";
import { toolPauseChat } from "../../../../../router/src/tool-loop-guard.js";

const text = toolPauseChat({ reason: "tool_loop_guard", detail: "exact_repeat", rounds: 3, limit: 16 }).choices[0]
  .message.content;
const pause = {
  id: "pause",
  threadId: "thread",
  turnId: "turn",
  paramsText: text,
  method: "item/agentMessage/delta",
} as TimelineEventItem;

describe("tool pause transport and continuation", () => {
  it("parses the actual Router envelope and persisted legacy responses", () => {
    expect(parseToolPause(text)).toMatchObject({ reason: "tool_loop_guard", rounds: 3 });
    expect(parseToolPause("CodexBridge stopped repeated tool loop：diagnostic")).toMatchObject({
      detail: "legacy_guard",
    });
    expect(parseToolPause("normal answer mentions tool_loop_guard")).toBeNull();
    expect(parseToolPause("<!-- calmnova:tool-pause:v1 {")).toBeNull();
  });
  it("continues the same task once with retained-context instructions and leaves its events intact", async () => {
    let resolve!: (ok: boolean) => void;
    const send = vi.fn(
      (_text: string) =>
        new Promise<boolean>((r) => {
          resolve = r;
        })
    );
    const events = [pause];
    const resume = createToolPauseRuntime({
      currentThreadId: () => "thread",
      isRunning: () => false,
      events: () => events,
      send,
    });
    const first = resume("thread", "pause");
    expect(await resume("thread", "pause")).toBe(false);
    expect(send).toHaveBeenCalledExactlyOnceWith(TOOL_PAUSE_CONTINUE_PROMPT);
    expect(send.mock.calls[0][0]).toContain("不重复已经完成的检查");
    expect(events).toEqual([pause]);
    resolve(true);
    expect(await first).toBe(true);
  });
  it("refuses stale, switched or running tasks", async () => {
    const send = vi.fn(async () => true);
    const resume = createToolPauseRuntime({
      currentThreadId: () => "thread",
      isRunning: () => false,
      events: () => [pause, { ...pause, id: "next", turnId: "later" }],
      send,
    });
    expect(await resume("thread", "pause")).toBe(false);
    expect(await resume("other", "pause")).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("allows retry after a failed send", async () => {
    const send = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const resume = createToolPauseRuntime({
      currentThreadId: () => "thread",
      isRunning: () => false,
      events: () => [pause],
      send,
    });
    expect(await resume("thread", "pause")).toBe(false);
    expect(await resume("thread", "pause")).toBe(true);
  });
});
