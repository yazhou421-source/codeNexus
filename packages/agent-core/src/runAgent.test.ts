import { describe, it, expect, vi } from "vitest";
import { runAgent } from "./runAgent";
import type {
  AgentEvent,
  ChatClient,
  ModelReply,
  ToolDefinition,
} from "./types";

/**
 * 脚本化的假模型：按预设顺序逐轮返回 reply，不触网。
 * 这样我们能精确控制「模型这一轮要文字还是要调工具」，验证内核循环行为。
 */
function scriptedClient(replies: ModelReply[]): ChatClient & { calls: number } {
  let index = 0;
  const client = {
    calls: 0,
    async send(): Promise<ModelReply> {
      client.calls += 1;
      const reply = replies[index] ?? {
        content: "(no more scripted replies)",
        toolCalls: [],
      };
      index += 1;
      return reply;
    },
  };
  return client;
}

/** 一个简单的内存工具：记录被调用的参数，返回固定结果。 */
function makeTool(
  name: string,
  result: string,
): ToolDefinition & { lastArgs?: Record<string, unknown> } {
  const tool: ToolDefinition & { lastArgs?: Record<string, unknown> } = {
    name,
    description: `test tool ${name}`,
    parameters: { type: "object", properties: {} },
    execute: (args) => {
      tool.lastArgs = args;
      return result;
    },
  };
  return tool;
}

function abortError(): Error {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

describe("runAgent", () => {
  it("returns final text immediately when model makes no tool call", async () => {
    const client = scriptedClient([{ content: "Hello, done.", toolCalls: [] }]);

    const result = await runAgent({
      client,
      tools: [],
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.finalText).toBe("Hello, done.");
    expect(result.steps).toBe(1);
    expect(result.stoppedByMaxSteps).toBe(false);
    expect(client.calls).toBe(1);
  });

  it("executes a tool call, feeds the result back, then returns final text", async () => {
    const readFile = makeTool("read_file", '{"version":"1.0.3"}');
    const client = scriptedClient([
      // 第 1 轮：模型要求调用 read_file
      {
        content: null,
        toolCalls: [
          {
            id: "call_1",
            name: "read_file",
            arguments: '{"path":"package.json"}',
          },
        ],
      },
      // 第 2 轮：拿到工具结果后，模型给出最终答复
      { content: "The version is 1.0.3.", toolCalls: [] },
    ]);

    const result = await runAgent({
      client,
      tools: [readFile],
      messages: [{ role: "user", content: "what version?" }],
    });

    expect(result.finalText).toBe("The version is 1.0.3.");
    expect(result.steps).toBe(2);
    expect(client.calls).toBe(2);
    // 工具确实拿到了模型生成的参数
    expect(readFile.lastArgs).toEqual({ path: "package.json" });

    // 历史顺序应为：user → assistant(工具调用) → tool(结果) → assistant(最终答复)
    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
    const toolMessage = result.messages[2];
    expect(toolMessage.toolCallId).toBe("call_1");
    expect(toolMessage.content).toBe('{"version":"1.0.3"}');
  });

  it("runs multiple tool calls in one turn", async () => {
    const a = makeTool("tool_a", "result-a");
    const b = makeTool("tool_b", "result-b");
    const client = scriptedClient([
      {
        content: null,
        toolCalls: [
          { id: "c1", name: "tool_a", arguments: "{}" },
          { id: "c2", name: "tool_b", arguments: "{}" },
        ],
      },
      { content: "both done", toolCalls: [] },
    ]);

    const result = await runAgent({
      client,
      tools: [a, b],
      messages: [{ role: "user", content: "go" }],
    });

    expect(result.finalText).toBe("both done");
    // user + assistant + 2×tool + assistant
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(2);
    const toolContents = result.messages
      .filter((m) => m.role === "tool")
      .map((m) => m.content);
    expect(toolContents).toEqual(["result-a", "result-b"]);
  });

  it("feeds an error back to the model when an unknown tool is called", async () => {
    const client = scriptedClient([
      {
        content: null,
        toolCalls: [{ id: "c1", name: "does_not_exist", arguments: "{}" }],
      },
      { content: "ok, recovered", toolCalls: [] },
    ]);

    const result = await runAgent({
      client,
      tools: [],
      messages: [{ role: "user", content: "go" }],
    });

    expect(result.finalText).toBe("ok, recovered");
    const toolMessage = result.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("Unknown tool: does_not_exist");
  });

  it("feeds an error back when a tool throws, without crashing the loop", async () => {
    const boom: ToolDefinition = {
      name: "boom",
      description: "always throws",
      parameters: { type: "object", properties: {} },
      execute: () => {
        throw new Error("kaboom");
      },
    };
    const client = scriptedClient([
      {
        content: null,
        toolCalls: [{ id: "c1", name: "boom", arguments: "{}" }],
      },
      { content: "handled", toolCalls: [] },
    ]);

    const result = await runAgent({
      client,
      tools: [boom],
      messages: [{ role: "user", content: "go" }],
    });

    expect(result.finalText).toBe("handled");
    const toolMessage = result.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("kaboom");
  });

  it("tolerates malformed JSON arguments by passing an empty object to the tool", async () => {
    const tool = makeTool("read_file", "ok");
    const client = scriptedClient([
      {
        content: null,
        toolCalls: [{ id: "c1", name: "read_file", arguments: "not-json{" }],
      },
      { content: "done", toolCalls: [] },
    ]);

    await runAgent({
      client,
      tools: [tool],
      messages: [{ role: "user", content: "go" }],
    });

    expect(tool.lastArgs).toEqual({});
  });

  it("feeds a truncation error back when truncated and a required arg is missing", async () => {
    // write_file 需要 path + content；模型被 max_tokens 截断，参数残缺退化成 {}。
    const writeFile = makeTool("write_file", "wrote");
    writeFile.parameters = {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    };
    const client = scriptedClient([
      {
        content: null,
        toolCalls: [{ id: "c1", name: "write_file", arguments: "{}" }],
        truncated: true,
      },
      { content: "ok, will retry smaller", toolCalls: [] },
    ]);

    const events: AgentEvent[] = [];
    const result = await runAgent({
      client,
      tools: [writeFile],
      messages: [{ role: "user", content: "write a big file" }],
      onEvent: (e) => events.push(e),
    });

    // 工具不应被执行（参数残缺），而是回灌明确的截断错误。
    expect(writeFile.lastArgs).toBeUndefined();
    const toolMessage = result.messages.find((m) => m.role === "tool");
    expect(toolMessage?.content).toContain("truncated");
    expect(toolMessage?.content).toContain("path");
    expect(toolMessage?.content).toContain("content");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool_error", name: "write_file" }),
    );
  });

  it("still executes a truncated tool call when all required args are present", async () => {
    // 截断标记为真，但参数恰好完整（截断发生在工具调用之后）——不应误拦截。
    const writeFile = makeTool("write_file", "wrote");
    writeFile.parameters = {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    };
    const client = scriptedClient([
      {
        content: null,
        toolCalls: [
          {
            id: "c1",
            name: "write_file",
            arguments: '{"path":"a.txt","content":"hi"}',
          },
        ],
        truncated: true,
      },
      { content: "done", toolCalls: [] },
    ]);

    await runAgent({
      client,
      tools: [writeFile],
      messages: [{ role: "user", content: "go" }],
    });

    expect(writeFile.lastArgs).toEqual({ path: "a.txt", content: "hi" });
  });

  it("stops at maxSteps when the model keeps calling tools forever", async () => {
    const loopTool = makeTool("loop", "again");
    // 一个永远要求继续调工具的模型
    const client: ChatClient = {
      async send(): Promise<ModelReply> {
        return {
          content: null,
          toolCalls: [{ id: "c", name: "loop", arguments: "{}" }],
        };
      },
    };

    const result = await runAgent({
      client,
      tools: [loopTool],
      messages: [{ role: "user", content: "go" }],
      maxSteps: 3,
    });

    expect(result.stoppedByMaxSteps).toBe(true);
    expect(result.steps).toBe(3);
  });

  it("passes the abort signal to streaming clients and returns cancelled when they abort", async () => {
    const controller = new AbortController();
    const events: AgentEvent[] = [];
    const client: ChatClient = {
      send: vi.fn(async () => ({ content: "unused", toolCalls: [] })),
      stream: vi.fn(async (_messages, _tools, _handlers, request) => {
        expect(request?.signal).toBe(controller.signal);
        controller.abort();
        throw abortError();
      }),
    };

    const result = await runAgent({
      client,
      tools: [],
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    expect(result.cancelled).toBe(true);
    expect(result.stoppedByMaxSteps).toBe(false);
    expect(result.steps).toBe(1);
    expect(events).toContainEqual({ type: "cancelled", steps: 1 });
  });

  it("passes the abort signal to tools and returns cancelled when a tool aborts", async () => {
    const controller = new AbortController();
    const tool: ToolDefinition = {
      name: "slow_tool",
      description: "aborts",
      parameters: { type: "object", properties: {} },
      execute: (_args, context) => {
        expect(context?.signal).toBe(controller.signal);
        controller.abort();
        throw abortError();
      },
    };
    const client = scriptedClient([
      {
        content: null,
        toolCalls: [{ id: "c1", name: "slow_tool", arguments: "{}" }],
      },
    ]);

    const result = await runAgent({
      client,
      tools: [tool],
      messages: [{ role: "user", content: "go" }],
      signal: controller.signal,
    });

    expect(result.cancelled).toBe(true);
    expect(result.steps).toBe(1);
  });

  it("emits observable events for assistant text, tool calls and results", async () => {
    const tool = makeTool("read_file", "file-contents");
    const client = scriptedClient([
      {
        content: "let me read it",
        toolCalls: [{ id: "c1", name: "read_file", arguments: "{}" }],
      },
      { content: "the answer", toolCalls: [] },
    ]);

    const events: AgentEvent[] = [];
    await runAgent({
      client,
      tools: [tool],
      messages: [{ role: "user", content: "go" }],
      onEvent: (e) => events.push(e),
    });

    const types = events.map((e) => e.type);
    expect(types).toContain("assistant_message");
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
  });

  it("does not mutate the caller's original messages array", async () => {
    const original = [{ role: "user" as const, content: "hi" }];
    const client = scriptedClient([{ content: "done", toolCalls: [] }]);

    await runAgent({ client, tools: [], messages: original });

    expect(original).toHaveLength(1);
  });

  describe("single-turn tool concurrency", () => {
    /** 记录每个工具的 start/end 相对顺序，用于断言串行 vs 并行。 */
    function makeTrackedTool(
      name: string,
      mutating: boolean,
      log: string[],
      delayMs = 10,
    ): ToolDefinition {
      return {
        name,
        description: `tracked ${name}`,
        parameters: { type: "object", properties: {} },
        mutating,
        execute: async () => {
          log.push(`start:${name}`);
          await new Promise((r) => setTimeout(r, delayMs));
          log.push(`end:${name}`);
          return name;
        },
      };
    }

    it("serializes mutating tools within one turn (no overlap)", async () => {
      const log: string[] = [];
      const client = scriptedClient([
        {
          content: null,
          toolCalls: [
            { id: "c1", name: "write_a", arguments: "{}" },
            { id: "c2", name: "write_b", arguments: "{}" },
          ],
        },
        { content: "done", toolCalls: [] },
      ]);
      const tools = [
        makeTrackedTool("write_a", true, log),
        makeTrackedTool("write_b", true, log),
      ];

      await runAgent({ client, tools, messages: [{ role: "user", content: "go" }] });

      // 串行：第一个写完整结束后第二个才开始，绝不交错。
      expect(log).toEqual([
        "start:write_a",
        "end:write_a",
        "start:write_b",
        "end:write_b",
      ]);
    });

    it("runs read-only tools in parallel within one turn (overlap)", async () => {
      const log: string[] = [];
      const client = scriptedClient([
        {
          content: null,
          toolCalls: [
            { id: "c1", name: "read_a", arguments: "{}" },
            { id: "c2", name: "read_b", arguments: "{}" },
          ],
        },
        { content: "done", toolCalls: [] },
      ]);
      const tools = [
        makeTrackedTool("read_a", false, log),
        makeTrackedTool("read_b", false, log),
      ];

      await runAgent({ client, tools, messages: [{ role: "user", content: "go" }] });

      // 并行：两个 read 都先 start 再 end（交错）。
      expect(log.slice(0, 2)).toEqual(["start:read_a", "start:read_b"]);
    });

    it("keeps tool result messages in call order regardless of scheduling", async () => {
      const log: string[] = [];
      const client = scriptedClient([
        {
          content: null,
          toolCalls: [
            { id: "c1", name: "read_slow", arguments: "{}" },
            { id: "c2", name: "write_fast", arguments: "{}" },
          ],
        },
        { content: "done", toolCalls: [] },
      ]);
      const tools = [
        makeTrackedTool("read_slow", false, log, 30),
        makeTrackedTool("write_fast", true, log, 1),
      ];

      const result = await runAgent({
        client,
        tools,
        messages: [{ role: "user", content: "go" }],
      });

      const toolMsgs = result.messages.filter((m) => m.role === "tool");
      expect(toolMsgs.map((m) => m.toolCallId)).toEqual(["c1", "c2"]);
    });
  });
});
