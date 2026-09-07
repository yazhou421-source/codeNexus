import type { TimelineEventItem } from "../types";
import { parseToolPause, TOOL_PAUSE_CONTINUE_PROMPT } from "../toolPause";

export function createToolPauseRuntime(deps: {
  currentThreadId: () => string;
  isRunning: (threadId: string) => boolean;
  events: (threadId: string) => TimelineEventItem[];
  send: (text: string) => Promise<boolean>;
}) {
  const sending = new Set<string>();
  return async (threadId: string, eventId: string): Promise<boolean> => {
    if (!threadId || deps.currentThreadId() !== threadId || deps.isRunning(threadId) || sending.has(threadId))
      return false;
    const events = deps.events(threadId);
    const index = events.findIndex((event) => event.id === eventId && parseToolPause(event.paramsText));
    if (index < 0 || events.slice(index + 1).some((event) => event.turnId && event.turnId !== events[index].turnId))
      return false;
    sending.add(threadId);
    try {
      return await deps.send(TOOL_PAUSE_CONTINUE_PROMPT);
    } finally {
      sending.delete(threadId);
    }
  };
}
