import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type InterruptedTurn = {
  version: 1;
  threadId: string;
  turnId: string;
  stoppedAt: string;
  status: "interrupted";
  messages: Array<{ id: string; text: string; phase?: string }>;
};

/** Additive desktop journal. Existing Codex session files are never rewritten. */
export class InterruptedTurnStore {
  private active = new Map<string, Map<string, { id: string; text: string; phase?: string }>>();
  private terminal = new Set<string>();
  private interrupted = new Set<string>();

  constructor(private readonly root: string) {}

  private safeId(id: unknown): id is string {
    return typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id);
  }

  observe(message: unknown): void | false {
    const msg = message as { kind?: string; method?: string; params?: any };
    if (msg?.kind !== "notification") return;
    const p = msg.params;
    const threadId = p?.threadId;
    const turnId = p?.turnId ?? p?.turn?.id;
    if (!this.safeId(threadId) || !this.safeId(turnId)) return;
    const key = `${threadId}/${turnId}`;
    // A late empty completion/delta must never replace an acknowledged stop.
    if (this.terminal.has(key)) {
      if (
        this.interrupted.has(key) &&
        (msg.method === "item/agentMessage/delta" ||
          msg.method === "turn/completed" ||
          ((msg.method === "item/started" || msg.method === "item/completed") && p.item?.type === "agentMessage"))
      )
        return false;
      return;
    }
    if (msg.method === "turn/started") {
      if (!this.active.has(key)) this.active.set(key, new Map());
      return;
    }
    const items = this.active.get(key);
    if (!items) return;
    if (msg.method === "item/agentMessage/delta" && this.safeId(p.itemId) && typeof p.delta === "string") {
      const item = items.get(p.itemId) ?? { id: p.itemId, text: "" };
      item.text += p.delta;
      items.set(p.itemId, item);
    } else if (msg.method === "item/started" && p.item?.type === "agentMessage") {
      const item = p.item;
      if (this.safeId(item.id) && !items.has(item.id)) {
        items.set(item.id, { id: item.id, text: item.text ?? "", phase: item.phase });
      }
    } else if (msg.method === "item/completed" && p.item?.type === "agentMessage") {
      // Completed, non-empty items are already owned by the normal session writer.
      // Some servers send an empty item during cancellation: retain its accumulated deltas.
      if (typeof p.item.text === "string" && p.item.text.length > 0) items.delete(p.item.id);
    } else if (msg.method === "turn/completed") {
      if (p.turn?.status === "interrupted") {
        const snapshot: InterruptedTurn = {
          version: 1,
          threadId,
          turnId,
          status: "interrupted",
          stoppedAt: new Date().toISOString(),
          messages: [...items.values()].filter((item) => item.text.length > 0),
        };
        const directory = join(this.root, threadId);
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const file = join(directory, `${turnId}.json`);
        // Commit before forwarding the terminal event to the renderer. No async reload/quit race.
        writeFileSync(`${file}.tmp`, JSON.stringify(snapshot), { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
        this.interrupted.add(key);
      }
      this.terminal.add(key);
      this.active.delete(key);
    }
  }

  read(threadId: string): InterruptedTurn[] {
    if (!this.safeId(threadId)) return [];
    const directory = join(this.root, threadId);
    let files: string[];
    try {
      files = readdirSync(directory);
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return files
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const value = JSON.parse(readFileSync(join(directory, name), "utf8")) as InterruptedTurn;
        if (
          value.version !== 1 ||
          value.threadId !== threadId ||
          !this.safeId(value.turnId) ||
          value.status !== "interrupted" ||
          !Array.isArray(value.messages) ||
          value.messages.some((item) => typeof item.text !== "string")
        ) {
          throw new Error("Invalid interrupted-turn journal");
        }
        return value;
      });
  }

  removeThread(threadId: string): void {
    if (this.safeId(threadId)) rmSync(join(this.root, threadId), { recursive: true, force: true });
  }
}
