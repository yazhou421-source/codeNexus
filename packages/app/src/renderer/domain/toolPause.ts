export type ToolPauseReason = "tool_loop_guard" | "tool_limit_reached";
export type ToolPause = { reason: ToolPauseReason; detail: string; rounds: number; limit: number };

export const TOOL_PAUSE_CONTINUE_PROMPT =
  "从最新工具结果继续当前任务，保留原任务的范围和约束（包括只读要求）。不重复已经完成的检查，不从 pwd/ls 重新开始探索。先利用已有结果，只补充尚缺的信息；如果信息已足够，直接给出分析。";

export function parseToolPause(text: string | null | undefined): ToolPause | null {
  const match = String(text ?? "").match(/^<!-- calmnova:tool-pause:v1 (\{[^\n]+\}) -->/);
  if (match) {
    try {
      const value = JSON.parse(match[1]);
      if (
        (value.reason === "tool_loop_guard" || value.reason === "tool_limit_reached") &&
        typeof value.detail === "string" &&
        Number.isFinite(value.rounds) &&
        Number.isFinite(value.limit)
      )
        return value;
    } catch {
      /* An incomplete streamed envelope is not yet a pause. */
    }
  }
  // Existing persisted guard responses also need a recoverable warning UI.
  if (String(text ?? "").startsWith("CodexBridge stopped repeated tool loop")) {
    return { reason: "tool_loop_guard", detail: "legacy_guard", rounds: 0, limit: 0 };
  }
  return null;
}
