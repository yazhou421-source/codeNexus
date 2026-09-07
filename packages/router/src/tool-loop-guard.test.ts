import { describe, expect, it } from "vitest";
import {
  inspectToolContinuation,
  maxChatToolContinuationTurns,
} from "./tool-loop-guard.js";
import { routeForModel } from "./config.js";

const round = (
  id: number,
  args: string,
  output = "file contents",
  name = "read_file",
) => [
  {
    role: "assistant",
    tool_calls: [{ id: `c${id}`, function: { name, arguments: args } }],
  },
  { role: "tool", tool_call_id: `c${id}`, content: output },
];
const inspect = (messages: unknown[], route = {}) =>
  inspectToolContinuation(messages, null, route);

describe("semantic tool loop protection", () => {
  it("permits eight progressing reads, even with a single tool name", () => {
    expect(
      inspect(
        Array.from({ length: 8 }, (_, i) =>
          round(i, JSON.stringify({ path: `file${i}` }), `content${i}`),
        ).flat(),
      ).stop,
    ).toBeNull();
  });
  it("canonicalizes JSON key order and whitespace for exact repeats", () => {
    expect(
      inspect([
        ...round(1, '{"path":"a", "offset":0}'),
        ...round(2, '{ "offset": 0, "path": "a" }'),
        ...round(3, '{"path":"a","offset":0}'),
      ]).stop,
    ).toMatchObject({ reason: "tool_loop_guard", detail: "exact_repeat" });
  });
  it("allows repeated polling when results change", () => {
    expect(
      inspect(
        [0, 1, 2, 3].flatMap((i) => round(i, '{"session":1}', `progress ${i}`)),
      ).stop,
    ).toBeNull();
  });
  it("does not normalize significant argument whitespace or output numbers", () => {
    expect(
      inspect(
        [1, 2, 3].flatMap((i) =>
          round(i, JSON.stringify({ cmd: `echo '${" ".repeat(i)}'` })),
        ),
      ).stop,
    ).toBeNull();
  });
  it("detects A-B-A-B only when both outputs remain unchanged", () => {
    expect(
      inspect(
        [0, 1, 0, 1].flatMap((v, i) =>
          round(i, JSON.stringify({ path: v }), `contents${v}`),
        ),
      ).stop,
    ).toMatchObject({ detail: "short_cycle" });
    expect(
      inspect(
        [0, 1, 0, 1].flatMap((v, i) =>
          round(i, JSON.stringify({ path: v }), `contents${i}`),
        ),
      ).stop,
    ).toBeNull();
  });
  it("detects no progress across differing arguments with repeated failures", () => {
    expect(
      inspect(
        [1, 2, 3, 4].flatMap((i) =>
          round(i, JSON.stringify({ path: i }), "Error: permission denied"),
        ),
      ).stop,
    ).toMatchObject({ detail: "no_progress" });
  });
  it("does not infer no progress from short generic successes", () => {
    expect(
      inspect(
        [1, 2, 3, 4].flatMap((i) =>
          round(i, JSON.stringify({ path: i }), "OK"),
        ),
      ).stop,
    ).toBeNull();
  });
  it("ignores shell wrapper timing while preserving command output and exit status", () => {
    expect(
      inspect(
        [1, 2, 3].flatMap((i) =>
          round(
            i,
            "{}",
            `Wall time: ${i}.3 seconds\nChunk ID: chunk${i}\nProcess exited with code 0\nOutput:\nunchanged`,
          ),
        ),
      ).stop,
    ).toMatchObject({ detail: "exact_repeat" });
  });
  it("normalizes known JSON shell bookkeeping without hiding exit-status changes", () => {
    const messages = [1, 2, 3].flatMap((i) =>
      round(
        i,
        "{}",
        JSON.stringify({
          output: "unchanged",
          exit_code: 0,
          wall_time_seconds: i,
          chunk_id: `chunk${i}`,
        }),
      ),
    );
    expect(inspect(messages).stop).toMatchObject({ detail: "exact_repeat" });
    const changed = [1, 2, 3].flatMap((i) =>
      round(
        i,
        "{}",
        JSON.stringify({
          output: "unchanged",
          metadata: { exit_code: i, duration_seconds: i },
        }),
      ),
    );
    expect(inspect(changed).stop).toBeNull();
  });

  it("counts parallel outputs as one round and requires the complete batch for semantic evidence", () => {
    const batch = [1, 2, 3].flatMap((i) => {
      const a = round(i * 2, '{"path":"a"}');
      const b = round(i * 2 + 1, '{"path":"b"}', `progress ${i}`);
      return [
        {
          role: "assistant",
          tool_calls: [...a[0].tool_calls!, ...b[0].tool_calls!],
        },
        a[1],
        b[1],
      ];
    });
    expect(inspect(batch)).toMatchObject({ state: { rounds: 3 }, stop: null });
  });
  it("enforces the ceiling even with unpaired outputs and persists a bounded window", () => {
    const messages = Array.from({ length: 16 }, (_, i) =>
      round(i, JSON.stringify({ path: i }), `new ${i}`),
    ).flat();
    expect(inspect(messages)).toMatchObject({
      state: { rounds: 16 },
      stop: { reason: "tool_limit_reached", limit: 16 },
    });
    expect(inspect(messages).state.recent.length).toBeLessThanOrEqual(6);
    expect(
      inspect([{ role: "tool", tool_call_id: "orphan", content: "x" }], {
        maxToolContinuationTurns: 1,
      }).stop?.reason,
    ).toBe("tool_limit_reached");
  });
  it.each([0, -1, Infinity, NaN])(
    "invalid ceiling %s cannot disable safety",
    (value) => {
      expect(
        maxChatToolContinuationTurns({ maxToolContinuationTurns: value }),
      ).toBe(16);
    },
  );
  it("supports route, provider and global overrides without changing responses routes", () => {
    const route = {
      id: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      api: "chat_completions" as const,
      provider: "deepseek",
    };
    const config = {
      models: [route],
      maxToolContinuationTurns: 20,
      providerToolContinuationLimits: { deepseek: 18 },
    };
    expect(routeForModel(config, "deepseek").maxToolContinuationTurns).toBe(18);
    expect(
      routeForModel(
        { ...config, models: [{ ...route, maxToolContinuationTurns: 10 }] },
        "deepseek",
      ).maxToolContinuationTurns,
    ).toBe(10);
    expect(
      routeForModel(
        { models: [route], maxToolContinuationTurns: 20 },
        "deepseek",
      ).maxToolContinuationTurns,
    ).toBe(20);
    const responses = { ...route, api: "responses" as const };
    expect(routeForModel({ ...config, models: [responses] }, "deepseek")).toBe(
      responses,
    );
  });
  it("resets on a new user turn while retaining history outside the detector", () => {
    const stopped = inspect([1, 2, 3].flatMap((i) => round(i, "{}")));
    expect(
      inspectToolContinuation(
        [{ role: "user", content: "continue" }],
        stopped.state,
        {},
      ).stop,
    ).toBeNull();
  });
});
