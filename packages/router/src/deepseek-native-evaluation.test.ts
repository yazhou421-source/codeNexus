import { describe, it, expect, vi } from "vitest";
import { Writable } from "node:stream";
import {
  adaptDeepSeekResponsesRequest,
  sanitizeDeepSeekNativeEvent,
  proxyDeepSeekNativeEvaluation,
} from "./deepseek-native-evaluation.js";
const { upstreamMock } = vi.hoisted(() => ({ upstreamMock: vi.fn() }));
vi.mock("./upstream.js", () => ({ callStreamingUpstream: upstreamMock }));
describe("DeepSeek native Responses evaluation contract", () => {
  it("keeps tool schemas, output bounds and complete input while removing unsupported fields", () => {
    const tools = [
      {
        type: "function",
        name: "exec_command",
        parameters: { type: "object", properties: { cmd: { type: "string" } } },
      },
    ];
    const adapted = adaptDeepSeekResponsesRequest(
      {
        input: "OK",
        tools,
        model: "alias",
        stream: true,
        store: true,
        include: ["reasoning.encrypted_content"],
        prompt_cache_key: "private",
        max_output_tokens: 20,
        reasoning: { effort: "low" },
      },
      { model: "deepseek-v4-flash" },
    );
    expect(adapted).toEqual({
      input: "OK",
      tools,
      model: "deepseek-v4-flash",
      stream: true,
      store: false,
      max_output_tokens: 20,
      reasoning: { effort: "low" },
    });
  });
  it("restores stateless tool continuation and fails closed on missing history", () => {
    const history = {
      getResponseMeta: () => ({
        nativeInput: [
          { role: "user", content: "run" },
          {
            type: "function_call",
            call_id: "c",
            name: "exec_command",
            arguments: '{"cmd":"echo OK"}',
          },
        ],
      }),
    };
    const next = adaptDeepSeekResponsesRequest(
      {
        previous_response_id: "r",
        input: [{ type: "function_call_output", call_id: "c", output: "OK" }],
      },
      { model: "deepseek-v4-flash" },
      history,
    );
    expect(next.input).toHaveLength(3);
    expect(next.previous_response_id).toBeUndefined();
    expect(() =>
      adaptDeepSeekResponsesRequest(
        { previous_response_id: "unknown" },
        { model: "x" },
      ),
    ).toThrow();
  });
  it("suppresses reasoning events and completed reasoning while preserving visible tool deltas and usage", () => {
    const ids = new Set<string>();
    expect(
      sanitizeDeepSeekNativeEvent(
        { type: "response.reasoning_text.delta", delta: "private" },
        ids,
      ),
    ).toBeNull();
    expect(
      sanitizeDeepSeekNativeEvent(
        {
          type: "response.output_item.added",
          item: { id: "rs", type: "reasoning" },
        },
        ids,
      ),
    ).toBeNull();
    expect(
      sanitizeDeepSeekNativeEvent(
        {
          type: "response.content_part.done",
          item_id: "rs",
          part: { type: "reasoning_text", text: "private" },
        },
        ids,
      ),
    ).toBeNull();
    const delta = {
      type: "response.function_call_arguments.delta",
      delta: '{"cmd":',
    };
    expect(sanitizeDeepSeekNativeEvent(delta, ids)).toEqual(delta);
    expect(
      sanitizeDeepSeekNativeEvent(
        {
          type: "response.completed",
          response: {
            output: [
              { type: "reasoning", content: [{ text: "private" }] },
              { type: "message", content: [] },
            ],
            usage: { input_tokens: 3 },
          },
        },
        ids,
      ),
    ).toEqual({
      type: "response.completed",
      response: {
        output: [{ type: "message", content: [] }],
        usage: { input_tokens: 3 },
      },
    });
  });
  it("does not pass provider error messages through", () => {
    expect(
      JSON.stringify(
        sanitizeDeepSeekNativeEvent({
          type: "response.failed",
          response: {
            error: {
              code: "model_not_found",
              message: "https://private Authorization synthetic",
            },
          },
        }),
      ),
    ).not.toMatch(/private|synthetic|Authorization/);
  });
  it("forwards native tool SSE and terminal usage without requiring DONE", async () => {
    const frames = [
      { type: "response.created", response: { id: "r", output: [] } },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc",
        delta: '{"cmd":"echo OK"}',
      },
      {
        type: "response.completed",
        response: {
          id: "r",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "c",
              name: "exec_command",
              arguments: '{"cmd":"echo OK"}',
            },
          ],
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        },
      },
    ];
    upstreamMock.mockResolvedValueOnce(
      new Response(
        frames.map((x) => "data: " + JSON.stringify(x) + "\n\n").join(""),
      ),
    );
    let text = "";
    const res = new Writable({
      write(c, _e, cb) {
        text += c;
        cb();
      },
    }) as any;
    res.writeHead = () => undefined;
    const history = { recordResponse: vi.fn() };
    await proxyDeepSeekNativeEvaluation(
      { input: "run", stream: true },
      { id: "deepseek-v4-flash", model: "deepseek-v4-flash" },
      history,
      res,
      {},
    );
    expect(text).toContain("response.function_call_arguments.delta");
    expect(text).toContain('"total_tokens":12');
    expect(history.recordResponse).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r" }),
      expect.objectContaining({
        nativeInput: expect.arrayContaining([
          expect.objectContaining({ type: "function_call", call_id: "c" }),
        ]),
      }),
    );
  });
  it("aborts native upstream while a slow downstream is waiting for drain", async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    upstreamMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
              ),
            );
          },
          cancel: cancelled,
        }),
      ),
    );
    const res = new Writable({ highWaterMark: 1, write() {} }) as any;
    res.writeHead = () => undefined;
    const task = proxyDeepSeekNativeEvaluation(
      { input: "run" },
      { id: "deepseek-v4-flash", model: "deepseek-v4-flash" },
      {},
      res,
      { clientSignal: controller.signal },
    );
    const assertion = expect(task).rejects.toBeDefined();
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await assertion;
    expect(cancelled).toHaveBeenCalled();
    res.destroy();
  });
});
