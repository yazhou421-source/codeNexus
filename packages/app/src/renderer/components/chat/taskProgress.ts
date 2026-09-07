import type { ChatAuxiliaryRow } from "../layout/types/chat.types";
export type ProgressStep = {
  id: string;
  title: string;
  state: "idle" | "thinking" | "executing" | "success" | "warning" | "error";
  durationMs?: number | null;
  pending?: boolean;
};
function stateFromStatus(status: string): ProgressStep["state"] {
  if (["completed", "succeeded", "applied"].includes(status)) return "success";
  if (["failed", "rejected"].includes(status)) return "error";
  if (["cancelled", "declined", "awaitingApproval"].includes(status)) return "warning";
  if (["running", "inProgress"].includes(status)) return "executing";
  return "idle";
}
const basename = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) || value;
function commandTitle(command: string, zh: boolean): string {
  const read = command.match(/^(?:cat\s+|sed\s+-n\s+['"][^'"]+['"]\s+)([\w./-]+)$/);
  if (read) return `${zh ? "读取" : "Read"} ${basename(read[1])}`;
  return `${zh ? "执行命令" : "Run command"} · ${command.trim().split(/\s+/)[0] || (zh ? "终端" : "Terminal")}`;
}
/** Summarize observed operations only. Unknown/stopped work never becomes a successful step. */
export function buildTaskProgress(items: ChatAuxiliaryRow[], running: boolean, zh: boolean): ProgressStep[] {
  const steps: ProgressStep[] = [];
  for (const row of items) {
    let step: ProgressStep | null = null;
    const base = { id: row.id, state: "idle" as const };
    if (row.kind === "reasoningBlock") {
      step = {
        ...base,
        title: row.item.title || (zh ? "分析任务" : "Analyze the task"),
        durationMs: row.item.durationMs,
        state: running && row === items.at(-1) ? "thinking" : "idle",
      };
    } else if (row.kind === "commandRead") {
      step = {
        ...base,
        title: `${zh ? "读取" : "Read"} ${row.item.name || basename(row.item.path)}`,
        state: stateFromStatus(row.item.status),
        durationMs: row.item.durationMs,
      };
    } else if (row.kind === "commandList") {
      step = {
        ...base,
        title: `${zh ? "浏览项目文件" : "Browse files"} ${basename(row.item.path)}`,
        state: stateFromStatus(row.item.status),
      };
    } else if (row.kind === "commandSearch") {
      step = { ...base, title: `${zh ? "搜索" : "Search"} ${row.item.query}`, state: stateFromStatus(row.item.status) };
    } else if (row.kind === "commandAction" || row.kind === "commandSession") {
      const command = row.kind === "commandAction" ? row.item.item : row.item;
      step = {
        ...base,
        title: commandTitle(command.commandShort, zh),
        state: stateFromStatus(command.status),
        durationMs: command.durationMs,
      };
    } else if (row.kind === "fileChange") {
      step = {
        ...base,
        title: `${zh ? "更新文件" : "Update files"} · ${row.item.files.length}`,
        state: stateFromStatus(row.item.status),
      };
    } else if (row.kind === "dynamicTool") {
      step = {
        ...base,
        title: row.item.label || row.item.toolName,
        state: stateFromStatus(row.item.status),
        durationMs: row.item.durationMs,
      };
    } else if (row.kind === "imageTool" || row.kind === "webSearch") {
      step = { ...base, title: row.item.title, state: stateFromStatus(row.item.status) };
    } else if (row.kind === "mcpResourceRead") {
      step = {
        ...base,
        title: `${zh ? "读取资源" : "Read resource"} · ${row.item.resourceLabel || row.item.server}`,
        state: stateFromStatus(row.item.status),
      };
    } else if (row.kind === "mcpToolGroup") {
      steps.push(
        ...row.group.items.map((item) => ({
          id: item.id,
          title: `${item.server} · ${item.tool}`,
          state: stateFromStatus(item.status),
          durationMs: item.durationMs,
        }))
      );
    } else if (row.kind === "activity" && ["error", "warn"].includes(row.tone || "")) {
      step = { ...base, title: row.text, state: row.tone === "error" ? "error" : "warning" };
    }
    if (step) steps.push(step);
  }
  return steps.map((step) =>
    !running && ["thinking", "executing"].includes(step.state) ? { ...step, state: "idle" } : step
  );
}
