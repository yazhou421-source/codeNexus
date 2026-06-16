export const STRUCTURED_FINAL_ANSWER_TYPE_V1 = "codenexus.final_answer.v1" as const;

export type StructuredFinalAnswerV1 = {
  type: typeof STRUCTURED_FINAL_ANSWER_TYPE_V1;
  summary: string;
  changes: string[];
  commands: string[];
  next_steps: string[];
};

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

export function tryParseStructuredFinalAnswerV1(textValue: unknown): StructuredFinalAnswerV1 | null {
  const text = typeof textValue === "string" ? textValue.trim() : "";
  if (!text) return null;
  if (!text.startsWith("{") || !text.endsWith("}")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const record = toRecord(parsed);
  if (!record) return null;
  if (record.type !== STRUCTURED_FINAL_ANSWER_TYPE_V1) return null;
  if (typeof record.summary !== "string") return null;
  const changes = toStringArray(record.changes);
  if (!changes) return null;
  const commands = toStringArray(record.commands);
  if (!commands) return null;
  const nextSteps = toStringArray(record.next_steps);
  if (!nextSteps) return null;

  return {
    type: STRUCTURED_FINAL_ANSWER_TYPE_V1,
    summary: record.summary,
    changes,
    commands,
    next_steps: nextSteps,
  };
}

function normalizeLines(value: string): string[] {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function listMarkdown(items: string[]): string {
  const lines = items.flatMap((item) => normalizeLines(item));
  if (lines.length === 0) return `- （无）`;
  return lines.map((line) => `- ${line}`).join("\n");
}

export function structuredFinalAnswerToMarkdownV1(answer: StructuredFinalAnswerV1): string {
  const summary = String(answer.summary ?? "").trim() || "（无）";
  const changes = listMarkdown(Array.isArray(answer.changes) ? answer.changes : []);
  const nextSteps = listMarkdown(Array.isArray(answer.next_steps) ? answer.next_steps : []);
  const commands = (Array.isArray(answer.commands) ? answer.commands : [])
    .map((cmd) => String(cmd ?? "").trim())
    .filter(Boolean);

  const commandBlock = commands.length > 0 ? commands.join("\n") : `# （无）`;

  return [
    `## 总结`,
    summary,
    "",
    `## 变更`,
    changes,
    "",
    `## 命令`,
    "```bash",
    commandBlock,
    "```",
    "",
    `## 下一步`,
    nextSteps,
    "",
  ].join("\n");
}
