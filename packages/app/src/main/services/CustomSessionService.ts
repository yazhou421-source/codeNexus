import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CustomSession,
  CustomSessionCreateArgs,
  CustomSessionDeleteResult,
  CustomSessionMutationResult,
} from "@codenexus/shared/ipc/contracts";

const MAX_CUSTOM_SESSIONS = 100;

type CustomSessionFile = {
  items?: unknown[];
};

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeMessage(value: unknown): CustomSession["messages"][number] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = nonEmptyString(record.id) ?? randomUUID();
  const role = record.role === "user" || record.role === "assistant" ? record.role : null;
  if (!role) return null;
  const content = typeof record.content === "string" ? record.content : "";
  const createdAt = normalizeTimestamp(record.createdAt, Date.now());
  const parts = Array.isArray(record.parts) ? record.parts : undefined;
  const reasoning = typeof record.reasoning === "string" ? record.reasoning : undefined;
  return {
    id,
    role,
    content,
    createdAt,
    ...(record.error === true ? { error: true } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(parts ? { parts: parts as CustomSession["messages"][number]["parts"] } : {}),
  };
}

function normalizeSession(value: unknown): CustomSession | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = nonEmptyString(record.id);
  if (!id) return null;
  const now = Date.now();
  const messages = Array.isArray(record.messages)
    ? record.messages.map(normalizeMessage).filter((item): item is CustomSession["messages"][number] => Boolean(item))
    : [];
  return {
    id,
    title: nonEmptyString(record.title) ?? "新会话",
    createdAt: normalizeTimestamp(record.createdAt, now),
    updatedAt: normalizeTimestamp(record.updatedAt, now),
    providerId: optionalString(record.providerId),
    providerLabel: optionalString(record.providerLabel),
    workspaceRoot: optionalString(record.workspaceRoot),
    messages,
  };
}

function sortAndTrim(items: CustomSession[]): CustomSession[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CUSTOM_SESSIONS);
}

export class CustomSessionService {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async list(): Promise<CustomSession[]> {
    return this.readItems();
  }

  async get(id: unknown): Promise<CustomSession | null> {
    const sessionId = nonEmptyString(id);
    if (!sessionId) return null;
    const items = await this.readItems();
    return items.find((item) => item.id === sessionId) ?? null;
  }

  async create(args: CustomSessionCreateArgs = {}): Promise<CustomSessionMutationResult> {
    const now = Date.now();
    const item: CustomSession = {
      id: randomUUID(),
      title: nonEmptyString(args.title) ?? "新会话",
      createdAt: now,
      updatedAt: now,
      providerId: optionalString(args.providerId),
      providerLabel: optionalString(args.providerLabel),
      workspaceRoot: optionalString(args.workspaceRoot),
      messages: Array.isArray(args.messages)
        ? args.messages
            .map(normalizeMessage)
            .filter((message): message is CustomSession["messages"][number] => Boolean(message))
        : [],
    };
    const items = await this.saveItems([item, ...(await this.readItems())]);
    return { item, items };
  }

  async upsert(session: unknown): Promise<CustomSessionMutationResult> {
    const item = normalizeSession(session);
    if (!item) {
      throw new Error("Invalid Custom session payload");
    }
    const now = Date.now();
    const nextItem = { ...item, updatedAt: normalizeTimestamp(item.updatedAt, now) };
    const existing = await this.readItems();
    const withoutItem = existing.filter((candidate) => candidate.id !== nextItem.id);
    const items = await this.saveItems([nextItem, ...withoutItem]);
    return { item: nextItem, items };
  }

  async delete(id: unknown): Promise<CustomSessionDeleteResult> {
    const sessionId = nonEmptyString(id);
    if (!sessionId) return { deleted: false, items: await this.readItems() };
    const existing = await this.readItems();
    const next = existing.filter((item) => item.id !== sessionId);
    const items = await this.saveItems(next);
    return { deleted: next.length !== existing.length, items };
  }

  async touchTitle(id: unknown, title: unknown): Promise<CustomSessionMutationResult | null> {
    const sessionId = nonEmptyString(id);
    const nextTitle = nonEmptyString(title);
    if (!sessionId || !nextTitle) return null;
    const item = await this.get(sessionId);
    if (!item) return null;
    return this.upsert({ ...item, title: nextTitle, updatedAt: Date.now() });
  }

  private async readItems(): Promise<CustomSession[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CustomSessionFile;
      const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
      return sortAndTrim(rawItems.map(normalizeSession).filter((item): item is CustomSession => Boolean(item)));
    } catch {
      return [];
    }
  }

  private async saveItems(items: CustomSession[]): Promise<CustomSession[]> {
    const next = sortAndTrim(items);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify({ items: next }, null, 2), "utf8");
    });
    await this.writeQueue;
    return next;
  }
}
