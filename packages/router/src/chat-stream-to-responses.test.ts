import { describe, expect, it, vi } from "vitest";
import {
  consumeSse,
  consumeSseBuffer,
  streamChatCompletionToResponses,
} from "./chat-stream-to-responses.js";
import { Writable } from "node:stream";

describe("Chat Completions SSE parser", () => {
  it("handles CRLF, comments, event fields, and multiple data lines", () => {
    const values: string[] = [];
    let buffer = "";
    buffer +=
      ": keepalive\r\nevent: message\r\ndata: first\r\ndata: second\r\n\r\n";
    buffer += "data: [DONE]\n\ntrailing";

    const remainder = consumeSseBuffer(buffer, (value) => values.push(value));

    expect(values).toEqual(["first\nsecond", "[DONE]"]);
    expect(remainder).toBe("trailing");
  });

  it("handles arbitrary transport chunk boundaries and UTF-8 characters", async () => {
    const source = new TextEncoder().encode(
      'data: {"text":"你好"}\n\ndata: [DONE]\n\n',
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < source.length; index += 2) {
          controller.enqueue(source.slice(index, index + 2));
        }
        controller.close();
      },
    });
    const values: string[] = [];

    await consumeSse(body, (value) => {
      values.push(value);
    });

    expect(values).toEqual(['{"text":"你好"}', "[DONE]"]);
  });

  it("cancels a stalled stream after the safe idle timeout", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });

    await expect(
      consumeSse(body, () => undefined, { timeoutMs: 5 }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    expect(cancel).toHaveBeenCalled();
  });
});

describe("DeepSeek slow downstream regression", () => {
  it("waits for downstream drain instead of buffering the entire upstream", async () => {
    const writes: string[] = [];
    let release: (() => void) | undefined;
    const res = new Writable({
      highWaterMark: 128,
      write(chunk, _encoding, callback) {
        writes.push(String(chunk));
        release = callback;
      },
    }) as Writable & { writeHead: () => void };
    res.writeHead = () => undefined;
    let reads = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        if (reads > 100) {
          controller.close();
          return;
        }
        controller.enqueue(
          new TextEncoder().encode(
            "data: " +
              JSON.stringify({
                choices: [
                  {
                    index: 0,
                    delta: { content: "x".repeat(1024) },
                    finish_reason: reads === 100 ? "stop" : null,
                  },
                ],
              }) +
              "\n\n",
          ),
        );
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const task = streamChatCompletionToResponses(
      new Response(body),
      res as any,
      {
        requestBody: { model: "deepseek-v4-flash" },
        route: { id: "deepseek-v4-flash" },
        converted: { toolContext: {} },
        context: { clientSignal: controller.signal },
      },
    ).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    const readBeforeCancel = reads;
    controller.abort();
    res.destroy();
    release?.();
    await task;
    expect(readBeforeCancel).toBeLessThan(5);
    expect(cancelled).toBe(true);
    expect(res.writableLength).toBeLessThan(8192);
  });
  it("preserves DeepSeek cache-hit usage and does not replace it on an empty final chunk", async () => {
    let result = "";
    const res = new Writable({
      write(c, _e, cb) {
        result += String(c);
        cb();
      },
    }) as Writable & { writeHead: () => void };
    res.writeHead = () => undefined;
    const chunks = [
      {
        choices: [{ delta: { content: "OK" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 2,
          total_tokens: 102,
          prompt_cache_hit_tokens: 80,
        },
      },
      { choices: [] },
    ];
    const body =
      chunks.map((x) => "data: " + JSON.stringify(x) + "\n\n").join("") +
      "data: [DONE]\n\n";
    const response = await streamChatCompletionToResponses(
      new Response(body),
      res as any,
      {
        requestBody: { model: "deepseek-v4-flash" },
        route: { id: "deepseek-v4-flash" },
        converted: { toolContext: {} },
      },
    );
    expect(response.response.usage).toMatchObject({
      input_tokens: 100,
      total_tokens: 102,
      input_tokens_details: { cached_tokens: 80 },
    });
    expect(result).not.toContain("reasoning_text");
  });
});
