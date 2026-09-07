import { createHash, randomUUID } from "node:crypto";

// A repository survey needs roughly 8 rounds; 16 leaves room for follow-up
// reads and validation while bounding a single autonomous burst. No infinity.
export const DEFAULT_MAX_TOOL_CONTINUATION_TURNS = 16;

export function maxChatToolContinuationTurns(route = {}) {
  const value = Number(
    route.maxToolContinuationTurns ?? route.max_tool_continuation_turns,
  );
  return Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : DEFAULT_MAX_TOOL_CONTINUATION_TURNS;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function normalized(value) {
  if (typeof value !== "string")
    return JSON.stringify(canonical(value ?? null));
  try {
    return JSON.stringify(canonical(JSON.parse(value)));
  } catch {
    return value.replace(/\r\n/g, "\n").trim();
  }
}

function resultText(value) {
  // Ignore only known shell transport bookkeeping, never arbitrary numbers,
  // paths or timestamps in the actual command output.
  let structured = value;
  if (typeof value === "string") {
    try {
      structured = JSON.parse(value);
    } catch {
      /* Plain tool output. */
    }
  }
  if (
    structured &&
    typeof structured === "object" &&
    !Array.isArray(structured) &&
    typeof structured.output === "string"
  ) {
    if (
      Object.hasOwn(structured, "exit_code") &&
      Object.hasOwn(structured, "wall_time_seconds")
    ) {
      const {
        wall_time_seconds: _time,
        chunk_id: _chunk,
        ...result
      } = structured;
      return normalized({ ...result, output: resultText(result.output) });
    }
    if (
      structured.metadata &&
      Object.hasOwn(structured.metadata, "exit_code") &&
      Object.hasOwn(structured.metadata, "duration_seconds")
    ) {
      const { duration_seconds: _time, ...metadata } = structured.metadata;
      return normalized({
        ...structured,
        metadata,
        output: resultText(structured.output),
      });
    }
  }
  const text = typeof value === "string" ? value : normalized(value);
  return normalized(
    text
      .replace(/^Wall time: [\d.]+ seconds\r?\n/gm, "")
      .replace(/^Chunk ID: [a-zA-Z0-9_-]+\r?\n/gm, "")
      .replace(/^Original token count: \d+\r?\n/gm, ""),
  );
}
const fingerprint = (value) =>
  createHash("sha256").update(normalized(value)).digest("hex");

// Persist only bounded fingerprints + pending call identities, not tool output.
// This also works for previous_response_id and routes that flatten chat history.
export function inspectToolContinuation(messages, previousState, route) {
  let rounds = previousState?.rounds || 0;
  let recent = [...(previousState?.recent || [])];
  let pending = (previousState?.pending || []).map((call) => ({ ...call }));
  let inOutputGroup = false;
  for (const message of messages) {
    if (message.role !== "tool") inOutputGroup = false;
    if (message.role === "user") {
      rounds = 0;
      recent = [];
      pending = [];
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      pending = message.tool_calls.map((call) => ({
        id: call.id,
        name: call.function?.name || "",
        args: fingerprint(call.function?.arguments),
      }));
    }
    if (message.role !== "tool") continue;
    if (!inOutputGroup) rounds += 1;
    inOutputGroup = true;
    const call = pending.find((item) => item.id === message.tool_call_id);
    if (!call || call.output !== undefined) continue;
    const output = resultText(message.content);
    call.output = fingerprint(output);
    // Short generic acknowledgements from different operations aren't evidence.
    call.informative =
      output.length >= 80 ||
      /error|failed|not found|denied|失败|错误/i.test(output);
    if (!pending.every((item) => item.output !== undefined)) continue;
    const ordered = [...pending].sort((a, b) =>
      (a.name + a.args).localeCompare(b.name + b.args),
    );
    recent.push({
      signature: fingerprint(
        ordered.map(({ name, args, output }) => ({ name, args, output })),
      ),
      result: fingerprint(
        ordered.map(({ name, output }) => ({ name, output })),
      ),
      informative: pending.every((item) => item.informative),
    });
    recent = recent.slice(-6);
    pending = [];
  }
  const state = { rounds, recent, pending };
  const limit = maxChatToolContinuationTurns(route);
  if (rounds >= limit)
    return {
      state,
      stop: {
        reason: "tool_limit_reached",
        detail: "hard_ceiling",
        rounds,
        limit,
      },
    };
  const tail = (n) => recent.slice(-n);
  let detail = "";
  if (
    recent.length >= 3 &&
    tail(3).every((item) => item.signature === recent.at(-1).signature)
  )
    detail = "exact_repeat";
  else if (
    recent.length >= 4 &&
    recent.at(-4).signature === recent.at(-2).signature &&
    recent.at(-3).signature === recent.at(-1).signature
  )
    detail = "short_cycle";
  else if (
    recent.length >= 4 &&
    tail(4).every(
      (item) => item.informative && item.result === recent.at(-1).result,
    )
  )
    detail = "no_progress";
  return {
    state,
    stop: detail ? { reason: "tool_loop_guard", detail, rounds, limit } : null,
  };
}

export function stateWithAssistant(state, chat) {
  const calls = chat?.choices?.[0]?.message?.tool_calls || [];
  return {
    ...state,
    pending: calls.map((call) => ({
      id: call.id,
      name: call.function?.name || "",
      args: fingerprint(call.function?.arguments),
    })),
  };
}

export function toolPauseChat(stop) {
  // App-server transports assistant text but drops custom Response metadata.
  // A versioned envelope survives persisted sessions and history replay.
  return {
    id: `chatcmpl_tool_pause_${randomUUID()}`,
    choices: [
      {
        message: {
          role: "assistant",
          content: `<!-- calmnova:tool-pause:v1 ${JSON.stringify(stop)} -->\n任务已暂停。工具调用达到安全保护条件。最新工具结果已保留，可以继续分析。`,
        },
      },
    ],
    usage: null,
  };
}
