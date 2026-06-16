function normalizeThreadId(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeThreadTitleOverride(value: unknown): string {
  const normalized = String(value ?? "").replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

export function fallbackThreadTitle(threadIdValue: string): string {
  const threadId = normalizeThreadId(threadIdValue);
  const suffix = threadId.length > 8 ? threadId.slice(-8) : threadId;
  return `Thread ${suffix}`;
}

export function isFallbackThreadTitle(threadIdValue: string, titleValue: unknown): boolean {
  const normalizedTitle = normalizeText(titleValue);
  if (!normalizedTitle) return false;
  return normalizedTitle === fallbackThreadTitle(threadIdValue);
}

export function fallbackDisplayThreadTitle(threadIdValue: string): string {
  const threadId = normalizeThreadId(threadIdValue);
  const suffix = threadId.length > 8 ? threadId.slice(-8) : threadId;
  return suffix ? `未命名线程 · ${suffix}` : "未命名线程";
}

export function resolveDisplayThreadTitleWithOverride(
  threadIdValue: string,
  incomingTitle?: unknown,
  overrideTitle?: unknown
): string {
  const normalizedOverride = normalizeThreadTitleOverride(overrideTitle);
  if (normalizedOverride) return normalizedOverride;
  const normalizedIncoming = normalizeText(incomingTitle);
  if (normalizedIncoming && !isFallbackThreadTitle(threadIdValue, normalizedIncoming)) return normalizedIncoming;
  return fallbackDisplayThreadTitle(threadIdValue);
}

export function resolveDisplayThreadTitle(threadIdValue: string, incomingTitle?: unknown): string {
  return resolveDisplayThreadTitleWithOverride(threadIdValue, incomingTitle, "");
}

export function titleFromFirstUserMessage(value: string): string {
  return normalizeThreadTitleOverride(value);
}

export function isBootstrapThreadTitleSource(value: string): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return true;
  if (raw.startsWith("<environment_context>")) return true;
  if (raw.startsWith("# AGENTS.md instructions")) return true;
  if (raw.includes("<INSTRUCTIONS>")) return true;
  return false;
}

export function resolveThreadTitle(threadIdValue: string, incomingTitle?: string): string {
  const threadId = normalizeThreadId(threadIdValue);
  const normalizedIncoming = normalizeText(incomingTitle);
  if (normalizedIncoming) return normalizedIncoming;
  return fallbackThreadTitle(threadId);
}
