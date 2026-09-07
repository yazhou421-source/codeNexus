import type { RouterModelRoute } from "./types";
export type ToolGuardStop = {
  reason: "tool_loop_guard" | "tool_limit_reached";
  detail: string;
  rounds: number;
  limit: number;
};
export type ToolGuardState = {
  rounds: number;
  recent: { signature: string; result: string; informative: boolean }[];
  pending: {
    id: string;
    name: string;
    args: string;
    output?: string;
    informative?: boolean;
  }[];
};
export const DEFAULT_MAX_TOOL_CONTINUATION_TURNS: number;
export function maxChatToolContinuationTurns(
  route?: Partial<RouterModelRoute>,
): number;
export function inspectToolContinuation(
  messages: unknown[],
  previousState: ToolGuardState | null | undefined,
  route: Partial<RouterModelRoute>,
): { state: ToolGuardState; stop: ToolGuardStop | null };
export function stateWithAssistant(
  state: ToolGuardState,
  chat: unknown,
): ToolGuardState;
export function toolPauseChat(stop: ToolGuardStop): {
  id: string;
  choices: { message: { role: string; content: string } }[];
  usage: null;
};
