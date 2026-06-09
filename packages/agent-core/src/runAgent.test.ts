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
});
