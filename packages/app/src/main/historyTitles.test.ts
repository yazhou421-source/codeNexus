import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryStore } from "./historyStore";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("task titles exclude bootstrap context", () => {
  it("refreshes a cached context title without modifying the original conversation", async () => {
    const root = await mkdtemp(join(tmpdir(), "calmnova-title-"));
    dirs.push(root);
    const sessions = join(root, "sessions");
    await mkdir(sessions);
    const cache = join(root, "history.json");
    const file = join(sessions, "rollout-test.jsonl");
    const bootstrap =
      "<recommended_plugins>fictional plugin</recommended_plugins><environment_context>fictional cwd</environment_context>";
    const user = (text: string) => ({
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    const original = [
      { type: "session_meta", payload: { id: "title-test", cwd: "/fictional" } },
      user(bootstrap),
      user("真正的任务标题"),
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");
    await writeFile(file, original);
    expect((await new HistoryStore(cache, sessions).refreshDisk())[0].title).toBe("真正的任务标题");
    const oldCache = JSON.parse(await readFile(cache, "utf8"));
    oldCache.items[0].title = bootstrap;
    oldCache.sessionSummaries[0].thread.title = bootstrap;
    await writeFile(cache, JSON.stringify(oldCache));
    const reader = new HistoryStore(cache, sessions);
    expect((await reader.refreshDisk())[0].title).toBe("真正的任务标题");
    expect(await readFile(file, "utf8")).toBe(original);
    const events = await reader.getThreadEvents("title-test", { includeAux: false });
    expect(JSON.stringify(events.entries)).toContain("fictional plugin");
  });
});
