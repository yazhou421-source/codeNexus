import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryStore } from "../historyStore";
import { parseSessionReplayEvents } from "../../renderer/features/history/replayParsers";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const threadId = "test-thread",
  turnId = "test-turn";
const startedAt = "2026-09-06T10:00:00.000Z";
const entry = (type: string, payload: unknown) => ({ type, payload, timestamp: startedAt, lineNo: 0 });
const session = [
  entry("session_meta", { id: threadId, cwd: "/fictional/trial" }),
  entry("turn_context", { turn_id: turnId }),
  entry("response_item", { type: "message", role: "user", content: [{ type: "input_text", text: "test task" }] }),
];
const assistant = (text: string) =>
  entry("response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const aborted = entry("event_msg", { type: "turn_aborted", turn_id: turnId });
function setup() {
  const root = mkdtempSync(join(tmpdir(), "calmnova-interrupt-"));
  dirs.push(root);
  const sessions = join(root, "sessions");
  mkdirSync(sessions);
  const file = join(sessions, "rollout-test.jsonl");
  const cache = join(root, "history.json");
  const history = new HistoryStore(cache, sessions);
  const journal = history.interruptedTurns;
  const notify = (method: string, params: object) =>
    journal.observe({ kind: "notification", method, params: { threadId, turnId, ...params } });
  const write = (records: typeof session) =>
    writeFileSync(file, records.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const start = () => notify("turn/started", { turn: { id: turnId } });
  const delta = (text: string) => notify("item/agentMessage/delta", { itemId: "message-1", delta: text });
  const stop = (status = "interrupted") => notify("turn/completed", { turn: { id: turnId, status } });
  const replay = async (reader = new HistoryStore(cache, sessions)) => {
    await reader.refreshDisk();
    const page = await reader.getThreadEvents(threadId, { includeAux: false, limit: 100 });
    return parseSessionReplayEvents(page.entries, threadId);
  };
  return { journal, notify, start, delta, stop, write, replay, file, root, history };
}
const texts = (events: ReturnType<typeof parseSessionReplayEvents>) =>
  events.filter((e) => e.method === "item/agentMessage/delta").map((e) => e.paramsText);

describe("desktop interrupted reply persistence and replay", () => {
  it("keeps normal completed replies in the existing session format", async () => {
    const f = setup();
    f.write([...session, assistant("normal reply")]);
    f.start();
    f.delta("normal reply");
    f.notify("item/completed", { item: { id: "message-1", type: "agentMessage", text: "normal reply" } });
    f.stop("completed");
    expect(f.journal.read(threadId)).toEqual([]);
    expect(texts(await f.replay())).toEqual(["normal reply"]);
  });
  it("persists displayed partial text before stop returns and restores it on a fresh history reader", async () => {
    const f = setup();
    f.write([...session, aborted]);
    const original = readFileSync(f.file, "utf8");
    // This is exactly the old session-only replay failure: no assistant response_item exists.
    expect(texts(parseSessionReplayEvents([...session, aborted], threadId))).toEqual([]);
    f.start();
    f.delta("第一段\n");
    f.delta("第二段");
    f.stop();
    expect(f.journal.read(threadId)[0].messages[0].text).toBe("第一段\n第二段");
    const replay = await f.replay();
    expect(texts(replay)).toEqual(["第一段\n第二段"]);
    expect(replay.filter((e) => e.method === "local/turnInterrupted")).toHaveLength(1);
    expect(readFileSync(f.file, "utf8")).toBe(original);
  });
  it("does not overwrite a stop with late deltas, empty completions or duplicate terminal events", async () => {
    const f = setup();
    f.write([...session, aborted]);
    f.start();
    f.delta("keep me");
    f.stop();
    const before = f.journal.read(threadId);
    expect(f.delta("late data")).toBe(false);
    f.notify("item/completed", { item: { id: "message-1", type: "agentMessage", text: "" } });
    f.stop("completed");
    f.stop();
    expect(f.journal.read(threadId)).toEqual(before);
    expect(texts(await f.replay())).toEqual(["keep me"]);
    expect(texts(await f.replay())).toEqual(["keep me"]);
  });
  it("retains deltas when cancellation sends an empty item completion", async () => {
    const f = setup();
    f.write([...session, aborted]);
    f.start();
    f.delta("partial");
    f.notify("item/completed", { item: { id: "message-1", type: "agentMessage", text: "" } });
    f.stop();
    expect(texts(await f.replay())).toEqual(["partial"]);
  });
  it("does not duplicate completed commentary when a later item is interrupted", async () => {
    const f = setup();
    f.write([...session, assistant("commentary"), aborted]);
    f.start();
    f.delta("commentary");
    f.notify("item/completed", { item: { id: "message-1", type: "agentMessage", text: "commentary" } });
    f.notify("item/agentMessage/delta", { itemId: "message-2", delta: "partial final" });
    f.stop();
    expect(texts(await f.replay())).toEqual(["commentary", "partial final"]);
  });
  it("restores the stopped status without displaying raw internal abort instructions", () => {
    const records = [
      ...session,
      entry("response_item", {
        type: "message",
        role: "user",
        text: "<turn_aborted>internal runtime advice</turn_aborted>",
      }),
      aborted,
    ];
    const replay = parseSessionReplayEvents(records, threadId);
    expect(replay.filter((e) => e.method === "local/turnInterrupted")).toHaveLength(1);
    expect(replay.some((e) => e.paramsText.includes("internal runtime advice"))).toBe(false);
  });
});
