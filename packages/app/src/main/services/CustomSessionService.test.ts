import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CustomSessionService } from "./CustomSessionService";
import type { CustomSession } from "@codenexus/shared/ipc/contracts";

let tempDir = "";
let filePath = "";

function makeSession(id: string, updatedAt: number): CustomSession {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    providerId: null,
    providerLabel: null,
    workspaceRoot: null,
    messages: [],
  };
}

describe("CustomSessionService", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "custom-sessions-"));
    filePath = join(tempDir, "custom-agent-sessions.json");
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("creates, lists, gets, upserts and deletes sessions", async () => {
    const service = new CustomSessionService(filePath);

    const created = await service.create({ providerId: "provider-1", providerLabel: "Provider" });
    expect(created.item).toMatchObject({ title: "新会话", providerId: "provider-1" });

    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(await service.get(created.item.id)).toMatchObject({ id: created.item.id });

    const updated = await service.upsert({
      ...created.item,
      title: "更新后",
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: 1 }],
    });
    expect(updated.item.title).toBe("更新后");
    expect((await service.get(created.item.id))?.messages).toHaveLength(1);

    const deleted = await service.delete(created.item.id);
    expect(deleted.deleted).toBe(true);
    expect(await service.list()).toEqual([]);
  });

  it("falls back to an empty list for corrupt JSON", async () => {
    await writeFile(filePath, "{not json", "utf8");
    const service = new CustomSessionService(filePath);

    await expect(service.list()).resolves.toEqual([]);
  });

  it("sorts by updatedAt desc and keeps only the newest 100 sessions", async () => {
    const service = new CustomSessionService(filePath);

    for (let idx = 0; idx < 105; idx += 1) {
      await service.upsert(makeSession(`session-${idx}`, 1_000 + idx));
    }

    const listed = await service.list();
    expect(listed).toHaveLength(100);
    expect(listed[0].id).toBe("session-104");
    expect(listed.at(-1)?.id).toBe("session-5");

    const persisted = JSON.parse(await readFile(filePath, "utf8")) as { items: CustomSession[] };
    expect(persisted.items).toHaveLength(100);
  });
});
